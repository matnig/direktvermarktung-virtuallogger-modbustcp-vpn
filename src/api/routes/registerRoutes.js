const express = require('express');
const registerService    = require('../../services/registerService');
const mappingRepository  = require('../../repositories/mappingRepository');
const mqttPublishRuleRepository = require('../../repositories/mqttPublishRuleRepository');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(registerService.listRegisters(req.query.sourceId));
});

router.get('/:id', (req, res) => {
  const register = registerService.getRegister(req.params.id);
  if (!register) return res.status(404).json({ error: 'register_not_found' });
  res.json(register);
});

router.post('/', (req, res) => {
  const result = registerService.createRegister(req.body);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.status(201).json(result.data);
});

router.put('/:id', (req, res) => {
  const result = registerService.updateRegister(req.params.id, req.body);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  if (result.notFound) return res.status(404).json({ error: 'register_not_found' });
  res.json(result.data);
});

router.delete('/:id', (req, res) => {
  const existing = registerService.getRegister(req.params.id);
  if (!existing) return res.status(404).json({ error: 'register_not_found' });

  const id = req.params.id;
  const refMappings = mappingRepository.list().filter(
    (m) => m.sourceRegisterId === id || m.sourceId === id || m.targetId === id
  );
  const refRules = mqttPublishRuleRepository.list().filter(
    (r) => r.sourceType === 'register' && r.sourceId === id
  );
  if (refMappings.length > 0 || refRules.length > 0) {
    return res.status(400).json({
      error: 'register_referenced',
      message: 'Remove references to this register before deleting it.',
      mappings: refMappings.map((m) => ({ id: m.id, label: m.label })),
      publishRules: refRules.map((r) => ({ id: r.id, label: r.label })),
    });
  }

  const result = registerService.deleteRegister(id);
  if (!result.deleted) return res.status(404).json({ error: 'register_not_found' });
  res.status(204).send();
});

module.exports = router;
