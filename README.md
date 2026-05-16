# SecondCortex 🧠

**A fully managed PKM (Personal Knowledge Management) system for AI assistants.**

SecondCortex gives your AI agent a structured, self-maintaining memory system — capture insights automatically via regex + LLM extraction, consolidate weekly, and retrieve anything via FTS5 + semantic search. No more forgetting, no more bloated memory files, no more manual note-taking.

## v3 Highlights

- **🆕 LLM Triple Extraction** — Gemini Flash extracts structured `(subject, relation, object)` triples from conversations, with confidence scoring and auto-categorization
- **🆕 Dual Pipeline** — Regex capture (21 patterns) for explicit markers + LLM extraction for implicit insights
- **🆕 Robotics Category** — Auto-tags robotics/embodied AI concepts
- **Structured Daily Logs** — Separate `## Distilled Insights` and `## Extracted Triples` sections
- **Free-tier friendly** — Gemini Flash free tier handles ~30 extractions/day easily
- **🆕 Vector Search** — 1,050 chunks embedded with Gemini Embedding-001 (3072 dims), hybrid RRF search combining FTS5 + cosine similarity
- **🆕 Procedural Memory** — Auto-extracts multi-step procedures from daily logs as vault notes (8 extracted from 10 days of logs)
- **🆕 Embedding Cron** — Daily incremental embedding at 3am WIB, weekly procedural extraction at 5am Mondays

## Why This Exists

AI assistants have a memory problem. They start every session fresh, relying on context files that grow unmanageably large. Raw conversation logs pile up. Important insights get buried. Memory files become dumping grounds instead of maps.

