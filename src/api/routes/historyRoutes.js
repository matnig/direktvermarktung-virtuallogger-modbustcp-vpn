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

// Verlauf einer Reihe verwerfen.
//
// Als POST /api/history/clear, NICHT als DELETE: auf dem Weg zur Anlage sitzt
// offenbar eine Filterung, die nach einer DELETE-Anfrage die Quell-IP fuer Port 3000
// minutenlang sperrt (dreimal reproduziert; PUT und POST auf denselben Server
// blieben unauffaellig). DELETE bleibt als Alias erhalten, wo es funktioniert.
function clearHandler(req, res) {
  const kind = req.query.kind || (req.body || {}).kind;
  const id = req.query.id || (req.body || {}).id;
  if (!kind || !id) return res.status(400).json({ error: 'kind and id are required' });
  const ok = historyService.clearSeries(String(kind), String(id));
  res.json({ geloescht: ok, kind, id });
}
router.post('/clear', clearHandler);
router.delete('/', clearHandler);

// POST /api/history/flush — Puffer sofort schreiben (für Tests/Wartung)
router.post('/flush', (req, res) => {
  historyService.flush();
  res.json({ ok: true });
});

module.exports = router;
