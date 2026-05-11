#!/usr/bin/env bash
# Run this once on your home server from the deploy/ directory.
# Requires: docker, docker compose plugin, tailscale
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Detect Tailscale IP on this machine
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
if [[ -z "$TAILSCALE_IP" ]]; then
    echo "ERROR: could not detect Tailscale IP. Is tailscale up?" >&2
    exit 1
fi

echo "Tailscale IP: ${TAILSCALE_IP}"
echo "TAILSCALE_IP=${TAILSCALE_IP}" > .env

echo "Building and starting MindVault…"
docker compose up -d --build

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MindVault live at http://${TAILSCALE_IP}"
echo "  Reachable from any machine on your Tailscale network."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
