const express = require('express');
const historyService = require('../../services/historyService');
const { validateHistory } = require('../../validation/historyValidation');

const router = express.Router();

// GET /api/history/config
router.get('/config', (req, res) => {
  res.json(historyService.getConfig());
});

router.put('/config', (req, res) => {
  const payload = req.body || {};
  const { isValid, errors } = validateHistory(payload);
  if (!isValid) return res.status(400).json({ error: 'Validation failed', details: errors });
  res.json(historyService.updateConfig(payload));
});

// GET /api/history/series — welche Reihen es gibt und wie weit sie zurückreichen
router.get('/series', (req, res) => {
  res.json({ serien: historyService.listSeries() });
});

// GET /api/history?kind=em&id=pIstKw&stunden=6&maxPunkte=400
router.get('/', (req, res) => {
  const { kind, id } = req.query;
  if (!kind || !id) return res.status(400).json({ error: 'kind and id are required' });
  const stunden = Number(req.query.stunden);
  const bis = Date.now();
  const von = Number.isFinite(stunden) && stunden > 0
    ? bis - stunden * 3600 * 1000
    : Number(req.query.von);
  res.json(historyService.query({
    kind: String(kind), id: String(id),
    vonMs: von, bisMs: bis,
    maxPunkte: Number(req.query.maxPunkte) || 400,
  }));
});

// POST /api/history/flush — Puffer sofort schreiben (für Tests/Wartung)
router.post('/flush', (req, res) => {
  historyService.flush();
  res.json({ ok: true });
});

module.exports = router;
