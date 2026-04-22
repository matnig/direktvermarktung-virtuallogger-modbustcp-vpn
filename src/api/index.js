const express = require('express');
const sourceRoutes           = require('./routes/sourceRoutes');
const registerRoutes         = require('./routes/registerRoutes');
const settingsRoutes         = require('./routes/settingsRoutes');
const runtimeRoutes          = require('./routes/runtimeRoutes');
const profileRoutes          = require('./routes/profileRoutes');
const exportRoutes           = require('./routes/exportRoutes');
const vpnRoutes              = require('./routes/vpnRoutes');
const externalRegisterRoutes = require('./routes/externalRegisterRoutes');
const mappingRoutes          = require('./routes/mappingRoutes');
const watchdogRoutes         = require('./routes/watchdogRoutes');
const bridgeRoutes           = require('./routes/bridgeRoutes');
const virtualVariableRoutes  = require('./routes/virtualVariableRoutes');
const mqttRoutes             = require('./routes/mqttRoutes');
const mqttPublishRuleRoutes  = require('./routes/mqttPublishRuleRoutes');
const networkRoutes          = require('./routes/networkRoutes');
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

router.use('/sources',            sourceRoutes);
router.use('/registers',          registerRoutes);
router.use('/profiles',           profileRoutes);
router.use('/settings',           settingsRoutes);
router.use('/runtime',            runtimeRoutes);
router.use('/export',             exportRoutes);
router.use('/vpn',                vpnRoutes);
router.use('/external-registers', externalRegisterRoutes);
router.use('/mappings',           mappingRoutes);
router.use('/watchdogs',          watchdogRoutes);
router.use('/bridge',             bridgeRoutes);
router.use('/variables',          virtualVariableRoutes);
router.use('/mqtt',               mqttRoutes);
router.use('/mqtt-publish-rules', mqttPublishRuleRoutes);
router.use('/network',           networkRoutes);

module.exports = router;
