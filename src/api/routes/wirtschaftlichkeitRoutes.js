const express = require('express');
const wirtschaftlichkeitService = require('../../services/wirtschaftlichkeitService');
const lastgangService = require('../../services/lastgangService');

const router = express.Router();

router.get('/config', (req, res) => res.json(wirtschaftlichkeitService.getConfig()));

router.put('/config', (req, res, next) => {
  try { res.json(wirtschaftlichkeitService.updateConfig(req.body || {})); }
  catch (err) { next(err); }
});

// Lastgänge
router.get('/lastgaenge', (req, res) => res.json({ lastgaenge: lastgangService.list() }));

router.post('/lastgaenge', (req, res, next) => {
  try {
    const { name, csv } = req.body || {};
    if (typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'csv (Text) erforderlich' });
    }
    res.status(201).json(lastgangService.importieren({ name, csv }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Kein DELETE: auf dem Weg zur Anlage sperrt eine Filterung nach DELETE-Anfragen
// die Quell-IP fuer den Port. Siehe historyRoutes.
router.post('/lastgaenge/loeschen', (req, res, next) => {
  try {
    const id = (req.body || {}).id || req.query.id;
    if (!id) return res.status(400).json({ error: 'id erforderlich' });
    res.json({ geloescht: lastgangService.loeschen(String(id)) });
  } catch (err) { next(err); }
});

// Rechnung: optionale Ueberschreibungen im Body, ohne die Konfiguration zu speichern
router.post('/rechnen', (req, res, next) => {
  try { res.json(wirtschaftlichkeitService.rechne(req.body || {})); }
  catch (err) { next(err); }
});

// Vergleichsreihe: { groessen: [150,200,255,350], ...ueberschreibungen }
router.post('/vergleich', (req, res, next) => {
  try {
    const { groessen, ...rest } = req.body || {};
    const g = Array.isArray(groessen) && groessen.length
      ? groessen.map(Number).filter(Number.isFinite)
      : [100, 150, 200, 255, 300, 400, 500];
    res.json({ varianten: wirtschaftlichkeitService.vergleich(g, rest) });
  } catch (err) { next(err); }
});

module.exports = router;
