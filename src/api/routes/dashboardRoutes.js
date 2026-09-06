const express = require('express');
const dashboardService = require('../../services/dashboardService');
const { validateDashboard } = require('../../validation/dashboardValidation');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(dashboardService.getConfig());
});

router.put('/', (req, res) => {
  const payload = req.body || {};
  const { isValid, errors } = validateDashboard(payload);
  if (!isValid) return res.status(400).json({ error: 'Validation failed', details: errors });
  res.json(dashboardService.updateConfig(payload));
});

module.exports = router;
