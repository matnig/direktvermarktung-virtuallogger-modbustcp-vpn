const express = require('express');
const sourceService      = require('../../services/sourceService');
const registerRepository = require('../../repositories/registerRepository');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(sourceService.listSources());
});

router.get('/:id', (req, res) => {
  const source = sourceService.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'source_not_found' });
  res.json(source);
});

router.post('/', (req, res) => {
  const result = sourceService.createSource(req.body);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.status(201).json(result.data);
});

router.put('/:id', (req, res) => {
  const result = sourceService.updateSource(req.params.id, req.body);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  if (result.notFound) return res.status(404).json({ error: 'source_not_found' });
  res.json(result.data);
});

router.delete('/:id', (req, res) => {
  const existing = sourceService.getSource(req.params.id);
  if (!existing) return res.status(404).json({ error: 'source_not_found' });

  const children = registerRepository.listBySourceId(req.params.id);
  if (children.length > 0) {
    return res.status(400).json({
      error: 'source_has_registers',
      message: `Delete the ${children.length} register(s) belonging to this source first.`,
      registers: children.map((r) => ({ id: r.id, name: r.name })),
    });
  }

  const result = sourceService.deleteSource(req.params.id);
  if (!result.deleted) return res.status(404).json({ error: 'source_not_found' });
  res.status(204).send();
});

module.exports = router;
