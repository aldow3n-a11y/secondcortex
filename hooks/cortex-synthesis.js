import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Configuration ───────────────────────────────────────────────────────────
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || "/home/manager", ".openclaw/workspace");
const QUEUE_FILE = join(WORKSPACE, "PROJECTS/cortex-v2/synthesis_queue.json");
const DAILY_LOG_DIR = join(WORKSPACE, "memory");
const ATLAS_NOTES_DIR = join(WORKSPACE, "vault/Atlas/Notes");

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
  /fix(?:ed|:)?\s/i,
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
];

// ─── Core Functions ──────────────────────────────────────────────────────────

function loadQueue() {
  try {
    if (!existsSync(QUEUE_FILE)) return [];
    return JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  const dir = join(QUEUE_FILE, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function categorize(text) {
  const tags = [];
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) tags.push(category);
  }
  return tags.length > 0 ? tags : ["general"];
}

function observe(content, source = "session") {
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
      });
      captured++;
    }
  }

  if (captured > 0) {
    saveQueue(queue);
    console.log(`[secondcortex] Captured ${captured} insights to queue (tags: ${queue.slice(-captured).flatMap(q => q.tags).join(", ")})`);
  }

  return captured;
}

function distill() {
  const queue = loadQueue();
  if (queue.length === 0) {
    console.log("[secondcortex] Queue empty, nothing to distill");
    return 0;
  }

  const today = getTodayDate();
  const dailyLogPath = join(DAILY_LOG_DIR, `${today}.md`);

  let processed = 0;
  const distilledEntries = [];

  for (const item of queue) {
    const content = SALIENCY_PATTERNS.reduce((text, pattern) => {
      return text.replace(pattern, "").trim();
    }, item.content);

    if (!content) continue;

    const timestamp = new Date().toISOString().slice(11, 16);
    const tags = item.tags ? ` [${item.tags.join(",")}]` : "";
    distilledEntries.push(`- [Distilled ${timestamp}]${tags} ${content}`);
    processed++;
  }

  if (distilledEntries.length > 0) {
    const block = `\n\n## Distilled Insights\n${distilledEntries.join("\n")}`;

    if (existsSync(dailyLogPath)) {
      const dailyContent = readFileSync(dailyLogPath, "utf-8");
      writeFileSync(dailyLogPath, dailyContent + block);
      console.log(`[secondcortex] Distilled ${processed} items to daily log: ${dailyLogPath}`);
    } else {
      mkdirSync(DAILY_LOG_DIR, { recursive: true });
      writeFileSync(dailyLogPath, `# ${today} Daily Log\n${block}`);
      console.log(`[secondcortex] Created daily log with ${processed} items: ${dailyLogPath}`);
    }
  }

  saveQueue([]);
  return processed;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

const handler = async (event) => {
  if (event.type === "message:sent" && event.context?.content) {
    observe(event.context.content, "message:sent");
  }

  if (event.type === "command:new" || event.type === "command:reset") {
    distill();
  }

  if (event.type === "gateway:startup") {
    const queue = loadQueue();
    if (queue.length > 0) {
      console.log(`[secondcortex] Gateway startup: flushing ${queue.length} orphaned items`);
      distill();
    }
  }
};

export default handler;