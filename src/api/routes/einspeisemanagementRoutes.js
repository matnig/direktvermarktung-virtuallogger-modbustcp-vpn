const express = require('express');
const einspeisemanagementService = require('../../services/einspeisemanagementService');
const emHaExportService          = require('../../services/emHaExportService');
const dargebotLernService        = require('../../services/dargebotLernService');
const controlService = require('../../services/controlService');
const { validateEinspeisemanagement } = require('../../validation/einspeisemanagementValidation');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(einspeisemanagementService.getConfig());
});

// Live-Regelzustand (berechnet, ohne Aktuierung)
router.get('/status', (req, res) => {
  res.json(controlService.getControlState());
});

router.put('/', (req, res) => {
  const payload = req.body || {};
  const { isValid, errors } = validateEinspeisemanagement(payload);
  if (!isValid) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  return res.json(einspeisemanagementService.updateConfig(payload));
});

// --- Mitlernende Dargebot-Kalibrierung ---
router.get('/lernen', (req, res) => {
  res.json(dargebotLernService.status(einspeisemanagementService.getConfig()));
});

// Kein DELETE (siehe historyRoutes): Zuruecksetzen als POST.
router.post('/lernen/zuruecksetzen', (req, res) => {
  dargebotLernService.zuruecksetzen();
  res.json({ zurueckgesetzt: true });
});

// --- Home-Assistant-Export der Regelgrößen ---
// GET  zeigt, welche der Status-Variablen schon existieren.
// POST legt die fehlenden an und meldet sie per Auto-Discovery an Home Assistant.
router.get('/ha-export', (req, res) => {
  res.json({ felder: emHaExportService.getStatus() });
});

router.post('/ha-export', (req, res, next) => {
  try {
    const ergebnis = emHaExportService.ensureVariables();
    let discovery = 0;
    try { discovery = require('../../services/mqttDiscoveryService').publishDiscovery(); }
    catch (e) { console.warn('[ha-export] Discovery:', e.message); }
    res.json({ ...ergebnis, discoveryVeroeffentlicht: discovery, felder: emHaExportService.getStatus() });
  } catch (err) { next(err); }
});

module.exports = router;
