const os  = require('os');
const fs  = require('fs');
const { execSync } = require('child_process');

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Decode a little-endian 8-char hex gateway from /proc/net/route to dotted IP.
function hexLeToIp(hex) {
  if (!hex || hex.length !== 8) return null;
  const b = [
    parseInt(hex.substr(6, 2), 16),
    parseInt(hex.substr(4, 2), 16),
    parseInt(hex.substr(2, 2), 16),
    parseInt(hex.substr(0, 2), 16),
  ];
  return b.join('.');
}

// ── Individual readers ────────────────────────────────────────────────────────

function getPrimaryInterface() {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (name === 'lo' || name.startsWith('lo:')) continue;
    const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
    if (ipv4) return { name, addr: ipv4 };
  }
  return null;
}

function getDefaultGateway() {
  // Primary: ip route (Linux/macOS ip wrapper)
  const out = safeExec('ip route show default');
  if (out) {
    const m = out.match(/default via ([\d.]+)/);
    if (m) return m[1];
  }

  // Fallback: /proc/net/route (Linux only)
  try {
    const route = fs.readFileSync('/proc/net/route', 'utf8');
    for (const line of route.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      // Destination 00000000 = default route
      if (parts.length >= 3 && parts[1] === '00000000' && parts[2] !== '00000000') {
        const ip = hexLeToIp(parts[2]);
        if (ip) return ip;
      }
    }
  } catch {}

  return null;
}

function getDnsServers() {
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf8');
    return [...resolv.matchAll(/^nameserver\s+([\d.:a-fA-F]+)/gm)].map(m => m[1]);
  } catch {}
  return [];
}

// Returns true (DHCP), false (static), or null (unknown).
function detectDhcp(iface) {
  if (!iface) return null;

  // Check 'ip addr show' output for 'dynamic' keyword (set by kernel when DHCP)
  const out = safeExec(`ip addr show ${iface}`);
  if (out !== null) {
    // The inet line for DHCP-assigned addresses contains the word 'dynamic'
    return out.includes(' dynamic ') || out.includes(' dynamic\n');
  }

  // Fallback: check for an active dhclient or systemd-networkd lease file
  try {
    const leaseDir = '/var/lib/dhcp';
    if (fs.existsSync(leaseDir)) {
      const files = fs.readdirSync(leaseDir);
      if (files.some(f => f.includes(iface) && (f.endsWith('.leases') || f.endsWith('.lease')))) {
        return true;
      }
    }
  } catch {}

  return null;
}

function getVpnInterface() {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!/^(tun|tap)\d/.test(name)) continue;
    const ipv4 = addrs.find(a => a.family === 'IPv4');
    if (ipv4) return { name, address: ipv4.address };
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

function getNetworkInfo() {
  const primary = getPrimaryInterface();
  const vpn     = getVpnInterface();

  return {
    interface:    primary ? primary.name          : null,
    address:      primary ? primary.addr.address  : null,
    netmask:      primary ? primary.addr.netmask  : null,
    cidr:         primary ? primary.addr.cidr     : null,
    gateway:      getDefaultGateway(),
    dns:          getDnsServers(),
    dhcp:         detectDhcp(primary ? primary.name : null),
    vpnInterface: vpn ? vpn.name    : null,
    vpnAddress:   vpn ? vpn.address : null,
    updatedAt:    new Date().toISOString(),
  };
}

module.exports = { getNetworkInfo };
