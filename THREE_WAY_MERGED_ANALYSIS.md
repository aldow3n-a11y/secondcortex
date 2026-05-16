# SecondCortex: Three-Way Merged Analysis

**Date:** 2026-05-16
**Sources:** My research + DODO PKM analysis + Pipeline audit (3 models)
**Status:** Actionable roadmap

---

## What All Three Analyses Agree On

| Gap | Consensus |
|-----|-----------|
| No semantic/vector search | **All three**: FTS5 keyword-only is the #1 retrieval weakness |
| No procedural memory | **All three**: System captures facts, not workflows |
| Dreaming is broken/low-signal | **All three**: 0% promotion, 46KB narrative prose, candidates stuck at 0.58 |
| Saliency patterns are insufficient | **Two of three**: 21 regexes miss implicit insights |

## What Only One Analysis Caught (But Matters)

### Analysis 3 (Pipeline Audit) — CRITICAL FINDINGS

The **pipeline is actually broken**. This is the most important thing the other two missed:

| Issue | Status | Evidence |
|-------|--------|----------|
| FTS5 index massively undercounts | Confirmed | 93 chunks (my README says 12K+) |
| Queue items go stale | Was broken | Queue was 12 stale items, now 0 (flushed) |
| Dreaming 0% promotion rate | Confirmed | Last run: promoted 0, discarded 23 |
| Double dreaming cron conflict | **YES** | Memory Dreaming Promotion cron is enabled AND running successfully, but it's the wrong system — it's `memory-core`'s built-in dreaming, not SecondCortex |
| Backup cron broken | **YES** | 29 consecutive errors (`Bundled plugin dirName must be a single directory: telegram:239076102`) |
| Research Scout cron broken | **YES** | 15 consecutive errors (timeout + delivery issues) |

### Analysis 2 (DODO) — Structural Gaps

| Issue | Status | Priority |
|-------|--------|----------|
| Calendar/Journal empty | N/A | We don't use `vault/Calendar/` — our daily logs go to `memory/` |
| Efforts folder empty | N/A | We track projects in `PROJECTS/` not PARA-style |
| No typed note relationships | **Valid** | We use `[[wikilinks]]` but no `supports:/contradicts:` |
| No knowledge graph visualization | **Valid but low priority** | Mermaid in MOCs would help, Neo4j is overkill |
| No proactive surfacing | **Valid** | Agent should auto-query vault during conversations |

### My Analysis — Unique Contributions

