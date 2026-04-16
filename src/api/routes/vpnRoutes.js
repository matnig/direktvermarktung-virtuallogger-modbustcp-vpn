const express = require('express');
const vpnService = require('../../services/vpnService');
const { validateVpnConfig, validateProfileUpload } = require('../../validation/vpnValidation');

const router = express.Router();

// GET /api/vpn — config (without secrets) + live connection state + file metadata
// Raw .ovpn content is NEVER returned.
router.get('/', (req, res) => {
  res.json(vpnService.getPublicStatus());
});

// PUT /api/vpn — update non-sensitive config fields and optionally secrets.
// To upload a profile, use POST /api/vpn/upload instead.
router.put('/', (req, res) => {
  const body = req.body || {};
  const validation = validateVpnConfig(body);
  if (!validation.isValid) {
    return res.status(400).json({ errors: validation.errors });
  }
  const result = vpnService.updateConfig(body);
  res.json(result);
});

// POST /api/vpn/upload — store a .ovpn profile file.
// Body: { content: string, filename?: string }
// The raw content is never returned in subsequent GET responses — only metadata.
router.post('/upload', (req, res) => {
  const { content, filename } = req.body || {};
  const validation = validateProfileUpload(content, filename);
  if (!validation.isValid) {
    return res.status(400).json({ error: validation.error });
  }
  const result = vpnService.saveUploadedProfile(content, filename || 'profile.ovpn');
  res.json(result);
});

// DELETE /api/vpn/profile — remove the stored .ovpn file and clear its metadata
router.delete('/profile', (req, res) => {
  res.json(vpnService.clearUploadedProfile());
});

// POST /api/vpn/connect — spawn OpenVPN using the stored .ovpn file.
// Returns immediately with the current status (usually 'connecting').
// Poll GET /api/vpn to track the actual connection state.
router.post('/connect', async (req, res) => {
  try {
    const result = await vpnService.connect();
    if (result.error && !result.alreadyActive) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vpn/disconnect — stop the active OpenVPN process
router.post('/disconnect', (req, res) => {
  res.json(vpnService.disconnect());
});

module.exports = router;
