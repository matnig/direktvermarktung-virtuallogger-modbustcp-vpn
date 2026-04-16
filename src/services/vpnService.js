const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('../config/appConfig');
const { readCollection, writeCollection } = require('../persistence/jsonStore');

const VPN_COLLECTION = 'vpn';
// Secrets stored separately so they are never included in export snapshots
const VPN_SECRETS_COLLECTION = 'vpn_secrets';

// Hard limit on profile content — prevents accidentally storing huge files
const MAX_PROFILE_BYTES = 102400; // 100 KB

// The .ovpn profile file lives in the data directory alongside the JSON collections
function getProfileFilePath() {
  return path.join(DATA_DIR, 'vpn-profile.ovpn');
}

const EMPTY_UPLOADED_PROFILE = Object.freeze({
  exists: false,
  filename: null,
  uploadedAt: null,
  sizeBytes: null,
});

function createDefaultConfig() {
  const timestamp = new Date().toISOString();
  return {
    type: 'openvpn',
    enabled: false,
    remoteHost: '',
    username: '',
    uploadedProfile: { ...EMPTY_UPLOADED_PROFILE },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createDefaultSecrets() {
  return { password: '', passphrase: '' };
}

// In-memory connection state — not persisted, resets on restart
const vpnState = {
  // 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error'
  status: 'disconnected',
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastError: null,
  pid: null,
};

let vpnProcess = null;

// One-time migration: if stored config still has the old profileContent field,
// move it to the .ovpn file and update the metadata.
function migrateProfileContentIfNeeded(config) {
  if (!('profileContent' in config)) return config;

  const content = config.profileContent || '';
  const next = { ...config };
  delete next.profileContent;
  next.uploadedProfile = next.uploadedProfile || { ...EMPTY_UPLOADED_PROFILE };

  if (content.trim()) {
    try {
      fs.mkdirSync(path.dirname(getProfileFilePath()), { recursive: true });
      fs.writeFileSync(getProfileFilePath(), content, { mode: 0o600 });
      next.uploadedProfile = {
        exists: true,
        filename: 'migrated-profile.ovpn',
        uploadedAt: next.updatedAt || new Date().toISOString(),
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      };
    } catch {
      // Migration failure is non-fatal — user can re-upload
      next.uploadedProfile = { ...EMPTY_UPLOADED_PROFILE };
    }
  }

  writeCollection(VPN_COLLECTION, [next]);
  return next;
}

function getConfig() {
  const [stored] = readCollection(VPN_COLLECTION, [createDefaultConfig()]);
  const config = stored || createDefaultConfig();
  return migrateProfileContentIfNeeded(config);
}

function getSecrets() {
  const [stored] = readCollection(VPN_SECRETS_COLLECTION, [createDefaultSecrets()]);
  return stored || createDefaultSecrets();
}

// Returns the public-facing VPN status.
// Raw .ovpn file content is NEVER included — only metadata about the uploaded file.
// Password and passphrase are NEVER included — only existence flags.
function getPublicStatus() {
  const config = getConfig();
  const secrets = getSecrets();

  // Expose 'disabled' when VPN is not enabled and no connection is active
  const effectiveState = { ...vpnState };
  if (!config.enabled && vpnState.status === 'disconnected') {
    effectiveState.status = 'disabled';
  }

  // Cross-check: if metadata says file exists but it's gone from disk, correct it
  const profileMeta = config.uploadedProfile || { ...EMPTY_UPLOADED_PROFILE };
  const fileActuallyExists = profileMeta.exists && fs.existsSync(getProfileFilePath());
  const safeProfileMeta = fileActuallyExists
    ? profileMeta
    : { ...EMPTY_UPLOADED_PROFILE };

  return {
    type: config.type,
    enabled: config.enabled,
    remoteHost: config.remoteHost,
    username: config.username,
    uploadedProfile: safeProfileMeta,
    hasPassword: !!(secrets.password),
    hasPassphrase: !!(secrets.passphrase),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    state: effectiveState,
  };
}

// Update non-sensitive config fields and optionally secrets.
// Callers must not pass uploadedProfile — that is managed by saveUploadedProfile / clearUploadedProfile.
function updateConfig(payload) {
  const current = getConfig();
  const timestamp = new Date().toISOString();

  const next = {
    type: payload.type !== undefined ? payload.type : current.type,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : current.enabled,
    remoteHost: payload.remoteHost !== undefined ? String(payload.remoteHost || '').trim() : current.remoteHost,
    username: payload.username !== undefined ? String(payload.username || '').trim() : current.username,
    // uploadedProfile is internal — only the service writes it
    uploadedProfile: payload._uploadedProfile !== undefined
      ? payload._uploadedProfile
      : (current.uploadedProfile || { ...EMPTY_UPLOADED_PROFILE }),
    createdAt: current.createdAt || timestamp,
    updatedAt: timestamp,
  };

  writeCollection(VPN_COLLECTION, [next]);

  // Only update secrets when explicitly provided — empty string clears the value
  if (payload.password !== undefined || payload.passphrase !== undefined) {
    const currentSecrets = getSecrets();
    writeCollection(VPN_SECRETS_COLLECTION, [{
      password: payload.password !== undefined ? String(payload.password) : currentSecrets.password,
      passphrase: payload.passphrase !== undefined ? String(payload.passphrase) : currentSecrets.passphrase,
    }]);
  }

  return getPublicStatus();
}

// Write the .ovpn content to disk and record its metadata in vpn.json.
function saveUploadedProfile(content, filename) {
  const profilePath = getProfileFilePath();
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, content, { mode: 0o600 });

  return updateConfig({
    _uploadedProfile: {
      exists: true,
      filename: String(filename || 'profile.ovpn').trim(),
      uploadedAt: new Date().toISOString(),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    },
  });
}

// Remove the .ovpn file from disk and clear its metadata.
function clearUploadedProfile() {
  try { fs.unlinkSync(getProfileFilePath()); } catch { /* ignore — file may not exist */ }
  return updateConfig({ _uploadedProfile: { ...EMPTY_UPLOADED_PROFILE } });
}

function connect() {
  // Guard against duplicate spawns: process reference is the definitive check
  if (vpnProcess !== null) {
    return Promise.resolve({ alreadyActive: true, status: vpnState.status });
  }
  if (vpnState.status === 'connecting' || vpnState.status === 'connected') {
    return Promise.resolve({ alreadyActive: true, status: vpnState.status });
  }

  const config = getConfig();
  const profilePath = getProfileFilePath();
  const profileMeta = config.uploadedProfile || {};

  if (!profileMeta.exists) {
    return Promise.resolve({
      error: 'no_profile',
      message: 'Upload an OpenVPN profile (.ovpn) before connecting.',
    });
  }

  if (!fs.existsSync(profilePath)) {
    // Metadata says file exists but it has been deleted from disk
    return Promise.resolve({
      error: 'profile_file_missing',
      message: 'Profile file is missing from storage. Please re-upload the .ovpn file.',
    });
  }

  vpnState.status = 'connecting';
  vpnState.lastError = null;
  vpnState.pid = null;

  const tmpDir = os.tmpdir();
  const ts = Date.now();
  // Pass the persistent profile file directly to openvpn — no temp copy needed
  const args = ['--config', profilePath, '--verb', '3'];
  const tmpFiles = []; // only temp credential/passphrase files, not the profile itself

  return new Promise((resolve) => {
    // Buffer stderr for error reporting on exit.
    // OpenVPN routes ALL operational log output through stderr, so we never
    // change status based on stderr data — only the exit code matters.
    const stderrBuffer = [];

    try {
      const secrets = getSecrets();

      // NOTE: OpenVPN usually requires root or CAP_NET_ADMIN.
      // In production, run via a privileged helper or a systemd unit.
      if (config.username && secrets.password) {
        const credFile = path.join(tmpDir, `mb-vpn-creds-${ts}.txt`);
        fs.writeFileSync(credFile, `${config.username}\n${secrets.password}\n`, { mode: 0o600 });
        args.push('--auth-user-pass', credFile);
        tmpFiles.push(credFile);
      }

      if (secrets.passphrase) {
        const passFile = path.join(tmpDir, `mb-vpn-pass-${ts}.txt`);
        fs.writeFileSync(passFile, `${secrets.passphrase}\n`, { mode: 0o600 });
        args.push('--askpass', passFile);
        tmpFiles.push(passFile);
      }

      vpnProcess = spawn('openvpn', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      vpnState.pid = vpnProcess.pid;

      vpnProcess.stdout.on('data', (data) => {
        if (data.toString().includes('Initialization Sequence Completed')) {
          vpnState.status = 'connected';
          vpnState.lastConnectedAt = new Date().toISOString();
        }
      });

      vpnProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').map(l => l.trim()).filter(Boolean);
        stderrBuffer.push(...lines);
        if (stderrBuffer.length > 20) stderrBuffer.splice(0, stderrBuffer.length - 20);
      });

      vpnProcess.on('close', (code) => {
        vpnState.lastDisconnectedAt = new Date().toISOString();
        vpnState.pid = null;
        vpnProcess = null;

        if (vpnState.status !== 'disconnected') {
          if (code === 0) {
            vpnState.status = 'disconnected';
          } else {
            vpnState.status = 'error';
            if (!vpnState.lastError) {
              const lastLine = stderrBuffer.filter(Boolean).pop() || '';
              vpnState.lastError = lastLine
                ? `OpenVPN exited (code ${code}): ${lastLine.slice(0, 200)}`
                : `OpenVPN exited with code ${code}`;
            }
          }
        }

        for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      });

      vpnProcess.on('error', (err) => {
        vpnState.status = 'error';
        vpnState.lastError = err.code === 'ENOENT'
          ? 'openvpn binary not found. Install OpenVPN on the server.'
          : err.message;
        vpnState.pid = null;
        vpnProcess = null;
        for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      });

      resolve({ status: vpnState.status, pid: vpnState.pid });
    } catch (err) {
      vpnState.status = 'error';
      vpnState.lastError = err.message;
      vpnProcess = null;
      for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      resolve({ error: err.message });
    }
  });
}

function disconnect() {
  if (vpnState.status === 'disconnected' || vpnState.status === 'disabled') {
    return { status: vpnState.status, alreadyDisconnected: true };
  }

  if (vpnProcess) {
    try { vpnProcess.kill('SIGTERM'); } catch { /* ignore — process may have already exited */ }
  }

  vpnState.status = 'disconnected';
  vpnState.lastDisconnectedAt = new Date().toISOString();
  vpnState.pid = null;
  vpnProcess = null;

  return { status: 'disconnected', lastDisconnectedAt: vpnState.lastDisconnectedAt };
}

module.exports = {
  VPN_COLLECTION,
  VPN_SECRETS_COLLECTION,
  MAX_PROFILE_BYTES,
  getProfileFilePath,
  createDefaultConfig,
  createDefaultSecrets,
  getPublicStatus,
  updateConfig,
  saveUploadedProfile,
  clearUploadedProfile,
  connect,
  disconnect,
};
