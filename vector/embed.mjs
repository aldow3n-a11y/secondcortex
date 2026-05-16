/**
 * SecondCortex Vector Search — P2
 * 
 * Embeds vault notes + memory files using Gemini Embedding (free tier),
 * stores embeddings in a local SQLite vecs database, and provides
 * hybrid FTS5 + vector search.
 * 
 * Usage:
 *   node embed.mjs          — embed all vault notes & memory files
 *   node embed.mjs search "nginx prefix match" — hybrid search
 *   node embed.mjs status   — show embedding stats
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import Database from 'better-sqlite3';

// ─── Config ──────────────────────────────────────────────────────────────────
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || '/home/manager', '.openclaw/workspace');
const GEMINI_API_KEY = process.env.KODA_GEMINI_KEY || 'REDACTED_KODA_KEY';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS = 3072;
const EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
const BATCH_EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
const DB_PATH = join(WORKSPACE, 'PROJECTS/secondcortex/vector/embeddings.db');
const VAULT_DIR = join(WORKSPACE, 'vault/Atlas/Notes');
const MEMORY_DIR = join(WORKSPACE, 'memory');
const MAX_CHUNK_SIZE = 2000; // chars per chunk for embedding
const BATCH_SIZE = 10; // embed up to 10 chunks per API call
const RATE_LIMIT_MS = 1000; // 1s between batches (free tier: ~15 RPM)

// ─── Database Setup ──────────────────────────────────────────────────────────
function initDB(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      updated_at TEXT NOT NULL,
      UNIQUE(path, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
    CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);
  `);
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
  
  // Vault notes
  for (const p of walkDir(VAULT_DIR)) paths.add(p);
  
  // Memory daily logs
  for (const p of walkDir(MEMORY_DIR)) paths.add(p);
  
  // MEMORY.md
  const memFile = join(WORKSPACE, 'MEMORY.md');
  if (existsSync(memFile)) paths.add(memFile);
  
  // DREAMS.md
  const dreamsFile = join(WORKSPACE, 'DREAMS.md');
  if (existsSync(dreamsFile)) paths.add(dreamsFile);
  
  return [...paths].sort();
}

// ─── Embedding API ────────────────────────────────────────────────────────────
async function embedSingle(text) {
  const response = await fetch(EMBEDDING_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: text.slice(0, 8000) }] }, // 8K token limit
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.embedding?.values || null;
}

async function embedBatch(texts) {
  // Batch embedding endpoint
  const requests = texts.map(text => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: text.slice(0, 8000) }] },
  }));

  const response = await fetch(BATCH_EMBEDDING_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    // Fallback to individual calls
    const embeddings = [];
    for (const text of texts) {
      const emb = await embedSingle(text);
      embeddings.push(emb);
      await sleep(RATE_LIMIT_MS);
    }
    return embeddings;
  }

  const data = await response.json();
  return (data.embeddings || []).map(e => e.values || null);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Float32Array to Buffer for SQLite storage
function float32ToBuffer(arr) {
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

// Buffer to Float32Array
function bufferToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ─── Embed All Documents ──────────────────────────────────────────────────────
async function embedAll(db, force = false) {
  initDB(db);
  
  const filePaths = getFilePaths();
  console.log(`[embed] Found ${filePaths.length} files to process`);
  
  // Get existing docs for incremental update
  const existingStmt = db.prepare('SELECT path, chunk_index, updated_at FROM documents');
  const existing = new Map();
  for (const row of existingStmt.all()) {
    existing.set(`${row.path}:${row.chunk_index}`, row.updated_at);
  }
  
  let totalChunks = 0;
  let newChunks = 0;
  let skippedChunks = 0;
  let errorChunks = 0;
  
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO documents (path, chunk_index, content, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  // Process files in batches
  const batchQueue = []; // {path, chunk_index, content, text}
  
  for (const filePath of filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.trim().length < 10) continue; // Skip tiny files
      
      const stat = statSync(filePath);
      const mtime = stat.mtime.toISOString();
      const chunks = chunkText(content);
      
      for (let i = 0; i < chunks.length; i++) {
        totalChunks++;
        const key = `${filePath}:${i}`;
        const existingMtime = existing.get(key);
        
        if (!force && existingMtime && existingMtime >= mtime) {
          skippedChunks++;
          continue;
        }
        
        batchQueue.push({
          path: filePath,
          chunk_index: i,
          content: chunks[i],
          text: chunks[i],
          mtime,
        });
      }
    } catch (err) {
      console.error(`[embed] Error reading ${filePath}: ${err.message}`);
    }
  }
  
  console.log(`[embed] ${totalChunks} total chunks, ${newChunks} new, ${skippedChunks} up-to-date`);
  
  // Embed in batches
  for (let i = 0; i < batchQueue.length; i += BATCH_SIZE) {
    const batch = batchQueue.slice(i, i + BATCH_SIZE);
    const texts = batch.map(b => b.text);
    
    try {
      const embeddings = await embedBatch(texts);
      
      const insertMany = db.transaction((items) => {
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const emb = embeddings[j];
          if (emb) {
            insertStmt.run(
              item.path,
              item.chunk_index,
              item.content,
              float32ToBuffer(emb),
              item.mtime
            );
            newChunks++;
          } else {
            errorChunks++;
          }
        }
      });
      
      insertMany(batch);
      
      process.stdout.write(`\r[embed] Progress: ${Math.min(i + BATCH_SIZE, batchQueue.length)}/${batchQueue.length} chunks embedded`);
      
      // Rate limiting
      if (i + BATCH_SIZE < batchQueue.length) {
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err) {
      console.error(`\n[embed] Batch error: ${err.message}`);
      errorChunks += batch.length;
    }
  }
  
  console.log(`\n[embed] Done! ${newChunks} embedded, ${skippedChunks} up-to-date, ${errorChunks} errors out of ${totalChunks} total`);
  
  // Clean up docs for deleted files
  const allPaths = new Set(filePaths);
  const orphans = db.prepare('SELECT DISTINCT path FROM documents').all();
  let deletedCount = 0;
  for (const row of orphans) {
    if (!allPaths.has(row.path)) {
      db.prepare('DELETE FROM documents WHERE path = ?').run(row.path);
      deletedCount++;
    }
  }
  if (deletedCount > 0) console.log(`[embed] Removed ${deletedCount} orphaned file entries`);
  
  return { totalChunks, newChunks, skippedChunks, errorChunks, deletedCount };
}

// ─── Vector Search ─────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

async function vectorSearch(db, query, topK = 10) {
  const queryEmbedding = await embedSingle(query);
  if (!queryEmbedding) {
    console.error('[search] Failed to get query embedding');
    return [];
  }
  
  const rows = db.prepare('SELECT id, path, chunk_index, content, embedding FROM documents WHERE embedding IS NOT NULL').all();
  
  const results = [];
  for (const row of rows) {
    const docEmbedding = bufferToFloat32(row.embedding);
    const score = cosineSimilarity(queryEmbedding, docEmbedding);
    results.push({
      id: row.id,
      path: row.path,
      chunk_index: row.chunk_index,
      content: row.content,
      score,
    });
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ─── Hybrid Search (FTS5 + Vector) ────────────────────────────────────────────
function fts5Search(db, query, topK = 10) {
  // This would use the OpenClaw memory_search, but we provide a simple
  // text-matching fallback for standalone use
  const rows = db.prepare('SELECT id, path, chunk_index, content FROM documents').all();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  
  const results = [];
  for (const row of rows) {
    const text = row.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = (text.match(new RegExp(term, 'g')) || []).length;
      score += count;
    }
    if (score > 0) {
      results.push({
        id: row.id,
        path: row.path,
        chunk_index: row.chunk_index,
        content: row.content,
        score: score / terms.length, // Normalize by number of terms
        type: 'fts5',
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

async function hybridSearch(db, query, topK = 10) {
  // Run both searches
  const [vectorResults, ftsResults] = await Promise.all([
    vectorSearch(db, query, topK * 2),
    Promise.resolve(fts5Search(db, query, topK * 2)),
  ]);
  
  // Tag results by type
  const vResults = vectorResults.map(r => ({ ...r, type: 'vector' }));
  const fResults = ftsResults;
  
  // Merge with Reciprocal Rank Fusion (RRF)
  const k = 60; // RRF constant
  const scores = new Map();
  
  for (let i = 0; i < vResults.length; i++) {
    const r = vResults[i];
    const key = r.path;
    const current = scores.get(key) || { path: r.path, content: r.content, rrfScore: 0, vectorScore: 0, ftsScore: 0 };
    current.rrfScore += 1 / (k + i + 1);
    current.vectorScore = r.score;
    scores.set(key, current);
  }
  
  for (let i = 0; i < fResults.length; i++) {
    const r = fResults[i];
    const key = r.path;
    const current = scores.get(key) || { path: r.path, content: r.content, rrfScore: 0, vectorScore: 0, ftsScore: 0 };
    current.rrfScore += 1 / (k + i + 1);
    current.ftsScore = r.score;
    scores.set(key, current);
  }
  
  const merged = [...scores.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  return merged.slice(0, topK);
}

// ─── Status ────────────────────────────────────────────────────────────────────
function showStatus(db) {
  initDB(db);
  
  const total = db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
  const withEmbeddings = db.prepare('SELECT COUNT(*) as count FROM documents WHERE embedding IS NOT NULL').get().count;
  const paths = db.prepare('SELECT COUNT(DISTINCT path) as count FROM documents').get().count;
  const lastUpdated = db.prepare('SELECT MAX(updated_at) as latest FROM documents').get().latest;
  
  console.log(`\n📊 SecondCortex Vector Search Status`);
  console.log(`   Total chunks: ${total}`);
  console.log(`   With embeddings: ${withEmbeddings}`);
  console.log(`   Files indexed: ${paths}`);
  console.log(`   Last updated: ${lastUpdated || 'never'}`);
  console.log(`   Embedding model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMS} dims)`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Vault: ${VAULT_DIR}`);
  console.log(`   Memory: ${MEMORY_DIR}`);
  
  // File breakdown
  const byPath = db.prepare(`
    SELECT 
      CASE 
        WHEN path LIKE '%vault%' THEN 'vault'
        WHEN path LIKE '%memory%' THEN 'memory'
        ELSE 'other'
      END as category,
      COUNT(*) as chunks,
      COUNT(DISTINCT path) as files
    FROM documents
    GROUP BY category
  `).all();
  
  console.log(`\n   By category:`);
  for (const row of byPath) {
    console.log(`     ${row.category}: ${row.files} files, ${row.chunks} chunks`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2] || 'embed';
  
  // Ensure directory exists
  mkdirSync(join(DB_PATH, '..'), { recursive: true });
  const db = new Database(DB_PATH);
  
  switch (command) {
    case 'embed':
    case 'update': {
      const force = process.argv.includes('--force');
      const result = await embedAll(db, force);
      console.log('\n✅ Embedding complete:', result);
      break;
    }
    
    case 'search': {
      const query = process.argv.slice(3).join(' ');
      if (!query) {
        console.error('Usage: node embed.mjs search "your query"');
        process.exit(1);
      }
      console.log(`🔍 Searching for: "${query}"\n`);
      const results = await hybridSearch(db, query);
      for (const r of results) {
        const relPath = r.path.replace(WORKSPACE + '/', '');
        console.log(`  [${r.type || 'hybrid'}] ${relPath} (RRF: ${r.rrfScore?.toFixed(4) || 'N/A'}, vec: ${(r.vectorScore || 0).toFixed(3)}, fts: ${(r.ftsScore || 0).toFixed(2)})`);
        console.log(`    ${r.content.slice(0, 120).replace(/\n/g, ' ')}...`);
        console.log();
      }
      break;
    }
    
    case 'status': {
      showStatus(db);
      break;
    }
    
    default:
      console.log(`Usage: node embed.mjs [embed|search|status] [args]`);
      console.log(`  embed   — Embed all vault notes & memory files (incremental)`);
      console.log(`  search  — Hybrid vector + text search`);
      console.log(`  status  — Show embedding stats`);
  }
  
  db.close();
}

main().catch(err => {
  console.error('[embed] Fatal error:', err);
  process.exit(1);
});