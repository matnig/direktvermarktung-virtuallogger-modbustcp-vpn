const express = require('express');
const settingsService = require('../../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(settingsService.getSettings());
});

router.put('/', (req, res) => {
  res.json(settingsService.updateSettings(req.body || {}));
});

module.exports = router;
