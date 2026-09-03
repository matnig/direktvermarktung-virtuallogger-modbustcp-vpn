const express = require('express');
const einspeisemanagementService = require('../../services/einspeisemanagementService');
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

module.exports = router;
