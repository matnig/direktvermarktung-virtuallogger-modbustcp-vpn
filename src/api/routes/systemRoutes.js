const express = require('express');
const speicherplatzService = require('../../services/speicherplatzService');

const router = express.Router();

// GET /api/system/speicherplatz — Belegung des Datenverzeichnisses und freier Platz
router.get('/speicherplatz', (req, res, next) => {
  try { res.json(speicherplatzService.bericht()); }
  catch (err) { next(err); }
});

// Verwaiste Verlaufsdateien entfernen (Reihen, die nicht mehr ausgewaehlt sind).
// Kein DELETE, siehe historyRoutes.
router.post('/speicherplatz/aufraeumen', (req, res, next) => {
  try { res.json({ entfernt: speicherplatzService.raeumeVerwaiste() }); }
  catch (err) { next(err); }
});

module.exports = router;
