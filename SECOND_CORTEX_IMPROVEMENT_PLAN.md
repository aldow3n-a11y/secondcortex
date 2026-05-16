# SecondCortex Improvement Plan

**Date:** 2026-05-16  
**Status:** Research & Analysis  
**Repository:** `PROJECTS/secondcortex/`

---

## Current State

### What Works
- **Saliency capture hook** (21 patterns) — auto-tags insights on `message:sent`
- **Daily log distillation** — flushes queue to `memory/YYYY-MM-DD.md`
- **Dreaming engine** — 3-phase overnight (Light → REM → Deep)
- **Weekly consolidation** — vault notes + MOCs + cleanup
- **FTS5 search** — 12k+ indexed chunks across memory/, vault/, workspace/
- **MEMORY.md as map** — 9.2KB, 41 vault notes, 8 MOCs

### Architecture (Current)

```
Conversation → Saliency Hook → Queue JSON → Daily Log → Weekly Consolidation → Vault Notes + MOCs
                     ↓                              ↓
              21 regex patterns              Dreaming (3-phase overnight)
                                              ↓
                                         DREAMS.md (46KB narrative)
```

### Key Weaknesses

| # | Gap | Impact |
|---|-----|--------|
| 1 | No semantic extraction — captures raw text, not structured triples | Facts are unsearchable, unmergeable, unresolvable |
| 2 | No conflict detection — contradictory facts coexist | "VPS password is X" next to "VPS password is Y" |
| 3 | No temporal reasoning — no way to ask "what changed between March and now?" | Can't track fact evolution |
| 4 | Saliency patterns too rigid — 21 regexes miss implicit insights | "the server moved to a new IP" → no capture |
| 5 | No procedural memory — captures facts, not workflows | "always validate JSON before calling API Y" = lost |
| 6 | Dreaming output is narrative, not structural | 46KB of prose, low-signal promotion candidates (score ~0.58) |
| 7 | No vector search — FTS5 is keyword-only | "reverse proxy setup" won't match "nginx config" |
| 8 | No cross-session fact merging | Insights siloed per day, no dedup |

---

## Competitive Landscape

| System | Fact Extraction | Vector Search | Temporal | Conflict Detection | Self-Hosting | License |
|--------|----------------|---------------|----------|-------------------|-------------|---------|
| **SecondCortex** | ❌ Regex only | ❌ FTS5 only | ❌ | ❌ | ✅ Full | MIT |
| **Mem0** | ✅ LLM triples | ✅ Built-in | ⚠️ Basic | ✅ Merge/update | ✅ OSS | MIT |
| **Zep/Graphiti** | ✅ LLM triples | ✅ + Graph | ✅ Bitemporal | ✅ Yes | ✅ Community | Apache |
| **Letta/MemGPT** | ✅ Runtime paging | ✅ Built-in | ❌ | ⚠️ Core memory | ✅ OSS | Apache |
| **Cognee** | ✅ 6-stage pipeline | ✅ + Knowledge Graph | ❌ | ✅ Pruning | ✅ OSS | Apache |

### SecondCortex Advantage
- Built for OpenClaw, runs locally, zero external dependencies
- Plain Markdown (no vendor lock-in, no DB requirement)
- Self-maintaining pipeline (hook → distill → consolidate → cleanup)
- Works offline, no API keys needed for core operation

### SecondCortex Disadvantage
- Extraction quality is regex-level (misses nuance, implicit info)
- Retrieval is keyword-level (no semantic similarity)
- No fact lifecycle management (conflicts, staleness, merging)

---

## Improvement Priorities

### P0: Semantic Fact Extraction

**Problem:** The hook captures raw text lines. No structure, no merging, no conflict resolution.

**Solution:** Add LLM-based extraction step that produces `(subject, relation, object)` triples.

```
Current: "root cause was nginx prefix match" → captured as raw text string
Better:  {subject: "nginx", relation: "root_cause", object: "prefix match priority"} → structured, searchable, mergeable
```

**Implementation:**
- Use Gemini Flash (free tier, Koda API key) for extraction
- Add extraction step after saliency capture, before queue write
- Store triples alongside raw text in queue JSON
- Extract: entity, relationship, value, confidence, category, source timestamp

**Cost:** ~0.1-0.5 tokens per insight on Gemini Flash free tier (2 RPM is fine for this)

