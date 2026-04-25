const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mappingRepository = require('../../repositories/mappingRepository');
const Mapping = require('../../domain/Mapping');
const { validateMapping } = require('../../validation/mappingValidation');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(mappingRepository.list());
});

router.get('/:id', (req, res) => {
  const m = mappingRepository.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const validation = validateMapping(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const now = new Date().toISOString();
  const mapping = new Mapping({ ...body, id: uuidv4(), createdAt: now, updatedAt: now });
  res.status(201).json(mappingRepository.create(mapping));
});

router.put('/:id', (req, res) => {
  const existing = mappingRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const merged = { ...existing, ...body };
  const validation = validateMapping(merged);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const updated = mappingRepository.update(req.params.id, (item) => ({
    ...item,
    ...body,
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
  }));
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const deleted = mappingRepository.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// Preview: apply a transform pipeline to a test value and return a step-by-step trace.
router.post('/preview', (req, res) => {
  const { applyTransformsWithTrace } = require('../../modbus/encodeRegisterValue');
  const { validateTransform } = require('../../validation/mappingValidation');
  const { transforms = [], inputValue = 0 } = req.body || {};
  if (!Array.isArray(transforms)) return res.status(400).json({ error: 'transforms must be an array' });

  const errors = [];
  transforms.forEach((step, i) => errors.push(...validateTransform(step, i)));
  if (errors.length) return res.status(400).json({ errors });

  try {
    const { input, result, trace } = applyTransformsWithTrace(Number(inputValue), transforms);
    res.json({ inputValue: input, result, trace });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
