#!/usr/bin/env bash
# Deploy a built .site to Cloudflare Pages (Direct Upload).
# Default: original game only (no HD/widescreen) to keep the first load around 43 MB.
# Set PVZ_FULL=1 to keep the full hd/ and wide/ sets.
# Usage: CLOUDFLARE_API_TOKEN=... bash scripts/deploy-cloudflare.sh [project] [branch]
# The project must exist (wrangler pages project create ...). This script never creates it.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-may-game}"
BRANCH="${2:-preview}"

if [ ! -f .site/index.html ]; then
  echo "Missing .site. Build the site (git archive + PvZ engine) first." >&2
  exit 1
fi

SOURCE=.site/games/pvz-goty/engine/source.zip
if [ -f "$SOURCE" ]; then
  SIZE=$(wc -c < "$SOURCE" | tr -d '[:space:]')
  if [ "$SIZE" -gt $((25 * 1024 * 1024)) ]; then
    echo "ERROR: source.zip is over 25 MiB. Publish it as a GitHub Release and remove it from .site." >&2
    echo "See docs/CLOUDFLARE-MIGRATION.md (Phase A3)." >&2
    exit 1
  fi
fi

# Wrangler 4.168.0 is pinned; newer 4.x releases delegate Pages commands to Workers.
WRANGLER=(npx --yes wrangler@4.168.0)
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && ! "${WRANGLER[@]}" whoami >/dev/null 2>&1; then
  echo "Run 'npx wrangler login' or set CLOUDFLARE_API_TOKEN first." >&2
  exit 1
fi

if [ "${PVZ_FULL:-0}" != "1" ]; then
  node scripts/pvz/trim-pvz.cjs .site
fi
node scripts/pvz/chunk-main-pak.cjs .site
python3 scripts/check-static.py .site
"${WRANGLER[@]}" pages deploy .site --project-name "$PROJECT" --branch "$BRANCH"
