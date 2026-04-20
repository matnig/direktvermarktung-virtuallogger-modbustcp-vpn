const express = require('express');
const { readCollection, writeCollection } = require('../../persistence/jsonStore');

const router = express.Router();

// vpn_secrets is intentionally excluded — never export credentials
// vpn_secrets intentionally excluded; mqtt password included (documented limitation)
const COLLECTIONS = ['sources', 'registers', 'profiles', 'settings', 'vpn',
  'external_registers', 'mappings', 'watchdogs',
  'virtual_variables', 'mqtt_subscriptions', 'mqtt_publish_rules', 'mqtt_config'];

router.get('/', (req, res) => {
  const snapshot = {};
  for (const name of COLLECTIONS) {
    snapshot[name] = readCollection(name);
  }
  snapshot.exportedAt = new Date().toISOString();
  res.json(snapshot);
});

router.post('/import', (req, res) => {
  const body = req.body || {};
  const errors = [];

  for (const name of COLLECTIONS) {
    if (body[name] !== undefined && !Array.isArray(body[name]) && typeof body[name] !== 'object') {
      errors.push(`${name} must be an array or object`);
    }
  }
  if (errors.length) return res.status(400).json({ errors });

  const imported = {};
  for (const name of COLLECTIONS) {
    if (body[name] !== undefined) {
      writeCollection(name, body[name]);
      imported[name] = true;
    }
  }

  res.json({ imported });
});

module.exports = router;
