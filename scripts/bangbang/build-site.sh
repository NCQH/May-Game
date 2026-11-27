#!/usr/bin/env bash
# Build the standalone BangBang Pages artifact.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/.bangbang-site"
case "$out" in "$root/.bangbang-site") ;; *) echo "Unexpected output path: $out" >&2; exit 1 ;; esac
rm -rf -- "$out"
mkdir -p "$out"
git -C "$root" archive HEAD games/bangbang sw.js | tar -x -C "$out"

cat > "$out/_redirects" <<'REDIRECTS'
/ /games/bangbang/html5/ 302
/html5/* /games/bangbang/html5/:splat 200
/rez/* /games/bangbang/rez/:splat 200
REDIRECTS

cat > "$out/_headers" <<'HEADERS'
/sw.js
  Service-Worker-Allowed: /
  Cache-Control: no-store

/games/bangbang/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin

/html5/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin

/rez/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin
HEADERS

cat > "$out/index.html" <<'PAGE'
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bang Bang</title>
  <meta http-equiv="refresh" content="0; url=/games/bangbang/html5/">
</head>
<body>
  <p><a href="/games/bangbang/html5/">Vào Bang Bang</a></p>
</body>
</html>
PAGE

touch "$out/.nojekyll"
python3 "$root/scripts/check-static.py" "$out"
