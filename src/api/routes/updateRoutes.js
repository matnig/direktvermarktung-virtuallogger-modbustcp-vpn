const express = require('express');
const updateService = require('../../services/updateService');

const router = express.Router();

// Aktuelle Version + ob ein Update verfügbar ist
router.get('/status', async (req, res, next) => {
  try {
    const version = await updateService.getVersion();
    let check = null;
    if (req.query.check === '1') {
      check = await updateService.checkForUpdates();
    }
    res.json({ version, check });
  } catch (err) { next(err); }
});

// git pull + npm install (kein Neustart)
router.post('/apply', async (req, res, next) => {
  try {
    const result = await updateService.applyUpdate();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) { next(err); }
});

// Service neu starten (detached)
router.post('/restart', (req, res) => {
  const r = updateService.scheduleRestart(800);
  res.json({ restarting: r.scheduled, ...r });
});

module.exports = router;
