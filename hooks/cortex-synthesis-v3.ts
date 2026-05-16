import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Configuration ───────────────────────────────────────────────────────────
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || "/home/manager", ".openclaw/workspace");
const QUEUE_FILE = join(WORKSPACE, "PROJECTS/cortex-v2/synthesis_queue.json");
const DAILY_LOG_DIR = join(WORKSPACE, "memory");

// Gemini extraction config — uses Koda free-tier key
const GEMINI_API_KEY = process.env.KODA_GEMINI_KEY || "REDACTED_KODA_KEY";
const GEMINI_MODEL = "gemini-2.0-flash"; // Free tier, fast, good enough for extraction
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const EXTRACTION_ENABLED = true; // Set false to disable LLM extraction (regex-only fallback)
const MAX_EXTRACTION_RETRIES = 1;
const EXTRACTION_TIMEOUT_MS = 10000; // 10s timeout for Gemini calls

// ─── Saliency Patterns (v2 — expanded) ──────────────────────────────────────
const SALIENCY_PATTERNS = [
  // Explicit markers
  /remember this[:]/i,
  /core truth[:]/i,
  /lesson learned[:]/i,
  /critical decision[:]/i,
  /correction[:]/i,
  /update memory[:]/i,
  /important to note that/i,
  // Implicit insight patterns
  /root cause(?: was| is|:)/i,
  /fix(?:ed|):?\s/i,
  /the issue (?:was|is)\s/i,
  /key (?:insight|finding|takeaway):/i,
  /this (?:means|implies|suggests)\s/i,
  /never (?:again|do|use)\s/i,
  /always (?:use|do|prefer)\s/i,
  /gotcha[:\s]/i,
  /workaround[:\s]/i,
  /the problem (?:was|is)\s/i,
  /make sure (?:to|you)\s/i,
  /don't forget[:\s]/i,
];

// ─── Category Auto-Tagging ───────────────────────────────────────────────────
const CATEGORY_PATTERNS = [
  { category: "infrastructure", pattern: /(?:nginx|server|vps|deploy|dns|ssl|docker|systemd)/i },
  { category: "bug", pattern: /(?:root cause|fix(?:ed)?|issue was|bug|error|500|401|403|crash)/i },
  { category: "decision", pattern: /(?:decided|decision|chose|went with|will use|switching to)/i },
  { category: "model", pattern: /(?:model|provider|ollama|gemini|claude|gpt|glm)/i },
  { category: "security", pattern: /(?:secret|key|credential|password|auth|token|perm)/i },
  { category: "pkm", pattern: /(?:note|vault|memory|moc|zettelkasten|obsidian)/i },
  { category: "robotics", pattern: /(?:robot|embodied|spatial reason|trajectory|bounding box|pointing)/i },
];

// ─── Triple Extraction Prompt ─────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are a knowledge extraction engine. Given a conversation snippet, extract atomic facts as structured triples.

For each fact, output a JSON object with:
- subject: the entity or concept (short noun phrase)
- relation: the relationship (short verb phrase like "root_cause", "is", "prevents", "requires", "located_at")
- object: the value or target (short noun phrase)
- confidence: 0.0-1.0 how certain this fact is
- category: one of [infrastructure, bug, decision, model, security, pkm, robotics, general]

Rules:
- Extract ONLY facts, not questions or commands
- Each triple should be atomic (one fact per entry)
- Keep subject/relation/object short (under 50 chars each)
- If no facts found, return empty array

Output ONLY a JSON array, no other text.

Snippet:
`;

// ─── Core Functions ──────────────────────────────────────────────────────────

function loadQueue() {
  try {
    if (!existsSync(QUEUE_FILE)) return [];
    return JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveQueue(queue: any[]) {
  const dir = join(QUEUE_FILE, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function categorize(text: string): string[] {
  const tags: string[] = [];
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) tags.push(category);
  }
  return tags.length > 0 ? tags : ["general"];
}

// ─── LLM Extraction (Gemini Flash) ───────────────────────────────────────────

interface Triple {
  subject: string;
  relation: string;
  object: string;
  confidence: number;
  category: string;
}

async function extractTriples(content: string): Promise<Triple[]> {
  if (!EXTRACTION_ENABLED) return [];

  // Only extract from content that's substantial enough
  if (content.length < 50) return [];

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY,
      },
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{
          parts: [{ text: EXTRACTION_PROMPT + content.slice(0, 2000) }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      console.log(`[cortex-synthesis] Gemini extraction failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return [];

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const triples: Triple[] = JSON.parse(jsonStr);
    if (!Array.isArray(triples)) return [];

    // Validate and filter
    return triples.filter((t: any) =>
      t.subject && t.relation && t.object &&
      typeof t.confidence === "number" && t.confidence >= 0.5
    ).map((t: any) => ({
      subject: String(t.subject).slice(0, 80),
      relation: String(t.relation).slice(0, 80),
      object: String(t.object).slice(0, 120),
      confidence: Number(t.confidence),
      category: CATEGORY_PATTERNS.some(cp => cp.pattern.test(`${t.subject} ${t.relation} ${t.object}`))
        ? categorize(`${t.subject} ${t.relation} ${t.object}`)[0]
        : (t.category || "general"),
    }));

  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      console.log("[cortex-synthesis] Gemini extraction timed out");
    } else {
      console.log(`[cortex-synthesis] Gemini extraction error: ${err?.message || err}`);
    }
    return [];
  }
}

