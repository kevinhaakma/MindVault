#!/usr/bin/env bash
# sync-addon.sh — copy source files into addon/ so the HA add-on stays current.
# Run this before pushing to the GitHub repo that HA watches.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADDON="$ROOT/addon"

echo "Syncing source → addon/ ..."

cp "$ROOT/backend/server.py"         "$ADDON/backend/server.py"
cp "$ROOT/backend/requirements.txt"  "$ADDON/backend/requirements.txt"

cp "$ROOT/gui/package.json"          "$ADDON/gui/package.json"
cp "$ROOT/gui/vite.config.js"        "$ADDON/gui/vite.config.js"
cp "$ROOT/gui/index.html"            "$ADDON/gui/index.html"
cp "$ROOT/gui/src/App.jsx"           "$ADDON/gui/src/App.jsx"
cp "$ROOT/gui/src/main.jsx"          "$ADDON/gui/src/main.jsx"
cp "$ROOT/gui/src/VexAvatar.jsx"     "$ADDON/gui/src/VexAvatar.jsx"

echo "Done. Commit addon/ and push to trigger HA add-on rebuild."
