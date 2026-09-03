const express = require('express');
const manualWriteService = require('../../services/manualWriteService');

const router = express.Router();

// POST /api/manual-write  { sourceId, address, dataType, value }
router.post('/', async (req, res) => {
  const { sourceId, address, dataType, value } = req.body || {};
  if (!sourceId) return res.status(400).json({ error: 'sourceId fehlt' });
  if (address === undefined || value === undefined) {
    return res.status(400).json({ error: 'address und value sind erforderlich' });
  }
  try {
    const result = await manualWriteService.writeHolding({ sourceId, address, dataType, value });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
