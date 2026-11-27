#!/usr/bin/env bash
# Deploy the standalone BangBang artifact to Cloudflare Pages.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
project="${1:-may-game-bangbang}"
out="$root/.bangbang-site"
if [ ! -f "$out/index.html" ]; then
  echo "Missing $out. Run scripts/bangbang/build-site.sh first." >&2
  exit 1
fi
python3 "$root/scripts/check-static.py" "$out"
npx --yes wrangler@4.168.0 pages deploy "$out" --project-name "$project" --branch main --commit-dirty=true
