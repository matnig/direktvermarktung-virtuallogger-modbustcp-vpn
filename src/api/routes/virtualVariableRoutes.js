const express = require('express');
const { v4: uuidv4 } = require('uuid');
const virtualVariableRepository  = require('../../repositories/virtualVariableRepository');
const mappingRepository          = require('../../repositories/mappingRepository');
const mqttSubscriptionRepository = require('../../repositories/mqttSubscriptionRepository');
const mqttPublishRuleRepository  = require('../../repositories/mqttPublishRuleRepository');
const VirtualVariable            = require('../../domain/VirtualVariable');
const variableService            = require('../../services/variableService');
const { validateVirtualVariable } = require('../../validation/virtualVariableValidation');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(variableService.getAllVariableStates());
});

router.get('/:id', (req, res) => {
  const v = virtualVariableRepository.getById(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const state = variableService.getVariableState(req.params.id);
  res.json({ ...v, ...(state || {}) });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const validation = validateVirtualVariable(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  // Unique name check
  if (virtualVariableRepository.getByName(body.name.trim())) {
    return res.status(400).json({ errors: [`Variable name "${body.name}" already exists`] });
  }

  const now = new Date().toISOString();
  const v = new VirtualVariable({ ...body, id: uuidv4(), name: body.name.trim(), createdAt: now, updatedAt: now });
  virtualVariableRepository.create(v);
  if (v.initialValue !== null && v.initialValue !== undefined) {
    variableService.setValue(v.id, v.initialValue, 'initial');
  }
  res.status(201).json({ ...v, ...(variableService.getVariableState(v.id) || {}) });
});

router.put('/:id', (req, res) => {
  const existing = virtualVariableRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const merged = { ...existing, ...body };
  const validation = validateVirtualVariable(merged);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  // Name uniqueness (allow same name for same id)
  if (body.name && body.name.trim() !== existing.name) {
    if (virtualVariableRepository.getByName(body.name.trim())) {
      return res.status(400).json({ errors: [`Variable name "${body.name}" already exists`] });
    }
  }

  const updated = virtualVariableRepository.update(req.params.id, (item) => ({
    ...item, ...body,
    id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString(),
    name: body.name ? body.name.trim() : item.name,
  }));
  res.json({ ...updated, ...(variableService.getVariableState(req.params.id) || {}) });
});

// PATCH /:id/value — manually set value (for writable variables)
router.patch('/:id/value', (req, res) => {
  const v = virtualVariableRepository.getById(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (!v.writable) return res.status(400).json({ error: 'Variable is read-only' });

  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value is required' });

  variableService.setValue(req.params.id, value, 'manual');
  res.json({ ...v, ...(variableService.getVariableState(req.params.id) || {}) });
});

router.delete('/:id', (req, res) => {
  const existing = virtualVariableRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Prevent deletion if referenced
  const id = req.params.id;
  const referencingMappings = mappingRepository.list().filter(
    (m) => m.sourceId === id || m.targetId === id || m.sourceRegisterId === id
  );
  const referencingSubs  = mqttSubscriptionRepository.listByVariableId(id);
  const referencingRules = mqttPublishRuleRepository.list().filter(
    (r) => r.sourceType === 'variable' && r.sourceId === id
  );
  if (referencingMappings.length > 0 || referencingSubs.length > 0 || referencingRules.length > 0) {
    return res.status(400).json({
      error: 'variable_referenced',
      message: 'Remove references to this variable before deleting it.',
      mappings:      referencingMappings.map((m) => ({ id: m.id, label: m.label })),
      subscriptions: referencingSubs.map((s) => ({ id: s.id, label: s.label })),
      publishRules:  referencingRules.map((r) => ({ id: r.id, label: r.label })),
    });
  }

  virtualVariableRepository.remove(req.params.id);
  variableService.purgeState(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
