const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mqttService                = require('../../services/mqttService');
const mqttSubscriptionRepository = require('../../repositories/mqttSubscriptionRepository');
const MqttSubscription           = require('../../domain/MqttSubscription');
const { validateMqttConfig, validateMqttSubscription } = require('../../validation/mqttValidation');

const router = express.Router();

// ── MQTT broker config ────────────────────────────────────────────────

router.get('/config', (req, res) => {
  const cfg = mqttService.getConfig();
  res.json({ ...cfg, password: cfg.password ? '***' : '' });
});

router.put('/config', (req, res) => {
  const body = req.body || {};
  const validation = validateMqttConfig(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });
  res.json(mqttService.updateConfig(body));
});

router.get('/status', (req, res) => {
  res.json(mqttService.getStatus());
});

router.post('/connect', (req, res) => {
  mqttService.connect();
  res.json(mqttService.getStatus());
});

router.post('/disconnect', (req, res) => {
  mqttService.disconnect();
  setTimeout(() => res.json(mqttService.getStatus()), 200);
});

router.post('/reconnect', (req, res) => {
  mqttService.reconnect();
  res.json(mqttService.getStatus());
});

// ── MQTT subscriptions ────────────────────────────────────────────────

router.get('/subscriptions', (req, res) => {
  res.json(mqttSubscriptionRepository.list());
});

router.get('/subscriptions/:id', (req, res) => {
  const s = mqttSubscriptionRepository.getById(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.post('/subscriptions', (req, res) => {
  const body = req.body || {};
  const validation = validateMqttSubscription(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const now = new Date().toISOString();
  const sub = new MqttSubscription({ ...body, id: uuidv4(), createdAt: now, updatedAt: now });
  mqttSubscriptionRepository.create(sub);
  mqttService.resubscribe(sub.topic);
  res.status(201).json(sub);
});

router.put('/subscriptions/:id', (req, res) => {
  const existing = mqttSubscriptionRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const merged = { ...existing, ...body };
  const validation = validateMqttSubscription(merged);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const updated = mqttSubscriptionRepository.update(req.params.id, (item) => ({
    ...item, ...body, id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString(),
  }));
  // Re-subscribe if topic changed
  if (body.topic && body.topic !== existing.topic) {
    mqttService.unsubscribeTopic(existing.topic);
    mqttService.resubscribe(updated.topic);
  }
  res.json(updated);
});

router.delete('/subscriptions/:id', (req, res) => {
  const existing = mqttSubscriptionRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  mqttSubscriptionRepository.remove(req.params.id);
  mqttService.unsubscribeTopic(existing.topic);
  res.json({ deleted: true });
});

module.exports = router;
