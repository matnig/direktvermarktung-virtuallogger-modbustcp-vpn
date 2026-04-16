const express = require('express');
const registerService = require('../../services/registerService');

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
  const result = registerService.deleteRegister(req.params.id);
  if (!result.deleted) return res.status(404).json({ error: 'register_not_found' });
  res.status(204).send();
});

module.exports = router;
