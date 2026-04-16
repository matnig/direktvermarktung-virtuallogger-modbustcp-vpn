const express = require('express');
const profileService = require('../../services/profileService');

const router = express.Router();

router.post('/:id/apply', (req, res) => {
  const { sourceId, mergeSourceDefaults = false } = req.body || {};
  if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });
  const result = profileService.applyProfile(req.params.id, sourceId, { mergeSourceDefaults });
  if (result.notFound === 'profile') return res.status(404).json({ error: 'profile_not_found' });
  if (result.notFound === 'source') return res.status(404).json({ error: 'source_not_found' });
  res.json(result);
});

router.get('/', (req, res) => {
  res.json(profileService.listProfiles());
});

router.get('/:id', (req, res) => {
  const profile = profileService.getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'profile_not_found' });
  res.json(profile);
});

router.post('/', (req, res) => {
  const result = profileService.createProfile(req.body);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.status(201).json(result.data);
});

router.put('/:id', (req, res) => {
  const result = profileService.updateProfile(req.params.id, req.body);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  if (result.notFound) return res.status(404).json({ error: 'profile_not_found' });
  res.json(result.data);
});

router.delete('/:id', (req, res) => {
  const result = profileService.deleteProfile(req.params.id);
  if (!result.deleted) return res.status(404).json({ error: 'profile_not_found' });
  res.status(204).send();
});

module.exports = router;
