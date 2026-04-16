#!/usr/bin/env bash
# install.sh — download, install, and start modbus-bridge
# Usage (remote):  curl -fsSL https://raw.githubusercontent.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn/install.sh | bash
# Usage (local):   bash install.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
# Update REPO_URL before pushing to GitHub.
REPO_URL="https://github.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn.git"
INSTALL_DIR="${MODBUS_BRIDGE_DIR:-$HOME/modbus-bridge}"

# ── Helpers ───────────────────────────────────────────────────────────────────
info() { printf '\033[1;34m  →\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  ✗ ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
echo ""
echo "  modbus-bridge installer"
echo "  ───────────────────────"
echo ""

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but was not found in PATH."; }

info "Checking prerequisites..."
need git
need node
need npm

node_major=$(node --version | sed 's/v//' | cut -d. -f1)
[ "$node_major" -ge 18 ] || die "Node.js >= 18 required. Found: $(node --version)"
ok "Node.js $(node --version), npm $(npm --version)"

# ── Locate or clone the project ───────────────────────────────────────────────
if [ -f "$(pwd)/src/app/main.js" ] && [ -f "$(pwd)/package.json" ]; then
  # Already running from inside the project directory
  INSTALL_DIR="$(pwd)"
  ok "Running from existing project directory: $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "Repository already present at $INSTALL_DIR — pulling latest changes..."
  git -C "$INSTALL_DIR" pull --ff-only || {
    die "Could not fast-forward. Resolve manually: cd $INSTALL_DIR && git pull"
  }
  ok "Repository updated"
elif [ -d "$INSTALL_DIR" ]; then
  die "$INSTALL_DIR exists but is not a git repository. Remove it or set a different path: MODBUS_BRIDGE_DIR=/other/path bash install.sh"
else
  info "Cloning into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned"
fi

cd "$INSTALL_DIR"

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing dependencies..."
npm install
ok "Dependencies ready"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  modbus-bridge is ready                     │"
echo "  │                                             │"
printf "  │  URL   http://localhost:%-19s│\n" "${PORT:-3000}"
printf "  │  Dir   %-36s│\n" "$INSTALL_DIR"
echo "  │                                             │"
echo "  │  Press Ctrl+C to stop                       │"
echo "  └─────────────────────────────────────────────┘"
echo ""

# ── Start ─────────────────────────────────────────────────────────────────────
exec npm start
