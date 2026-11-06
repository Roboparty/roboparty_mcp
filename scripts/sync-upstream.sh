#!/usr/bin/env bash
# Refresh first-party sources from the archived standalone repositories.
# This is a maintainer script; it is not run by npm install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_REPO="${DOCS_REPO:-$HOME/tret_repo/roboparty_docs_skill}"
SYSTEM1_REPO="${SYSTEM1_REPO:-$HOME/tret_repo/roboparty_system1_mcp}"

for repo in "$DOCS_REPO" "$SYSTEM1_REPO"; do
    [ -d "$repo" ] || { echo "missing source repo: $repo" >&2; exit 1; }
done

rm -rf "$ROOT/src/docs" "$ROOT/src/system1"
mkdir -p "$ROOT/src/docs" "$ROOT/src/system1"

cp "$DOCS_REPO"/mcp/src/*.ts "$ROOT/src/docs/"
cp "$SYSTEM1_REPO"/src/*.ts "$ROOT/src/system1/"
# Keep the vendored System-1 source compatible with the package's Zod 4.
sed -i 's/z\.record(z\.unknown())/z.record(z.string(), z.unknown())/g' "$ROOT/src/system1/server.ts"
sed -i 's/z\.record(z\.string()\.nullable())/z.record(z.string(), z.string().nullable())/g' "$ROOT/src/system1/server.ts"
sed -i 's/z\.record(questionSchema)/z.record(z.string(), questionSchema)/g' "$ROOT/src/system1/server.ts"

find "$ROOT" -path "$ROOT/node_modules" -prune -o -type d -name __pycache__ -print0 \
    | xargs -0 rm -rf
find "$ROOT" -path "$ROOT/node_modules" -prune -o -name '*.pyc' -print0 | xargs -0 rm -f

echo "upstream sync complete"
echo "  docs:    $(git -C "$DOCS_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "  system1: $(git -C "$SYSTEM1_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
