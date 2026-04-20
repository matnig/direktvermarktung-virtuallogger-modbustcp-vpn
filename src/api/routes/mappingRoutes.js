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

module.exports = router;
