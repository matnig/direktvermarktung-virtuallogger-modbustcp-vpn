const VPN_TYPES = ['openvpn'];
const MAX_PROFILE_BYTES = 102400; // 100 KB — mirrored from vpnService

// Minimum set of keywords found in any valid OpenVPN config
const OVPN_KEYWORDS = ['client', 'remote', '<ca>', 'dev tun', 'dev tap', 'proto tcp', 'proto udp'];

function validateVpnConfig(payload) {
  const errors = [];

  if (payload.type !== undefined && !VPN_TYPES.includes(payload.type)) {
    errors.push(`type must be one of: ${VPN_TYPES.join(', ')}`);
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  if (payload.remoteHost !== undefined && typeof payload.remoteHost !== 'string') {
    errors.push('remoteHost must be a string');
  }

  if (payload.username !== undefined && typeof payload.username !== 'string') {
    errors.push('username must be a string');
  }

  if (payload.password !== undefined && typeof payload.password !== 'string') {
    errors.push('password must be a string');
  }

  if (payload.passphrase !== undefined && typeof payload.passphrase !== 'string') {
    errors.push('passphrase must be a string');
  }

  return { isValid: errors.length === 0, errors };
}

// Validates an .ovpn profile upload — content + optional filename
function validateProfileUpload(content, filename) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    return { isValid: false, error: 'Content is required and cannot be empty.' };
  }

  if (content.trim().length < 20) {
    return { isValid: false, error: 'Content is too short to be a valid OpenVPN configuration.' };
  }

  if (content.length > MAX_PROFILE_BYTES) {
    return { isValid: false, error: `Content exceeds the ${MAX_PROFILE_BYTES / 1024} KB limit.` };
  }

  if (filename !== undefined && filename !== null) {
    const name = String(filename).trim().toLowerCase();
    if (name && !name.endsWith('.ovpn')) {
      return { isValid: false, error: 'Only .ovpn files are accepted.' };
    }
  }

  const hasKnownKeyword = OVPN_KEYWORDS.some(kw => content.includes(kw));
  if (!hasKnownKeyword) {
    return {
      isValid: false,
      error: 'Content does not appear to be a valid OpenVPN configuration (no recognized keywords found).',
    };
  }

  return { isValid: true };
}

module.exports = { validateVpnConfig, validateProfileUpload, VPN_TYPES, MAX_PROFILE_BYTES };
