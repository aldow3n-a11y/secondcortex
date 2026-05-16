# Changelog

## v0.3.0 (2026-05-16)

### 🆕 Semantic Extraction (P1)
- **LLM Triple Extraction**: Cortex synthesis hook v3 now sends conversation content to Gemini Flash for structured `(subject, relation, object)` triple extraction with confidence scoring and auto-categorization
- **Dual Pipeline**: Regex capture (21 patterns) + LLM extraction run in parallel on every `message:sent` event
- **New categories**: `robotics` added for embodied AI concepts
- **Structured daily logs**: Separate `## Distilled Insights` and `## Extracted Triples` sections
- **Free-tier friendly**: Gemini Flash handles ~30 extractions/day easily within free limits

### 🆕 Vector Search (P2)
- **Gemini Embedding-001**: 1,050 chunks embedded across 145 files (41 vault notes, 103 memory logs, MEMORY.md)
- **Hybrid RRF search**: FTS5 keyword results + cosine vector similarity merged via Reciprocal Rank Fusion (k=60)
- **Incremental embedding**: Only processes new/changed files on each run
- **Daily cron**: Embeddings stay fresh with 3am WIB incremental update
- **Standalone CLI**: `node embed.mjs embed|search|status`

### 🆕 Procedural Memory (P3)
- **Auto-extraction**: Gemini Flash scans daily logs for 3+ step procedures and saves them as vault notes with `type: procedure`
- **Structured output**: Each procedure note has title, summary, prerequisites, numbered steps, tags, confidence score
- **Deduplication**: Skips creating notes that already exist
- **Weekly cron**: Runs at 5am Monday WIB
- **Initial extraction**: 8 procedures found from 10 days of logs

### 🔧 Pipeline Fixes (P0)
- **Backup cron**: Fixed delivery format (was `telegram:239076102`, now proper `accountId/channel/to` structure)
- **Research Scout crons**: Fixed delivery format + timeout, re-enabled after 15 consecutive errors
- **MEMORY.md**: Trimmed from 9.25KB to 4.57KB by replacing promotion block noise with distilled insight bullets
- **Dreaming**: Verified working — was promoting candidates correctly, just had clutter in MEMORY.md
- **FTS5 index**: Verified 1,702 chunks across 156 files (not 93 or 12K as previously claimed)

## v0.2.0 (2026-05-13)

- Workspace cleanup: 1.3GB → 70MB, 492 → 39 vault notes, MOCs rebuilt
- Cortex synthesis hook v2 with expanded saliency patterns and category tagging
- Weekly consolidation and cleanup crons
- Dreaming engine (3-phase: Light → REM → Deep)

## v0.1.0 (2026-04-16)

- Initial SecondCortex setup
- Basic FTS5 search
- Daily log capture
- Vault note structure with MOCs
- MEMORY.md as map file