#!/usr/bin/env bash
# MindVault add-on startup — runs uvicorn (API) + nginx (GUI) side-by-side.
set -euo pipefail

export MINDVAULT_DIR=/data/mindvault
mkdir -p "$MINDVAULT_DIR"

# Start backend
cd /app/backend
uvicorn server:app --host 0.0.0.0 --port 8765 --workers 1 &
UVICORN_PID=$!

# Clean up backend if nginx exits
trap "kill $UVICORN_PID 2>/dev/null; exit" SIGTERM SIGINT SIGQUIT

# Start nginx in foreground (keeps the container alive)
exec nginx -g 'daemon off;'
