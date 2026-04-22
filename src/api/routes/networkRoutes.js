const express = require('express');
const networkService = require('../../services/networkService');

const router = express.Router();

// GET /api/network/status — read-only OS network snapshot
router.get('/status', (req, res) => {
  try {
    const info = networkService.getNetworkInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: 'network_read_failed', message: err.message });
  }
});

module.exports = router;
