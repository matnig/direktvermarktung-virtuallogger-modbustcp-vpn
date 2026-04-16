const express = require('express');
const sourceService = require('../../services/sourceService');

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
  const result = sourceService.deleteSource(req.params.id);
  if (!result.deleted) return res.status(404).json({ error: 'source_not_found' });
  res.status(204).send();
});

module.exports = router;