| Issue | Priority |
|-------|----------|
| No conflict detection (contradictory facts coexist) | High |
| No bitemporal annotations (can't track fact evolution) | Medium |
| Landing page empty (can't distribute) | Low |
| No LLM-based fact extraction (triples) | Critical |

---

## Verified Current State (Reality Check)

| Metric | Claimed (README) | Actual | Status |
|--------|-------------------|--------|--------|
| FTS5 chunks | 12K+ | 93 | ❌ MASSIVELY OVERSTATED |
| Vault notes | 41 | 41 | ✅ Correct |
| MOCs | 8 | 8 | ✅ Correct |
| Queue items | 0 | 0 | ✅ Flushed |
| MEMORY.md | <5KB target | 9.25KB | ⚠️ Almost double target |
| DREAMS.md | N/A | 45.9KB | ⚠️ Bloated |
| Dreaming promotion | Working | 0% | ❌ BROKEN |

## Broken Cron Jobs

| Job | Schedule | Status | Problem |
|-----|----------|--------|---------|
| daily-backup | 3am daily | ❌ 29 errors | `Bundled plugin dirName must be a single directory: telegram:239076102` |
| Memory Dreaming Promotion | 4am daily | ✅ runs OK | **But wrong system** — memory-core's built-in dreaming, not SecondCortex |
| weekly-workspace-cleanup | Mon 3am | 🆕 Not run yet | Starts next Monday |
| weekly-pkm-consolidation | Mon 4am | 🆕 Not run yet | Starts next Monday |
| Research Scout: AI | 1am daily | ❌ 15 errors | Delivery format wrong |
| Research Scout: Automation | 4am daily | ❌ 15 errors | Timeout + delivery |
| SecondCortex system audit | May 20 | 🆕 One-shot | Pending |

---

## Unified Roadmap (Merged & Prioritized)

### 🔴 Phase 0: Fix Broken Pipeline (This Weekend)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 0.1 | Fix backup cron (delivery target format) | 5 min | Prevents data loss |
| 0.2 | Fix Research Scout crons | 10 min | Restores automated research |
| 0.3 | Verify weekly PKM consolidation runs Mon 4am | 5 min | Core pipeline |
| 0.4 | Fix FTS5 index (rebuild, expand directories) | 30 min | Search is broken |
| 0.5 | Trim MEMORY.md to <5KB (remove promotion blocks) | 15 min | Stated goal |
| 0.6 | Audit dreaming: why 0% promotion? Run manually, debug | 30 min | Core pipeline |

### 🟡 Phase 1: Semantic Extraction (Next Week)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1.1 | Add LLM extraction step to hook (Gemini Flash, Koda key) | 1 day | Core upgrade |
| 1.2 | Store structured triples in synthesis queue JSON | 2h | Enables P2, P3 |
| 1.3 | Add conflict detection on vault note creation | 4h | Prevents duplicate facts |
| 1.4 | Fix dreaming: replace narrative with structured extraction | 4h | Biggest signal improvement |

### 🟢 Phase 2: Vector Search (Week 2)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 2.1 | Embed vault notes with Gemini text-embedding-004 (free) | 2h | Semantic retrieval |
| 2.2 | Store embeddings in SQLite sidecar | 2h | Persistence |
| 2.3 | Hybrid search: merge FTS5 + embedding results | 4h | Best of both worlds |
| 2.4 | Add typed wikilinks (`supports:`, `contradicts:`, `extends:`) | 3h | Knowledge graph lite |

### 🔵 Phase 3: Procedural Memory & Polish (Week 3+)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 3.1 | Create `vault/Atlas/Procedures/` with typed notes | 2h | Captures workflows |
| 3.2 | Add bitemporal frontmatter to vault notes | 2h | Fact evolution tracking |
| 3.3 | Add recall tracking (log memory_search queries) | 2h | Feedback loop |
| 3.4 | Proactive vault surfacing during conversations | 4h | Active intelligence |
| 3.5 | Landing page + install script + v0.3 GitHub release | 4h | Distribution |

---

## Competitive Moat (Why SecondCortex Still Wins)

Despite the gaps, SecondCortex has advantages no competitor matches:

1. **Zero external dependencies** — no database, no API key needed for core operation
2. **Plain Markdown** — no vendor lock-in, git-trackable, human-readable
3. **Built for OpenClaw** — native hook integration, not a bolt-on
4. **Self-maintaining pipeline** — capture → distill → consolidate → cleanup runs automatically
5. **Works offline** — no network required for core operation

The gap is in **extraction quality** and **retrieval power**. Adding Gemini-powered extraction (free tier) and embedding search (free tier) closes this gap without sacrificing any of the advantages above.

---

## Decision Points

1. **Do we keep the memory-core dreaming cron?** It's running and "succeeding" but producing low-signal promotion blocks in MEMORY.md. Recommendation: **keep it** but have weekly cleanup strip its output. The SecondCortex dreaming will be the high-quality path once P1.4 is implemented.

2. **Do we switch to PARA (Projects/Areas/Resources/Archive)?** Analysis 2 suggested this. Recommendation: **No** — our current structure (`memory/` for logs, `vault/Atlas/` for notes, `PROJECTS/` for code) works fine. PARA adds complexity without clear benefit.

3. **Do we build a knowledge graph?** Recommendation: **Not yet** — typed wikilinks (Phase 2.4) give us 80% of the benefit at 10% of the cost. Neo4j is overkill for 41 notes.

4. **Multi-agent pipeline?** Analysis 3 suggested Observer/Distiller/Dreamer/Search agents. Recommendation: **No** — the hook + cron architecture already separates concerns. Adding agent orchestration for what's essentially 4 cron jobs is over-engineering.

---

*This document merges three independent analyses of SecondCortex. The merged roadmap prioritizes fixing broken infrastructure before adding new features.*