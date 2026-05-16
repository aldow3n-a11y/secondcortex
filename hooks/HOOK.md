---
name: cortex-synthesis
description: "SecondCortex saliency capture hook — captures insights from conversations with auto-categorization"
metadata:
  { "openclaw": { "emoji": "🧠", "events": ["message:sent", "command:new", "gateway:startup"], "requires": { "bins": ["node"] } } }
---

# Cortex Synthesis Hook (SecondCortex v2)

Part of the SecondCortex PKM system. Event-driven insight capture and distillation.

## What It Does

**On `message:sent`**: Scans assistant output for 21 saliency patterns (explicit + implicit). Stages matches to a queue with auto-categorization tags.

**On `command:new` / `command:reset`**: Processes queued insights, appends tagged entries to daily log, clears queue.

**On `gateway:startup`**: Flushes any orphaned queue items from crashed/interrupted sessions.

## Saliency Patterns (v2)

### Explicit Markers (7)
`remember this:`, `core truth:`, `lesson learned:`, `critical decision:`, `correction:`, `update memory:`, `important to note that`

### Implicit Insight Patterns (14)
- Root cause: `root cause was/is`, `the issue was/is`, `the problem was/is`
- Fix markers: `fixed:`, `fix:`, `workaround:`
- Decision language: `decided`, `chose`, `went with`, `switching to`
- Imperatives: `never again/do/use`, `always use/do/prefer`, `make sure to/you`
- Insight language: `key insight/finding/takeaway:`, `this means/implies/suggests`
- Gotchas: `gotcha:`, `don't forget:`

## Category Auto-Tagging

Each captured insight is auto-tagged:
- `infrastructure` — nginx, server, VPS, deploy, DNS, SSL, docker, systemd
- `bug` — root cause, fix, issue, error, 500, 401, crash
- `decision` — decided, chose, went with, will use, switching to
- `model` — model, provider, ollama, gemini, claude, gpt, glm
- `security` — secret, key, credential, password, auth, token, perm
- `pkm` — note, vault, memory, MOC, zettelkasten, obsidian
- `general` — default when no category matches

## Pipeline Flow

```
Message → Observe (saliency + tags) → Queue → Distill → Daily Log
                                                ↓
                                    Weekly consolidation → vault notes
```

This hook captures and distills to daily logs only. Vault note creation and MOC linking happens in the weekly consolidation cron job.