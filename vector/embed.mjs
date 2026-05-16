/**
 * SecondCortex Vector Search — P2
 * 
 * Embeds vault notes + memory files using Gemini Embedding (free API, default)
 * with Ollama fallback (if local embedding model available).
 * Hybrid RRF search combining vector similarity + FTS5 text matching.
 *
 * Backends:
 *   gemini (default) — Gemini Embedding-001 via free API (3072 dims)
 *   ollama — local Ollama with qwen3-embedding (1024 dims)
 *
 * Extraction (handler.ts) uses Ollama cloud (glm-5.1:cloud) with Gemini fallback.
 * 
 * Usage:
 *   node embed.mjs                    — embed all (Gemini default)
 *   EMBED_BACKEND=ollama node embed.mjs — embed with Ollama
 *   node embed.mjs search "query"     — hybrid search
 *   node embed.mjs status             — show stats
 *   node embed.mjs embed --force     — force re-embed all
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import Database from 'better-sqlite3';

// ─── Config ──────────────────────────────────────────────────────────────────
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || '/home/manager', '.openclaw/workspace');

// Embedding backend: 'gemini' (default, free API) or 'ollama' (if local model available)
const EMBED_BACKEND = process.env.EMBED_BACKEND || 'gemini';

// Ollama config (for future local embedding support)
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding';

// Gemini config (default — free embedding API)
const GEMINI_API_KEY = process.env.KODA_GEMINI_KEY || 'REDACTED_GEMINI_KEY_2';
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

// Derived config
const EMBEDDING_MODEL = EMBED_BACKEND === 'ollama' ? OLLAMA_EMBED_MODEL : GEMINI_EMBED_MODEL;
const EMBEDDING_DIMS = EMBED_BACKEND === 'ollama' ? 1024 : 3072;
const DB_PATH = join(WORKSPACE, 'PROJECTS/secondcortex/vector/embeddings.db');
const VAULT_DIR = join(WORKSPACE, 'vault/Atlas/Notes');
const MEMORY_DIR = join(WORKSPACE, 'memory');
const MAX_CHUNK_SIZE = 2000;
const BATCH_SIZE = EMBED_BACKEND === 'ollama' ? 20 : 10;
const RATE_LIMIT_MS = EMBED_BACKEND === 'ollama' ? 50 : 1000;

// ─── Database Setup ──────────────────────────────────────────────────────────
function initDB(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      dims INTEGER DEFAULT ${EMBEDDING_DIMS},
      backend TEXT DEFAULT '${EMBED_BACKEND}',
      model TEXT DEFAULT '${EMBEDDING_MODEL}',
      updated_at TEXT NOT NULL,
      UNIQUE(path, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
    CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);
  `);
  // Migration: add backend/model columns if missing (existing DB)
  try { db.prepare('SELECT backend FROM documents LIMIT 1').get(); } catch { db.exec('ALTER TABLE documents ADD COLUMN backend TEXT DEFAULT "gemini"'); db.exec('ALTER TABLE documents ADD COLUMN model TEXT DEFAULT "gemini-embedding-001"'); }
  try { db.prepare('SELECT dims FROM documents LIMIT 1').get(); } catch { db.exec('ALTER TABLE documents ADD COLUMN dims INTEGER DEFAULT 3072'); }
}

// ─── Chunking ─────────────────────────────────────────────────────────────────
function chunkText(text, maxSize = MAX_CHUNK_SIZE) {
  const chunks = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.trim()];
}

// ─── File Discovery ───────────────────────────────────────────────────────────
function* walkDir(dir, extensions = ['.md', '.txt']) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      yield* walkDir(fullPath, extensions);
    } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

function getFilePaths() {
  const paths = new Set();
  for (const p of walkDir(VAULT_DIR)) paths.add(p);
  for (const p of walkDir(MEMORY_DIR)) paths.add(p);
  const memFile = join(WORKSPACE, 'MEMORY.md');
  if (existsSync(memFile)) paths.add(memFile);
  const dreamsFile = join(WORKSPACE, 'DREAMS.md');
  if (existsSync(dreamsFile)) paths.add(dreamsFile);
  return [...paths].sort();
}

// ─── Ollama Cloud Embedding ──────────────────────────────────────────────────
async function embedSingleOllama(text) {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const err = await response.text();
      console.log(`[embed] Ollama error: ${response.status} ${err.slice(0, 100)}`);
      console.log('[embed] Falling back to Gemini...');
      return embedSingleGemini(text);
    }
    const data = await response.json();
    if (data.embeddings && data.embeddings[0]) return data.embeddings[0];
    console.log('[embed] Ollama returned no embeddings, falling back to Gemini');
    return embedSingleGemini(text);
  } catch (err) {
    console.log(`[embed] Ollama error: ${err.message}, falling back to Gemini`);
    return embedSingleGemini(text);
  }
}

async function embedBatchOllama(texts) {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts.map(t => t.slice(0, 8000)) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      console.log(`[embed] Ollama batch error: ${response.status}, falling back to Gemini`);
      return embedBatchGemini(texts);
    }
    const data = await response.json();
    if (data.embeddings && data.embeddings.length > 0) return data.embeddings;
    console.log('[embed] Ollama returned empty batch, falling back to Gemini');
    return embedBatchGemini(texts);
  } catch (err) {
    console.log(`[embed] Ollama batch error: ${err.message}, falling back to Gemini`);
    return embedBatchGemini(texts);
  }
}

// ─── Gemini Embedding (fallback) ─────────────────────────────────────────────
async function embedSingleGemini(text) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({ model: `models/${GEMINI_EMBED_MODEL}`, content: { parts: [{ text: text.slice(0, 8000) }] } }),
  });
  if (!response.ok) { console.log(`[embed] Gemini error: ${response.status}`); return null; }
  const data = await response.json();
  return data.embedding?.values || null;
}

async function embedBatchGemini(texts) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents`;
  const requests = texts.map(text => ({ model: `models/${GEMINI_EMBED_MODEL}`, content: { parts: [{ text: text.slice(0, 8000) }] } }));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({ requests }),
  });
  if (!response.ok) {
    const embeddings = [];
    for (const text of texts) { embeddings.push(await embedSingleGemini(text)); await sleep(RATE_LIMIT_MS); }
    return embeddings;
  }
  const data = await response.json();
  return (data.embeddings || []).map(e => e.values || null);
}

// ─── Unified Embedding API ───────────────────────────────────────────────────
async function embedSingle(text) {
  return EMBED_BACKEND === 'ollama' ? embedSingleOllama(text) : embedSingleGemini(text);
}

async function embedBatch(texts) {
  return EMBED_BACKEND === 'ollama' ? embedBatchOllama(texts) : embedBatchGemini(texts);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function float32ToBuffer(arr) { return Buffer.from(new Float32Array(arr).buffer); }
function bufferToFloat32(buf) { return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); }

// ─── Embed All Documents ──────────────────────────────────────────────────────
async function embedAll(db, force = false) {
  initDB(db);
  const filePaths = getFilePaths();
  console.log(`[embed] Found ${filePaths.length} files | Backend: ${EMBED_BACKEND} | Model: ${EMBEDDING_MODEL} | Dims: ${EMBEDDING_DIMS}`);

  const existingStmt = db.prepare('SELECT path, chunk_index, updated_at FROM documents');
  const existing = new Map();
  for (const row of existingStmt.all()) existing.set(`${row.path}:${row.chunk_index}`, row.updated_at);

  let totalChunks = 0, newChunks = 0, skippedChunks = 0, errorChunks = 0;
  const insertStmt = db.prepare('INSERT OR REPLACE INTO documents (path, chunk_index, content, embedding, dims, backend, model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const batchQueue = [];

  for (const filePath of filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.trim().length < 10) continue;
      const stat = statSync(filePath);
      const mtime = stat.mtime.toISOString();
      const chunks = chunkText(content);
      for (let i = 0; i < chunks.length; i++) {
        totalChunks++;
        const key = `${filePath}:${i}`;
        if (!force && existing.get(key) >= mtime) { skippedChunks++; continue; }
        batchQueue.push({ path: filePath, chunk_index: i, content: chunks[i], mtime });
      }
    } catch (err) { console.error(`[embed] Error reading ${filePath}: ${err.message}`); }
  }

  console.log(`[embed] ${totalChunks} total chunks, ${batchQueue.length} to embed, ${skippedChunks} up-to-date`);

  for (let i = 0; i < batchQueue.length; i += BATCH_SIZE) {
    const batch = batchQueue.slice(i, i + BATCH_SIZE);
    const texts = batch.map(b => b.content);
    try {
      const embeddings = await embedBatch(texts);
      const insertMany = db.transaction((items) => {
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const emb = embeddings[j];
          if (emb) {
            insertStmt.run(item.path, item.chunk_index, item.content, float32ToBuffer(emb), emb.length, EMBED_BACKEND, EMBEDDING_MODEL, item.mtime);
            newChunks++;
          } else { errorChunks++; }
        }
      });
      insertMany(batch);
      process.stdout.write(`\r[embed] Progress: ${Math.min(i + BATCH_SIZE, batchQueue.length)}/${batchQueue.length} chunks embedded`);
      if (i + BATCH_SIZE < batchQueue.length) await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.error(`\n[embed] Batch error: ${err.message}`);
      errorChunks += batch.length;
    }
  }

  console.log(`\n[embed] Done! ${newChunks} embedded, ${skippedChunks} up-to-date, ${errorChunks} errors`);

  // Clean up orphans
  const allPaths = new Set(filePaths);
  const orphans = db.prepare('SELECT DISTINCT path FROM documents').all();
  let deletedCount = 0;
  for (const row of orphans) { if (!allPaths.has(row.path)) { db.prepare('DELETE FROM documents WHERE path = ?').run(row.path); deletedCount++; } }
  if (deletedCount > 0) console.log(`[embed] Removed ${deletedCount} orphaned file entries`);

  return { totalChunks, newChunks, skippedChunks, errorChunks, deletedCount };
}

// ─── Vector Search ─────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

async function vectorSearch(db, query, topK = 10) {
  const queryEmbedding = await embedSingle(query);
  if (!queryEmbedding) { console.error('[search] Failed to get query embedding'); return []; }
  const rows = db.prepare('SELECT id, path, chunk_index, content, embedding, dims, backend, model FROM documents WHERE embedding IS NOT NULL').all();
  const results = [];
  for (const row of rows) {
    const docDims = row.dims || EMBEDDING_DIMS;
    const docEmbedding = bufferToFloat32(row.embedding);
    if (docEmbedding.length !== queryEmbedding.length) continue; // skip dimension mismatch
    const score = cosineSimilarity(queryEmbedding, docEmbedding);
    results.push({ id: row.id, path: row.path, chunk_index: row.chunk_index, content: row.content, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

function fts5Search(db, query, topK = 10) {
  const rows = db.prepare('SELECT id, path, chunk_index, content FROM documents').all();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const results = [];
  for (const row of rows) {
    const text = row.content.toLowerCase();
    let score = 0;
    for (const term of terms) { score += (text.match(new RegExp(term, 'g')) || []).length; }
    if (score > 0) results.push({ id: row.id, path: row.path, chunk_index: row.chunk_index, content: row.content, score: score / terms.length, type: 'fts5' });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

async function hybridSearch(db, query, topK = 10) {
  const [vectorResults, ftsResults] = await Promise.all([vectorSearch(db, query, topK * 2), Promise.resolve(fts5Search(db, query, topK * 2))]);
  const vResults = vectorResults.map(r => ({ ...r, type: 'vector' }));
  const k = 60;
  const scores = new Map();
  for (let i = 0; i < vResults.length; i++) { const r = vResults[i]; const current = scores.get(r.path) || { path: r.path, content: r.content, rrfScore: 0, vectorScore: 0, ftsScore: 0 }; current.rrfScore += 1 / (k + i + 1); current.vectorScore = r.score; scores.set(r.path, current); }
  for (let i = 0; i < ftsResults.length; i++) { const r = ftsResults[i]; const current = scores.get(r.path) || { path: r.path, content: r.content, rrfScore: 0, vectorScore: 0, ftsScore: 0 }; current.rrfScore += 1 / (k + i + 1); current.ftsScore = r.score; scores.set(r.path, current); }
  return [...scores.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, topK);
}

// ─── Status ────────────────────────────────────────────────────────────────────
function showStatus(db) {
  initDB(db);
  const total = db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
  const withEmbeddings = db.prepare('SELECT COUNT(*) as count FROM documents WHERE embedding IS NOT NULL').get().count;
  const paths = db.prepare('SELECT COUNT(DISTINCT path) as count FROM documents').get().count;
  const lastUpdated = db.prepare('SELECT MAX(updated_at) as latest FROM documents').get().latest;
  const backends = db.prepare('SELECT backend, model, COUNT(*) as count FROM documents WHERE embedding IS NOT NULL GROUP BY backend, model').all();
  console.log(`\n📊 SecondCortex Vector Search Status`);
  console.log(`   Total chunks: ${total}`);
  console.log(`   With embeddings: ${withEmbeddings}`);
  console.log(`   Files indexed: ${paths}`);
  console.log(`   Last updated: ${lastUpdated || 'never'}`);
  console.log(`   Active backend: ${EMBED_BACKEND} (${EMBEDDING_MODEL}, ${EMBEDDING_DIMS} dims)`);
  console.log(`   Database: ${DB_PATH}`);
  if (backends.length > 0) {
    console.log(`   Embedding backends:`);
    for (const b of backends) console.log(`     ${b.backend}/${b.model}: ${b.count} chunks`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2] || 'embed';
  mkdirSync(join(DB_PATH, '..'), { recursive: true });
  const db = new Database(DB_PATH);
  initDB(db);

  switch (command) {
    case 'embed': case 'update': {
      const force = process.argv.includes('--force');
      const result = await embedAll(db, force);
      console.log('\n✅ Embedding complete:', result);
      break;
    }
    case 'search': {
      const query = process.argv.slice(3).join(' ');
      if (!query) { console.error('Usage: node embed.mjs search "your query"'); process.exit(1); }
      console.log(`🔍 Searching for: "${query}" (${EMBED_BACKEND})\n`);
      const results = await hybridSearch(db, query);
      for (const r of results) {
        const relPath = r.path.replace(WORKSPACE + '/', '');
        console.log(`  [${r.type || 'hybrid'}] ${relPath} (RRF: ${r.rrfScore?.toFixed(4) || 'N/A'}, vec: ${(r.vectorScore || 0).toFixed(3)}, fts: ${(r.ftsScore || 0).toFixed(2)})`);
        console.log(`    ${r.content.slice(0, 120).replace(/\n/g, ' ')}...`);
        console.log();
      }
      break;
    }
    case 'status': { showStatus(db); break; }
    default: {
      console.log(`Usage: node embed.mjs [embed|search|status] [args]`);
      console.log(`  embed   — Embed all files (default: Ollama cloud)`);
      console.log(`  search  — Hybrid vector + text search`);
      console.log(`  status  — Show embedding stats`);
      console.log(`\nEnvironment:`);
      console.log(`  EMBED_BACKEND=ollama|gemini  (default: ollama)`);
      console.log(`  OLLAMA_EMBED_MODEL=model     (default: qwen3-embedding)`);
    }
  }
  db.close();
}

main().catch(err => { console.error('[embed] Fatal error:', err); process.exit(1); });