// ─── Observe (regex + LLM extraction) ────────────────────────────────────────

function observeRegex(content: string, source: string): number {
  const queue = loadQueue();
  let captured = 0;

  for (const pattern of SALIENCY_PATTERNS) {
    const matches = content.matchAll(new RegExp(pattern.source, pattern.flags));
    for (const match of matches) {
      const start = match.index;
      const end = content.indexOf("\n", start);
      const insight = (end === -1 ? content.slice(start) : content.slice(start, end)).trim();
      const tags = categorize(insight);

      queue.push({
        timestamp: new Date().toISOString(),
        source,
        pattern: pattern.source,
        content: insight,
        tags,
        type: "regex",
      });
      captured++;
    }
  }

  if (captured > 0) {
    saveQueue(queue);
    console.log(`[cortex-synthesis] Regex captured ${captured} insights (tags: ${queue.slice(-captured).flatMap(q => q.tags).join(", ")})`);
  }

  return captured;
}

async function observeWithLLM(content: string, source: string): Promise<number> {
  const triples = await extractTriples(content);
  if (triples.length === 0) return 0;

  const queue = loadQueue();
  let captured = 0;

  for (const triple of triples) {
    queue.push({
      timestamp: new Date().toISOString(),
      source,
      pattern: "llm-extraction",
      content: `${triple.subject} → ${triple.relation} → ${triple.object}`,
      tags: [triple.category],
      type: "triple",
      triple: {
        subject: triple.subject,
        relation: triple.relation,
        object: triple.object,
        confidence: triple.confidence,
      },
    });
    captured++;
  }

  if (captured > 0) {
    saveQueue(queue);
    console.log(`[cortex-synthesis] LLM extracted ${captured} triples (categories: ${triples.map(t => t.category).join(", ")})`);
  }

  return captured;
}

// ─── Distill ──────────────────────────────────────────────────────────────────

function distill() {
  const queue = loadQueue();
  if (queue.length === 0) {
    console.log("[cortex-synthesis] Queue empty, nothing to distill");
    return 0;
  }

  const today = getTodayDate();
  const dailyLogPath = join(DAILY_LOG_DIR, `${today}.md`);

  let processed = 0;
  const distilledEntries: string[] = [];
  const tripleEntries: string[] = [];

  for (const item of queue) {
    if (item.type === "triple" && item.triple) {
      // Structured triple — store separately
      const t = item.triple;
      const tags = item.tags ? ` [${item.tags.join(",")}]` : "";
      tripleEntries.push(`- [Triple ${new Date().toISOString().slice(11, 16)}]${tags} **${t.subject}** → ${t.relation} → **${t.object}** (conf: ${t.confidence})`);
    } else {
      // Regex capture — strip pattern markers
      const content = SALIENCY_PATTERNS.reduce((text, pattern) => {
        return text.replace(pattern, "").trim();
      }, item.content);

      if (!content) continue;

      const timestamp = new Date().toISOString().slice(11, 16);
      const tags = item.tags ? ` [${item.tags.join(",")}]` : "";
      distilledEntries.push(`- [Distilled ${timestamp}]${tags} ${content}`);
    }
    processed++;
  }

  if (distilledEntries.length > 0 || tripleEntries.length > 0) {
    let block = "";

    if (distilledEntries.length > 0) {
      block += `\n\n## Distilled Insights\n${distilledEntries.join("\n")}`;
    }

    if (tripleEntries.length > 0) {
      block += `\n\n## Extracted Triples\n${tripleEntries.join("\n")}`;
    }

    // Append to daily log
    if (existsSync(dailyLogPath)) {
      const dailyContent = readFileSync(dailyLogPath, "utf-8");
      writeFileSync(dailyLogPath, dailyContent + block);
      console.log(`[cortex-synthesis] Distilled ${processed} items to daily log: ${dailyLogPath}`);
    } else {
      mkdirSync(DAILY_LOG_DIR, { recursive: true });
      writeFileSync(dailyLogPath, `# ${today} Daily Log${block}`);
      console.log(`[cortex-synthesis] Created daily log with ${processed} items: ${dailyLogPath}`);
    }
  }

  // Clear queue
  saveQueue([]);
  return processed;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

const handler = async (event: any) => {
  // Observe on message:sent — both regex and LLM extraction
  if (event.type === "message:sent" && event.context?.content) {
    const content = event.context.content;

    // Regex capture (synchronous, always runs)
    observeRegex(content, "message:sent");

    // LLM extraction (async, best-effort)
    try {
      await observeWithLLM(content, "message:sent");
    } catch (err) {
      console.log(`[cortex-synthesis] LLM extraction skipped: ${err}`);
    }
  }

  // Distill on command:new / command:reset (session boundary)
  if (event.type === "command:new" || event.type === "command:reset") {
    distill();
  }

  // Flush orphaned queue on gateway startup
  if (event.type === "gateway:startup") {
    const queue = loadQueue();
    if (queue.length > 0) {
      console.log(`[cortex-synthesis] Gateway startup: flushing ${queue.length} orphaned items`);
      distill();
    }
  }
};

export default handler;