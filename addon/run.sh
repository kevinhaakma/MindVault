#!/usr/bin/env bash
set -euo pipefail

export MINDVAULT_DIR=/data/mindvault
export MINDVAULT_STATIC=/var/www/html
mkdir -p "$MINDVAULT_DIR"

# Read addon options
if [ -f /data/options.json ]; then
  export MINDVAULT_PASSWORD="$(jq -r '.password // ""' /data/options.json)"
fi

# Persist a session-signing secret across restarts
SECRET_FILE="$MINDVAULT_DIR/.session_secret"
if [ ! -f "$SECRET_FILE" ]; then
  head -c 32 /dev/urandom | base64 > "$SECRET_FILE"
fi
export MINDVAULT_SECRET="$(cat "$SECRET_FILE")"

exec uvicorn server:app --host 0.0.0.0 --port 8765 --workers 1
