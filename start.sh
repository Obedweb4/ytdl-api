#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  OBED TECH — YouTube API  •  One-command startup
#  Usage: bash start.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   OBED TECH — YouTube API v2.0           ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# Check Node version
NODE_VERSION=$(node -e "process.exit(parseInt(process.versions.node.split('.')[0]))" 2>&1 || true)
MAJOR=$(node -e "console.log(parseInt(process.versions.node.split('.')[0]))" 2>/dev/null || echo "0")
if [ "$MAJOR" -lt 18 ]; then
  echo "  ❌  Node.js >= 18 required (found: $(node --version 2>/dev/null || echo 'not found'))"
  exit 1
fi
echo "  ✅  Node.js $(node --version) detected"

# Install deps if node_modules missing
if [ ! -d "$BACKEND/node_modules" ]; then
  echo "  📦  Installing dependencies..."
  cd "$BACKEND" && npm install
  cd "$SCRIPT_DIR"
else
  echo "  ✅  Dependencies already installed"
fi

# Copy .env.example → .env if no .env exists
if [ ! -f "$BACKEND/.env" ] && [ -f "$BACKEND/.env.example" ]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  echo "  📋  Created .env from .env.example"
fi

echo ""
echo "  🚀  Starting server..."
echo ""

cd "$BACKEND" && node server.js