**Example extraction prompt:**
```
Given this conversation snippet, extract atomic facts as (subject, relation, object) triples.
Return JSON array. Include timestamp and confidence (0-1).

Snippet: "the root cause was nginx prefix match priority — ^~ ensures longer prefix wins over root location /"
Output:
[
  {"subject": "nginx", "relation": "root_cause", "object": "prefix match priority", "confidence": 0.95, "category": "bug"},
  {"subject": "nginx ^~", "relation": "ensures", "object": "longer prefix wins over root /", "confidence": 0.9, "category": "infrastructure"}
]
```

---

### P1: Vector Search (Embedding-Based Retrieval)

**Problem:** FTS5 is keyword-only. "reverse proxy setup" won't match "nginx configuration."

**Solution:** Index vault notes with embeddings using Gemini's free embedding API.

**Implementation:**
- Use `text-embedding-004` (Gemini, free tier, 3072-dim) via the Koda key
- Store embeddings in SQLite with `sqlite-vec` extension or a JSON sidecar file
- On `memory_search`, run embedding similarity alongside FTS5, merge results
- Batch-embed existing vault notes as a one-time migration

**API call:**
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent" \
  -H "X-goog-api-key: $KODA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "models/text-embedding-004", "content": {"parts": [{"text": "nginx prefix match priority ensures longer prefix wins"}]}}'
```

**Free tier limits:** ~1500 RPM for embeddings — more than enough for indexing ~40 vault notes.

---

### P2: Conflict Detection & Fact Merging

**Problem:** Contradictory facts coexist in vault notes without any resolution.

**Solution:** Before writing a vault note, search for existing notes on the same subject. If found, compare and either update or flag.

**Implementation:**
- On vault note creation: search existing notes by subject entity
- If match found:
  - If facts agree → reinforce confidence
  - If facts contradict → create new version with `supersedes: [[old-note]]` link, mark old as `status: superseded`
  - If uncertain → flag in `synthesis_queue.json` for manual review
- Add frontmatter to vault notes:
  ```yaml
  ---
  subject: nginx
  observed_at: 2026-05-16
  valid_from: 2026-05-16
  valid_to: null
  confidence: 0.95
  supersedes: null
  status: active
  ---
  ```

---

### P3: Procedural Memory Layer

**Problem:** The system captures facts but not *how to do things*. No learned workflows.

**Solution:** Add a `procedures/` directory alongside vault notes, storing executable instructions.

**Implementation:**
- New directory: `vault/Atlas/Procedures/`
- Each procedure is a markdown file with:
  - Trigger condition (when to apply)
  - Steps (ordered instructions)
  - Prerequisites
  - Gotchas
- Example: `vault/Atlas/Procedures/deploy-nginx-reverse-proxy.md`
- Auto-capture: when the agent follows a multi-step process successfully, extract it as a procedure
- Injection: relevant procedures are loaded into session context based on current task

**We already have `.learnings.jsonl` per project.** This extends it to a global, searchable, structured procedure store.

---

### P4: Fix Dreaming — Structural Output

**Problem:** DREAMS.md is 46KB of narrative prose. Low signal-to-noise. Promotion candidates sit at score ~0.58-0.62, mostly "staged" forever. The `openclaw-memory-promotion` blocks in MEMORY.md are clutter.

**Solution:** Replace narrative dreaming with structured fact extraction.

**Current flow:**
```
Raw logs → Light/REM/Deep phases → DREAMS.md (narrative) → promotion candidates (low quality)
```

**Better flow:**
```
Raw logs → LLM extraction → structured triples → confidence scoring → direct vault note creation
```

**Implementation:**
- Add a `dreaming-extract` step that runs a focused extraction prompt
- Output: structured JSON with `{subject, relation, object, confidence, source, category}`
- Skip narrative entirely for high-confidence facts (confidence > 0.85) → create vault notes directly
- Keep narrative for low-confidence items → still goes to DREAMS.md for manual review
- Strip `openclaw-memory-promotion` blocks from MEMORY.md during weekly cleanup (they belong in vault notes)

---

### P5: Bitemporal Annotations

**Problem:** No way to track when facts were observed or when they stopped being true.

**Solution:** Add `observed_at` and `valid_from/valid_to` to all vault notes.

**Implementation:**
- Every vault note gets frontmatter:
  ```yaml
  observed_at: 2026-05-16T14:00:00+07:00
  valid_from: 2026-05-16
  valid_to: null  # null = still current
  ```
- When a fact is superseded, set `valid_to` on the old note
- Enables queries like "what did we know about X in March?" → filter by `valid_from <= date AND (valid_to >= date OR valid_to IS null)`

---

### P6: Landing Page & Packaging

**Problem:** The `landing/` directory is empty. No install path for other users.

**Solution:**
- Build a proper landing page using the frontend-design skill
- Add one-liner install: `openclaw hooks install secondcortex`
- Write a 5-minute quickstart guide
- Add npm package or at minimum a shell install script
- Ship v0.3 to GitHub with proper release notes

---

## Implementation Roadmap

| Phase | Priority | Effort | Impact | Depends On |
|-------|----------|--------|--------|-------------|
| P0: Semantic Extraction | Critical | 2-3 days | High | Koda API key ✅ |
| P1: Vector Search | High | 1-2 days | High | P0 (triples to embed) |
| P2: Conflict Detection | High | 1-2 days | High | P0 (structured triples) |
| P4: Fix Dreaming | Medium | 1 day | Medium | P0 (reuse extraction prompt) |
| P3: Procedural Memory | Medium | 2 days | Medium | None |
| P5: Bitemporal Annotations | Low | 1 day | Medium | P2 (needs structured notes first) |
| P6: Landing Page | Low | 0.5 day | Low (distribution) | None |

**Recommended order:** P0 → P4 → P1 → P2 → P3 → P5 → P6

---

## Architecture (Proposed v0.3)

```
Conversation
     │
     ▼
