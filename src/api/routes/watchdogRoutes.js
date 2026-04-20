const express = require('express');
const { v4: uuidv4 } = require('uuid');
const watchdogRepository        = require('../../repositories/watchdogRepository');
const mqttPublishRuleRepository = require('../../repositories/mqttPublishRuleRepository');
const Watchdog = require('../../domain/Watchdog');
const { validateWatchdog } = require('../../validation/watchdogValidation');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(watchdogRepository.list());
});

router.get('/:id', (req, res) => {
  const wd = watchdogRepository.getById(req.params.id);
  if (!wd) return res.status(404).json({ error: 'Not found' });
  res.json(wd);
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const validation = validateWatchdog(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const now = new Date().toISOString();
  const wd = new Watchdog({ ...body, id: uuidv4(), createdAt: now, updatedAt: now });
  res.status(201).json(watchdogRepository.create(wd));
});

router.put('/:id', (req, res) => {
  const existing = watchdogRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const merged = { ...existing, ...body };
  const validation = validateWatchdog(merged);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const updated = watchdogRepository.update(req.params.id, (item) => ({
    ...item,
    ...body,
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
  }));
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = watchdogRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const refRules = mqttPublishRuleRepository.list().filter(
    (r) => r.sourceType === 'watchdog' && r.sourceId === req.params.id
  );
  if (refRules.length > 0) {
    return res.status(400).json({
      error: 'watchdog_referenced',
      message: 'Remove publish rules referencing this watchdog before deleting it.',
      publishRules: refRules.map((r) => ({ id: r.id, label: r.label })),
    });
  }

  const deleted = watchdogRepository.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

module.exports = router;
