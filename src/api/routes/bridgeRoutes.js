const express = require('express');
const externalServerService = require('../../services/externalServerService');
const bridgeService         = require('../../services/bridgeService');
const watchdogService       = require('../../services/watchdogService');

const router = express.Router();

// GET /api/bridge/status — full bridge runtime: server, mapping, watchdog states
router.get('/status', (req, res) => {
  res.json({
    server:   externalServerService.getStatus(),
    bridge:   bridgeService.getBridgeState(),
    watchdog: watchdogService.getWatchdogStates(),
  });
});

// GET /api/bridge/server/settings
router.get('/server/settings', (req, res) => {
  res.json(externalServerService.getSettings());
});

// PUT /api/bridge/server/settings
router.put('/server/settings', (req, res) => {
  const body = req.body || {};
  const errors = [];

  if (body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('port must be an integer between 1 and 65535');
    }
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }
  if (errors.length) return res.status(400).json({ errors });

  res.json(externalServerService.updateSettings(body));
});

// POST /api/bridge/server/start
router.post('/server/start', async (req, res, next) => {
  try {
    res.json(await externalServerService.startServer());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bridge/server/stop
router.post('/server/stop', async (req, res, next) => {
  try {
    res.json(await externalServerService.stopServer());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