SecondCortex solves this with a proven pipeline: **automatic capture → daily distillation → weekly consolidation → structured retrieval**.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Conversation │────▶│ Saliency Capture │────▶│  Daily Log    │────▶│ Weekly Consolid. │
│  (any source)│     │  (hook, 21 pats) │     │ memory/YYYY/  │     │  (cron, Mon 4am) │
└──────────────┘     └──────────────────┘     └──────────────┘     └────────┬────────┘
                                                                                        │
                              ┌──────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌─────────────────┐     ┌──────────────┐
                     │  Vault Notes    │────▶│  MOC Index    │
                     │ vault/Atlas/Notes│     │ vault/Atlas/  │
                     │  (atomic, linked│     │   Maps/       │
                     └─────────────────┘     └──────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │   MEMORY.md     │
                     │  (map only,     │
                     │   pointers +    │
                     │   current state)│
                     └─────────────────┘
```

### The Pipeline

| Stage | Component | When | What |
|-------|-----------|------|------|
| **Capture (regex)** | Cortex Synthesis Hook | Real-time (on `message:sent`) | Scans for 21 saliency patterns, auto-tags by category, queues insights |
| **Capture (LLM)** | Cortex Synthesis Hook | Real-time (on `message:sent`) | Sends content to Gemini Flash for structured triple extraction |
| **Distill** | Hook (on `command:new`/`reset`) | Session end | Flushes queue → tagged entries + triples in daily log |
| **Dream** | Dreaming engine | Nightly (3-4am) | Light → REM → Deep phases, writes narratives to DREAMS.md |
| **Consolidate** | Weekly consolidation cron | Monday 4am | Scans 7 days of logs → creates/updates vault notes → links to MOCs |
| **Procedures** | Procedural extraction cron | Monday 5am | Scans logs for 3+ step procedures → saves as vault notes |
| **Embed** | Embedding cron | Daily 3am | Incrementally embeds vault notes + memory files with Gemini Embedding-001 |
| **Cleanup** | Weekly cleanup cron | Monday 3am | Archives old logs, removes caches, prunes orphans, deduplicates, checks disk |
| **Retrieve** | FTS5 + Vector search | Anytime | Hybrid RRF search: FTS5 text + cosine similarity across 1,050 embedded chunks |
1. **MEMORY.md is the map, not the territory.** Pointers and current state only. Detailed facts live in vault notes.
2. **Notes are atomic and linked.** Each vault note covers one concept. `[[wikilinks]]` create the knowledge graph.
3. **MOCs (Maps of Content) are the index.** Each domain has a MOC that groups related notes with 1-line descriptions.
4. **Auto-capture, manual-quality consolidation.** The hook captures raw; the weekly cron distills into proper notes.
5. **Category tagging.** Every captured insight is auto-tagged: infrastructure, bug, decision, model, security, pkm, robotics, or general.
6. **Procedural memory.** Multi-step procedures are auto-extracted as reusable vault notes with `type: procedure`.
7. **Hybrid retrieval.** FTS5 keyword search + vector cosine similarity, merged via Reciprocal Rank Fusion (RRF).

## Vector Search (P2)

SecondCortex embeds all vault notes and memory files using **Gemini Embedding-001** (3072 dimensions, free tier) and stores embeddings in a local SQLite database.

**Features:**
- **Incremental embedding** — only processes new/changed files
- **Hybrid RRF search** — merges FTS5 keyword results with vector similarity using Reciprocal Rank Fusion (k=60)
- **3072-dimension embeddings** — high-quality semantic matching
- **Daily cron** — keeps embeddings fresh at 3am WIB

```bash
# Embed all files
node PROJECTS/secondcortex/vector/embed.mjs embed

# Search
node PROJECTS/secondcortex/vector/embed.mjs search "nginx prefix match"

# Status
node PROJECTS/secondcortex/vector/embed.mjs status
```

## Procedural Memory (P3)

SecondCortex auto-extracts multi-step procedures from daily conversation logs using **Gemini Flash**. Each procedure is saved as a vault note with `type: procedure`, containing:
- Title, summary, and tags
- Numbered steps with actionable details
- Prerequisites
- Source date and confidence score

**Features:**
- Extracts procedures with 3+ clear steps
- Confidence threshold ≥ 0.7
- Deduplicates against existing vault notes
- Weekly cron runs at 5am Monday WIB

```bash
# Extract from last 7 days
node PROJECTS/secondcortex/procedural/extract-procedures.mjs --days=7

# Dry run (no files written)
node PROJECTS/secondcortex/procedural/extract-procedures.mjs --dry-run --days=7
```

## Directory Structure

```
~/.openclaw/workspace/
├── MEMORY.md                    # Map file — pointers + current state (keep <5KB)
├── DREAMS.md                    # Dreaming narratives (auto-generated)
├── HEARTBEAT.md                 # Heartbeat checklist
├── memory/
│   ├── 2026-05-13.md            # Daily logs (archived after 14 days)
│   └── heartbeat-state.json     # Check state tracking
├── vault/
│   └── Atlas/
│       ├── Notes/                # Atomic knowledge notes (the territory)
│       │   ├── Gateway-Silent-Failure.md
│       │   ├── Mba-Warung.md
│       │   └── ...
│       └── Maps/                 # MOC index files
│           ├── AI MOC.md
│           ├── Business MOC.md
│           └── ...
├── hooks/
│   └── cortex-synthesis/        # Saliency capture hook
│       ├── handler.ts           # (or .js) The hook logic
│       └── HOOK.md              # Hook manifest
└── PROJECTS/
    └── secondcortex/            # This repo
        ├── README.md
        ├── hooks/
        │   ├── cortex-synthesis.js
        │   └── HOOK.md
        ├── scripts/
        │   └── weekly-consolidation.sh
        ├── templates/
        │   ├── note-template.md
        │   └── moc-template.md
        ├── docs/
        │   └── comparison.md
        └── landing/
            └── index.html
```

## Setup

### 1. Install the Hook

```bash
# Copy the hook to your OpenClaw hooks directory
cp -r hooks/cortex-synthesis ~/.openclaw/workspace/hooks/

# Verify hook is registered
openclaw hooks list
```

### 2. Set Up Cron Jobs

```bash
# Weekly PKM consolidation (Monday 4am)
openclaw cron add --name "weekly-pkm-consolidation" \
  --schedule "0 4 * * 1" --tz "Asia/Jakarta" \
  --message "Weekly PKM consolidation..." \
  --session-target isolated

# Weekly workspace cleanup (Monday 3am)
openclaw cron add --name "weekly-workspace-cleanup" \
  --schedule "0 3 * * 1" --tz "Asia/Jakarta" \
  --message "Weekly workspace cleanup..." \
  --session-target isolated
```

### 3. Configure Dreaming

In your `openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "memory-core": {
        "config": {
          "dreaming": {
            "enabled": true,
            "timezone": "Asia/Jakarta",
            "frequency": "0 4 * * *",
            "storage": {
              "mode": "separate"
            },
            "phases": {
              "light": { "lookbackDays": 3, "limit": 150 },
              "rem": { "lookbackDays": 7, "limit": 10, "minPatternStrength": 0.75 },
              "deep": { "minRecallCount": 2, "minUniqueQueries": 2, "minScore": 0.8, "limit": 10, "recencyHalfLifeDays": 14, "maxAgeDays": 30 }
            }
          }
        }
      }
    }
  }
}
```

> **Important:** Set `storage.mode` to `"separate"` so dreaming writes to DREAMS.md only, not MEMORY.md. This keeps your map file clean.

### 4. Create Your Vault Structure

```bash
mkdir -p vault/Atlas/Notes vault/Atlas/Maps memory
```

### 5. Use the Templates

When creating new notes, use the templates in `templates/`:
- `note-template.md` — for atomic knowledge notes
- `moc-template.md` — for Maps of Content

## Saliency Patterns

SecondCortex captures insights using 21 patterns across two categories:

### Explicit Markers (7)
Say these in conversation and the hook captures them:
- `remember this:` / `core truth:` / `lesson learned:`
- `critical decision:` / `correction:` / `update memory:`
- `important to note that`

### Implicit Patterns (14)
Automatically detected without markers:
- Root cause: `root cause was/is`, `the issue was/is`, `the problem was/is`
- Fix markers: `fixed:`, `fix:`, `workaround:`
- Decisions: `decided`, `chose`, `went with`, `switching to`
- Imperatives: `never again/do/use`, `always use/do/prefer`, `make sure to/you`
- Insight: `key insight/finding/takeaway:`, `this means/implies/suggests`
- Gotchas: `gotcha:`, `don't forget:`

### Auto-Categorization

Each captured insight is tagged:
| Category | Trigger Words |
|----------|--------------|
| infrastructure | nginx, server, VPS, deploy, DNS, SSL, docker, systemd |
| bug | root cause, fix, issue, error, 500, 401, crash |
| decision | decided, chose, went with, will use, switching to |
| model | model, provider, ollama, gemini, claude, gpt, glm |
| security | secret, key, credential, password, auth, token, perm |
| pkm | note, vault, memory, MOC, zettelkasten, obsidian |
| general | (default when no category matches) |

## Comparison with Other PKM Systems

See [docs/comparison.md](docs/comparison.md) for a detailed comparison with Obsidian, Notion, Roam Research, Logseq, Tana, and Cosense/Scrapbox.

**TL;DR:** SecondCortex is the only PKM designed specifically for AI assistants — it captures automatically, consolidates without manual effort, and maintains itself. Traditional PKM tools require you to manually create and link every note.

## License

MIT

## Credits

Built for [OpenClaw](https://github.com/openclaw/openclaw) agents. Inspired by Zettelkasten, PARA, and LYT methodologies.