#!/usr/bin/env bash
# SecondCortex — Weekly PKM Consolidation
# Scans daily logs, creates/updates vault notes, links to MOCs, strips MEMORY.md promotions
set -euo pipefail

WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
MEMORY_DIR="$WORKSPACE/memory"
VAULT_NOTES="$WORKSPACE/vault/Atlas/Notes"
VAULT_MAPS="$WORKSPACE/vault/Atlas/Maps"
MEMORY_FILE="$WORKSPACE/MEMORY.md"
LOG_FILE="$WORKSPACE/memory/consolidation-$(date +%Y-%m-%d).log"

echo "=== SecondCortex Weekly Consolidation — $(date) ===" | tee "$LOG_FILE"

# 1. Archive daily logs older than 14 days
echo "" | tee -a "$LOG_FILE"
echo "--- Archiving old daily logs ---" | tee -a "$LOG_FILE"
ARCHIVE_DIR="$HOME/memory-archive"
mkdir -p "$ARCHIVE_DIR"
COUNT=0
find "$MEMORY_DIR" -name "2026-*.md" -type f | while read f; do
  # Check if older than 14 days
  FILEDATE=$(basename "$f" .md | cut -c1-10)
  if [[ "$FILEDATE" < "$(date -d '-14 days' +%Y-%m-%d)" ]]; then
    mv "$f" "$ARCHIVE_DIR/"
    COUNT=$((COUNT + 1))
    echo "  Archived: $(basename $f)"
  fi
done
echo "Archived $COUNT old daily logs" | tee -a "$LOG_FILE"

# 2. Strip openclaw-memory-promotion blocks from MEMORY.md
echo "" | tee -a "$LOG_FILE"
echo "--- Stripping promotion blocks from MEMORY.md ---" | tee -a "$LOG_FILE"
BEFORE=$(wc -c < "$MEMORY_FILE")
python3 -c "
import re, sys
with open('$MEMORY_FILE', 'r') as f:
    content = f.read()
# Remove openclaw-memory-promotion blocks (multi-line)
cleaned = re.sub(r'<!-- openclaw-memory-promotion:.*?-->\n*', '', content, flags=re.DOTALL)
# Remove any leftover '## Promoted From Short-Term Memory' sections with no content
cleaned = re.sub(r'## Promoted From Short-Term Memory.*?(?=\n##|\n§|\Z)', '', cleaned, flags=re.DOTALL)
# Clean up multiple blank lines
cleaned = re.sub(r'\n{4,}', '\n\n\n', cleaned)
with open('$MEMORY_FILE', 'w') as f:
    f.write(cleaned)
" 2>/dev/null
AFTER=$(wc -c < "$MEMORY_FILE")
echo "MEMORY.md: ${BEFORE}B → ${AFTER}B (saved $(( BEFORE - AFTER ))B)" | tee -a "$LOG_FILE"

# 3. Find orphan vault notes (not referenced from any MOC)
echo "" | tee -a "$LOG_FILE"
echo "--- Checking for orphan vault notes ---" | tee -a "$LOG_FILE"
ORPHANS=0
for note in "$VAULT_NOTES"/*.md; do
  NOTE_NAME=$(basename "$note" .md)
  FOUND=false
  for moc in "$VAULT_MAPS"/*.md; do
    if grep -q "\[\[${NOTE_NAME}\]\]" "$moc" 2>/dev/null; then
      FOUND=true
      break
    fi
  done
  if [[ "$FOUND" == "false" ]]; then
    # Check MEMORY.md too
    if ! grep -q "$NOTE_NAME" "$MEMORY_FILE" 2>/dev/null; then
      echo "  ORPHAN: $NOTE_NAME (not in any MOC or MEMORY.md)"
      ORPHANS=$((ORPHANS + 1))
    fi
  fi
done
echo "Found $ORPHANS orphan notes" | tee -a "$LOG_FILE"

# 4. Remove caches and temp files
echo "" | tee -a "$LOG_FILE"
echo "--- Cleaning caches ---" | tee -a "$LOG_FILE"
find "$WORKSPACE" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$WORKSPACE" -name ".DS_Store" -type f -delete 2>/dev/null || true
echo "Cleaned __pycache__ and .DS_Store" | tee -a "$LOG_FILE"

# 5. Disk usage check
echo "" | tee -a "$LOG_FILE"
echo "--- Disk usage ---" | tee -a "$LOG_FILE"
df -h /home | tee -a "$LOG_FILE"
du -sh "$WORKSPACE" | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "=== Consolidation complete ===" | tee -a "$LOG_FILE"