┌─────────────────────────┐
│  Saliency Hook (regex)  │ ← still useful for explicit markers
│  + LLM Extraction Step  │ ← NEW: extracts (subject, relation, object) triples
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Synthesis Queue (JSON) │ ← now includes triples + confidence + category
└────────────┬────────────┘
             │
     ┌───────┴────────┐
     ▼                 ▼
┌──────────┐   ┌──────────────┐
│Daily Log │   │ Structured    │
│(raw text)│   │ Extraction DB │ ← NEW: triples store
└──────────┘   └──────┬───────┘
                       │
         ┌─────────────┤─────────────┐
         ▼             ▼             ▼
   ┌──────────┐  ┌──────────┐  ┌──────────────┐
   │Vault Notes│  │Embeddings│  │Procedures    │
   │(atomic,  │  │(vector   │  │(learned      │
   │ linked,  │  │ search)  │  │ workflows)   │
   │ temporal)│  │          │  │              │
   └────┬─────┘  └────┬─────┘  └──────┬───────┘
        │              │               │
        └──────┬───────┴───────┬──────┘
               ▼               ▼
         ┌──────────┐   ┌──────────┐
         │   MOCs   │   │MEMORY.md │
         │(index)   │   │(map only)│
         └──────────┘   └──────────┘
```

**Key change:** The extraction step produces structured triples that flow into a searchable, mergeable, temporal store. The daily log still captures raw text for context, but facts are now first-class citizens.

---

## API Costs Estimate (Gemini Free Tier, Koda Key)

| Operation | Model | Free Tier Limit | Estimated Usage |
|-----------|-------|----------------|-----------------|
| Fact extraction | Gemini Flash | ~15 RPM, free | ~10-30 calls/day |
| Embeddings | text-embedding-004 | ~1500 RPM, free | ~50-100 calls/day |
| Total daily cost | — | $0 | Well within limits |

---

## Key Research References

- **Zylos Research** (Apr 2026): "AI Agent Memory Architectures: From Context Windows to Persistent Knowledge" — three-tier taxonomy (episodic, semantic, procedural), hybrid vector-graph stores emerging as standard
- **Mem0** (48k GitHub stars, $24M funding): Fact-extraction-first, vector+graph storage, conflict detection. Most deployed semantic memory layer.
- **Zep/Graphiti**: Bitemporal knowledge graph. Best for temporal reasoning ("what changed between March and now?")
- **Letta/MemGPT**: Memory-first agent runtime. Tightly coupled model+memory, harder to use with other frameworks.
- **Cognee**: 6-stage cognify pipeline (classify → extract → triplet → summarize → embed → commit). Self-improving knowledge structure.
- **Continuum Memory** (Jan 2026, arXiv): RAG is default but insufficient; hierarchical memory (in-context → compressed → persistent) is production consensus.

---

## Bottom Line

SecondCortex's architecture is sound. The pipeline works. The gap is in **extraction quality** and **retrieval power** — not architecture. Adding semantic fact extraction (P0) and vector search (P1) would put it on par with Mem0's core offering while keeping the zero-dependency, plain-Markdown advantage. Fixing dreaming output (P4) is the quickest win for signal-to-noise.

The competitive moat: **SecondCortex is the only PKM that's built for AI agents, runs locally with zero external dependencies, and uses plain Markdown.** Every competitor requires a database, an API key, or a managed service. We just need to make the extraction and retrieval smarter.