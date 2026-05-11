#!/usr/bin/env bash
set -euo pipefail

export MINDVAULT_DIR=/data/mindvault
export MINDVAULT_STATIC=/var/www/html
mkdir -p "$MINDVAULT_DIR"

exec uvicorn server:app --host 0.0.0.0 --port 8765 --workers 1
