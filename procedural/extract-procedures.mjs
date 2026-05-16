/**
 * SecondCortex Procedural Memory Extractor — P3
 * 
 * Scans recent daily logs and conversations for multi-step procedures,
 * extracts them as structured checklists, and saves them as vault notes
 * under vault/Atlas/Notes/ with type: procedure.
 * 
 * Uses Gemini Flash for extraction (free tier).
 * 
 * Usage:
 *   node extract-procedures.mjs                — extract from recent logs
 *   node extract-procedures.mjs --days 7       — look back 7 days
 *   node extract-procedures.mjs --dry-run      — show what would be extracted
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || '/home/manager', '.openclaw/workspace');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const VAULT_NOTES_DIR = join(WORKSPACE, 'vault/Atlas/Notes');
const MEMORY_DIR = join(WORKSPACE, 'memory');
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_CHARS_PER_EXTRACTION = 8000;

// ─── Procedure Extraction Prompt ─────────────────────────────────────────────
const PROCEDURE_PROMPT = `You are a procedure extraction engine. Given conversation log text, extract multi-step procedures as structured checklists.

For each procedure found, output a JSON object:
{
  "title": "Short imperative title (e.g. 'Deploy FastAPI to VPS with Nginx')",
  "summary": "One-line description of what this procedure accomplishes",
  "tags": ["relevant", "tags"],
  "steps": [
    {"step": 1, "action": "What to do", "detail": "Specific command or detail"},
    {"step": 2, "action": "Next step", "detail": "..."},
  ],
  "prerequisites": ["Things needed before starting"],
  "source_date": "YYYY-MM-DD if known",
  "confidence": 0.0-1.0
}

Rules:
- Extract ONLY procedures with 3+ clear steps
- Each step should be atomic and actionable
- Include actual commands, URLs, or config snippets when present
- Skip trivial sequences (like "open browser, go to URL")
- Skip things already expressed as single facts
- Confidence >= 0.7 required
- If no procedures found, return empty array

Output ONLY a JSON array, no markdown, no commentary.`;

// ─── Helper Functions ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getRecentLogs(days) {
  const logs = [];
  const now = new Date();
  
  for (let d = 0; d < days; d++) {
    const date = new Date(now - d * 86400000);
    const dateStr = date.toISOString().slice(0, 10);
    const logPath = join(MEMORY_DIR, `${dateStr}.md`);
    
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, 'utf-8');
      if (content.trim().length > 50) {
        logs.push({ date: dateStr, path: logPath, content });
      }
    }
  }
  
  return logs;
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ─── Gemini Extraction ─────────────────────────────────────────────────────────
async function extractProcedures(text, dateHint = '') {
  const prompt = PROCEDURE_PROMPT + (dateHint ? `\n\nSource date: ${dateHint}` : '') + '\n\nText:\n' + text.slice(0, MAX_CHARS_PER_EXTRACTION);
  
  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': GEMINI_API_KEY,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      console.log(`[procedural] Gemini error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    let text2 = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text2) return [];

    // Parse JSON (handle markdown code blocks)
    let jsonStr = text2.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const procedures = JSON.parse(jsonStr);
    if (!Array.isArray(procedures)) return [];
    
    return procedures.filter(p => p.confidence >= 0.7 && p.steps && p.steps.length >= 3);
  } catch (err) {
    console.log(`[procedural] Extraction error: ${err.message}`);
    return [];
  }
}

// ─── Save as Vault Note ───────────────────────────────────────────────────────
function saveProcedureNote(procedure) {
  const slug = slugify(procedure.title);
  const filename = `${slug}.md`;
  const filepath = join(VAULT_NOTES_DIR, filename);
  
  // Don't overwrite existing notes
  if (existsSync(filepath)) {
    console.log(`[procedural] Skipping existing note: ${filename}`);
    return null;
  }
  
  const tags = (procedure.tags || []).map(t => `  - ${t}`).join('\n');
  const steps = procedure.steps.map(s => 
    `${s.step}. **${s.action}**${s.detail ? ` — ${s.detail}` : ''}`
  ).join('\n');
  const prereqs = (procedure.prerequisites || []).map(p => `- ${p}`).join('\n');
  
  const frontmatter = `---
tier: T2
type: procedure
created: ${new Date().toISOString().slice(0, 10)}
tags:
${tags}
---

# ${procedure.title}

${procedure.summary}

## Prerequisites
${prereqs || '- None specified'}

## Steps
${steps}

## Source
Extracted from daily log (${procedure.source_date || 'unknown date'}). Confidence: ${procedure.confidence}

---
*This procedure was auto-extracted by SecondCortex procedural memory.*`;

  writeFileSync(filepath, frontmatter);
  console.log(`[procedural] Created: ${filename} (${procedure.steps.length} steps, conf: ${procedure.confidence})`);
  return filename;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : DEFAULT_LOOKBACK_DAYS;
  
  console.log(`[procedural] Scanning last ${days} days of logs...`);
  
  const logs = getRecentLogs(days);
  console.log(`[procedural] Found ${logs.length} log files to scan`);
  
  let totalProcedures = 0;
  let totalNotes = 0;
  
  for (const log of logs) {
    console.log(`[procedural] Processing ${log.date} (${(log.content.length / 1024).toFixed(1)}KB)...`);
    
    // Process in chunks if log is large
    const chunks = [];
    if (log.content.length > MAX_CHARS_PER_EXTRACTION) {
      // Split on ## headers (sections)
      const lines = log.content.split('\n');
      let currentChunk = '';
      for (const line of lines) {
        if (line.startsWith('## ') && currentChunk.length > 200) {
          chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
        // Force split if chunk is still too large
        if (currentChunk.length > MAX_CHARS_PER_EXTRACTION) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
      }
      if (currentChunk.trim().length > 50) chunks.push(currentChunk);
    } else {
      chunks.push(log.content);
    }
    
    for (const chunk of chunks) {
      const procedures = await extractProcedures(chunk, log.date);
      
      if (procedures.length > 0) {
        console.log(`[procedural] Found ${procedures.length} procedure(s) in ${log.date}`);
        totalProcedures += procedures.length;
        
        for (const proc of procedures) {
          if (dryRun) {
            console.log(`  [dry-run] Would create: "${proc.title}" (${proc.steps.length} steps)`);
          } else {
            const note = saveProcedureNote(proc);
            if (note) totalNotes++;
          }
        }
      }
      
      // Rate limit
      await sleep(2000);
    }
  }
  
  console.log(`\n[procedural] Done! ${totalProcedures} procedures found, ${totalNotes} vault notes created`);
  if (dryRun) console.log('[procedural] (dry-run mode — no files written)');
}

main().catch(err => {
  console.error('[procedural] Fatal error:', err);
  process.exit(1);
});