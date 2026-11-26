#!/usr/bin/env python3
"""Preflight a static publish directory against Cloudflare Pages limits.

Usage: python3 scripts/check-static.py .site
"""
from pathlib import Path
import sys

MAX_FILES = 20_000
MAX_BYTES = 25 * 1024 * 1024
WARN_FILES = 16_000
BLOCKED = {".git", "node_modules", ".venv", "__pycache__"}

if len(sys.argv) != 2:
    raise SystemExit(__doc__.strip())

root = Path(sys.argv[1]).resolve()
if not root.is_dir() or not (root / "index.html").is_file():
    raise SystemExit(f"Invalid static output: {root}")

files = 0
total = 0
errors = []

for entry in root.rglob("*"):
    rel = entry.relative_to(root)
    if entry.is_symlink():
        errors.append(f"Symlink: {rel}")
        continue
    if any(part in BLOCKED or part == ".env" or part.startswith(".env.") for part in rel.parts):
        errors.append(f"Unexpected private/dev path: {rel}")
        continue
    if not entry.is_file():
        continue
    files += 1
    size = entry.stat().st_size
    total += size
    if size > MAX_BYTES:
        errors.append(f"Oversized: {rel} ({size / 2**20:.2f} MiB)")

if files > MAX_FILES:
    errors.append(f"File count {files} > {MAX_FILES}")

print(f"{files} files | {total / 2**20:.2f} MiB")
if files > WARN_FILES:
    print("WARNING: less than 20% file-count headroom")
for error in errors:
    print("ERROR:", error)
sys.exit(1 if errors else 0)
