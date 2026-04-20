const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mqttPublishRuleRepository = require('../../repositories/mqttPublishRuleRepository');
const MqttPublishRule           = require('../../domain/MqttPublishRule');
const { validateMqttPublishRule } = require('../../validation/mqttValidation');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(mqttPublishRuleRepository.list());
});

router.get('/:id', (req, res) => {
  const r = mqttPublishRuleRepository.getById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const validation = validateMqttPublishRule(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const now = new Date().toISOString();
  const rule = new MqttPublishRule({ ...body, id: uuidv4(), createdAt: now, updatedAt: now });
  res.status(201).json(mqttPublishRuleRepository.create(rule));
});

router.put('/:id', (req, res) => {
  const existing = mqttPublishRuleRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const merged = { ...existing, ...body };
  const validation = validateMqttPublishRule(merged);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const updated = mqttPublishRuleRepository.update(req.params.id, (item) => ({
    ...item, ...body, id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString(),
  }));
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const deleted = mqttPublishRuleRepository.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

module.exports = router;
