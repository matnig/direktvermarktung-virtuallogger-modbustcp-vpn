#!/usr/bin/env bash
# install.sh — clone/update, install dependencies, and register as a systemd service
# Usage (remote):
#   curl -fsSL https://raw.githubusercontent.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn/main/install.sh | bash
#   wget -qO-  https://raw.githubusercontent.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn/main/install.sh | bash
# Usage (local):
#   bash install.sh
#
# Override defaults:
#   MODBUS_BRIDGE_DIR=/opt/modbus-bridge bash install.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
REPO_URL="https://github.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn.git"
INSTALL_DIR="${MODBUS_BRIDGE_DIR:-$HOME/modbus-bridge}"
SERVICE_NAME="modbus-bridge"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# ── Helpers ───────────────────────────────────────────────────────────────────
info() { printf '\033[1;34m  →\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  ✗ ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but was not found in PATH."
}

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo "  direktvermarktung-virtuallogger-modbustcp-vpn installer"
echo "  ────────────────────────────────────────────────────────"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."
need git
need node
need npm
need sudo
need systemctl

node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
[ "$node_major" -ge 18 ] || die "Node.js >= 18 required. Found: $(node --version)"
ok "Node.js $(node --version), npm $(npm --version)"

# ── Locate or clone the project ───────────────────────────────────────────────
if [ -f "$(pwd)/src/app/main.js" ] && [ -f "$(pwd)/package.json" ]; then
  INSTALL_DIR="$(pwd)"
  ok "Running from existing project directory: $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "Repository already present at $INSTALL_DIR — pulling latest changes..."
  git -C "$INSTALL_DIR" pull --ff-only || die "Could not fast-forward. Resolve manually: cd \"$INSTALL_DIR\" && git pull"
  ok "Repository updated"
elif [ -d "$INSTALL_DIR" ]; then
  die "$INSTALL_DIR exists but is not a git repository. Remove it or use another path, e.g. MODBUS_BRIDGE_DIR=/other/path bash install.sh"
else
  info "Cloning into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned"
fi

cd "$INSTALL_DIR"

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing dependencies..."
npm install --omit=dev
ok "Dependencies ready"

# ── Resolve runtime paths ─────────────────────────────────────────────────────
MODBUS_USER="$(id -un)"
NODE_BIN="$(command -v node)"

# ── Write systemd service unit ────────────────────────────────────────────────
info "Writing systemd service to $SERVICE_FILE ..."
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Modbus Bridge
Documentation=https://github.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn
After=network.target

[Service]
Type=simple
User=${MODBUS_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} src/app/main.js
Restart=on-failure
RestartSec=5

Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=3000

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
ok "Service unit written"

# ── Reload / enable / start ───────────────────────────────────────────────────
info "Reloading systemd daemon..."
sudo systemctl daemon-reload

info "Enabling ${SERVICE_NAME} to start on boot..."
sudo systemctl enable "${SERVICE_NAME}"

if systemctl is-active --quiet "${SERVICE_NAME}"; then
  info "Service is already running — restarting to apply updates..."
  sudo systemctl restart "${SERVICE_NAME}"
else
  info "Starting ${SERVICE_NAME}..."
  sudo systemctl start "${SERVICE_NAME}"
fi

# Give systemd a moment to report stable status
sleep 2

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │  Modbus Bridge is running as a systemd service      │"
echo "  │                                                     │"
printf "  │  URL     http://localhost:%-27s│\n" "${PORT:-3000}"
printf "  │  Dir     %-44s│\n" "$INSTALL_DIR"
printf "  │  Service %-44s│\n" "$SERVICE_NAME"
echo "  │                                                     │"
echo "  │  Useful commands:                                   │"
echo "  │    systemctl status modbus-bridge                   │"
echo "  │    journalctl -u modbus-bridge -f                   │"
echo "  │    systemctl restart modbus-bridge                  │"
echo "  │    systemctl stop modbus-bridge                     │"
echo "  └─────────────────────────────────────────────────────┘"
echo ""

# ── Service status ────────────────────────────────────────────────────────────
sudo systemctl status "${SERVICE_NAME}" --no-pager --lines=8 || true
