const express = require('express');
const sourceRoutes = require('./routes/sourceRoutes');
const registerRoutes = require('./routes/registerRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const runtimeRoutes = require('./routes/runtimeRoutes');
const profileRoutes = require('./routes/profileRoutes');
const exportRoutes = require('./routes/exportRoutes');
const { DATA_TYPES, REGISTER_TYPES } = require('../validation/registerValidation');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/meta', (req, res) => {
  res.json({
    registerTypes: REGISTER_TYPES,
    dataTypes: DATA_TYPES,
  });
});

router.use('/sources', sourceRoutes);
router.use('/registers', registerRoutes);
router.use('/profiles', profileRoutes);
router.use('/settings', settingsRoutes);
router.use('/runtime', runtimeRoutes);
router.use('/export', exportRoutes);

module.exports = router;
