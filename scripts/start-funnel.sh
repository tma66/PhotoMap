#!/usr/bin/env bash
# Exposes the local server publicly via Tailscale Funnel.
# Prerequisite (one-time): brew install --cask tailscale, sign in, and
# enable Funnel for this device in the Tailscale admin console.
set -euo pipefail

PORT="${PORT:-3000}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale isn't installed. Run: brew install --cask tailscale" >&2
  exit 1
fi

tailscale funnel --bg "$PORT"
echo
echo "Funnel is running. Public URL:"
tailscale funnel status
