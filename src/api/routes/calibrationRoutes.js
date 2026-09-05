const express = require('express');
const svc = require('../../services/calibrationSamplerService');

const router = express.Router();

// GET /api/calibration/status  -> { running, enabled, intervalMs, count }
router.get('/status', (req, res) => res.json(svc.status()));

// GET /api/calibration/samples -> [ {t, strOst, strWest, mittel, pIstKw, dargebotKw, drosselAktiv, ...}, ... ]
router.get('/samples', (req, res) => res.json(svc.getSamples()));

// DELETE /api/calibration/samples -> leert den Puffer
router.delete('/samples', (req, res) => { svc.clearSamples(); res.json({ ok: true }); });

// POST /api/calibration/sampler  { enabled, intervalMs }
router.post('/sampler', (req, res) => {
  const { enabled, intervalMs } = req.body || {};
  if (enabled) return res.json(svc.start(intervalMs));
  return res.json(svc.stop());
});

// POST /api/calibration/sample-now -> einen Sample sofort erfassen
router.post('/sample-now', (req, res) => {
  try { res.json(svc.sampleOnce()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
