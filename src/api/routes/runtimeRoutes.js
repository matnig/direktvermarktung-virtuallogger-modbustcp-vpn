const express = require('express');
const runtimeService = require('../../services/runtimeService');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json(runtimeService.getRuntimeState());
});

router.post('/poll-once', async (req, res, next) => {
  try {
    await runtimeService.pollOnce();
    res.json(runtimeService.getRuntimeState());
  } catch (error) {
    next(error);
  }
});

router.post('/start', (req, res) => {
  runtimeService.startRuntime();
  res.json({ running: true });
});

router.post('/stop', (req, res) => {
  runtimeService.stopRuntime();
  res.json({ running: false });
});

module.exports = router;