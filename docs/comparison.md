# SecondCortex vs Other PKM Systems

## What is PKM?

Personal Knowledge Management — the practice of capturing, organizing, and retrieving knowledge. The core challenge: information goes in, but can you find it when you need it?

## Comparison Matrix

| Feature | SecondCortex | Obsidian | Notion | Roam | Logseq | Tana | Cosense |
|---------|-------------|----------|--------|------|--------|------|---------|
| **Designed for** | AI assistants | Humans | Humans | Humans | Humans | Humans | Teams |
| **Auto-capture** | ✅ 21 patterns + categories | ❌ Manual | ❌ Manual | ❌ Manual | ❌ Manual | ⚠️ AI assist | ⚠️ AI assist |
| **Auto-consolidation** | ✅ Weekly cron | ❌ Manual | ❌ Manual | ❌ Manual | ❌ Manual | ⚠️ AI move | ❌ Manual |
| **Auto-cleanup** | ✅ Weekly cron | ❌ Manual | ❌ Manual | ❌ Manual | ❌ Manual | ❌ Manual | ❌ Manual |
| **Self-maintaining** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Bidirectional links** | ✅ `[[wikilinks]]` | ✅ `[[wikilinks]]` | ⚠️ Mentions | ✅ `((()))` | ✅ `[[wikilinks]]` | ✅ Links | ✅ Links |
| **Maps of Content** | ✅ MOCs | ⚠️ Manual | ❌ No | ⚠️ Tags | ⚠️ Tags | ✅ Supertags | ⚠️ Pages |
| **Atomic notes** | ✅ Enforced | ⚠️ Optional | ❌ No | ❌ No | ⚠️ Optional | ❌ Hierarchical | ❌ Pages |
| **Semantic search** | ✅ FTS5 12k+ chunks | ⚠️ Plugin | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic |
| **Dreaming/consolidation** | ✅ 3-phase overnight | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Saliency detection** | ✅ Auto-tagged | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Zero-config start** | ✅ Yes | ⚠️ Setup | ⚠️ Setup | ⚠️ Setup | ⚠️ Setup | ⚠️ Waitlist | ⚠️ Setup |
| **Runs locally** | ✅ Yes | ✅ Yes | ❌ Cloud | ❌ Cloud | ✅ Yes | ❌ Cloud | ❌ Cloud |
| **Free tier** | ✅ Fully free | ✅ Free | ⚠️ Limited | ⚠️ Limited | ✅ Free | ❌ Paid | ⚠️ Limited |
| **API/Automation** | ✅ Native | ⚠️ Plugin | ✅ API | ⚠️ API | ⚠️ Plugin | ✅ API | ✅ API |
| **Vendor lock-in** | ✅ Plain Markdown | ⚠️ .obsidian | ❌ DB | ⚠️ JSON | ✅ Plain MD | ❌ DB | ❌ DB |
| **Offline** | ✅ Yes | ✅ Yes | ❌ No | ❌ No | ✅ Yes | ❌ No | ❌ No |

## Key Differentiators

### 1. Built for Agents, Not Humans

Traditional PKM assumes a human sitting at a keyboard manually creating notes. SecondCortex assumes the agent IS the user. It captures automatically, consolidates on schedule, and maintains itself.

### 2. Self-Maintaining

No system works if you don't maintain it. SecondCortex has three self-maintenance layers:
- **Daily**: Hook captures insights and distills to logs
- **Nightly**: Dreaming engine consolidates patterns
- **Weekly**: Cron creates vault notes, links MOCs, cleans orphans, deduplicates

### 3. The Map Is Not The Territory

Most PKM systems have one big file that becomes a dumping ground. SecondCortex enforces a strict separation:
- `MEMORY.md` = the map (pointers + current state, <5KB)
- `vault/Atlas/Notes/` = the territory (detailed atomic notes)
- `vault/Atlas/Maps/` = the index (MOCs with 1-line descriptions)

### 4. Saliency-Based Capture

Instead of "remember everything" or "write it down manually", SecondCortex uses 21 saliency patterns to detect what's worth capturing. It auto-tags by category and stores tagged entries in daily logs.

### 5. No Vendor Lock-In

Everything is plain Markdown files in a git-tracked workspace. No proprietary databases, no cloud dependencies. Your knowledge is yours.

## When to Use What

| If you need... | Use |
|----------------|-----|
| AI agent memory that maintains itself | **SecondCortex** |
| Rich note-taking with plugins | Obsidian |
| Team knowledge base | Notion |
| Bidirectional outlining | Roam Research |
| Outliner with org-mode flavor | Logseq |
| Structured hierarchical knowledge | Tana |
| Community knowledge base | Cosense/Scrapbox |

## Methodology Influences

SecondCortex draws from three proven PKM methodologies:

- **Zettelkasten** (Niklas Luhmann): Atomic notes with unique IDs and bidirectional links
- **PARA** (Tiago Forte): Projects, Areas, Resources, Archives — action-oriented sorting
- **LYT** (Nick Milo): Maps of Content as emergent structure, linking thinking

The key insight from all three: **your knowledge system should grow organically, not be imposed top-down**. SecondCortex automates the maintenance so the organic growth actually happens.