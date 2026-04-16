const express = require('express');
const path = require('path');
const apiRouter = require('../api');
const errorHandler = require('../middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/', (req, res) => {
    res.redirect('/public_index.html');
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'modbus-bridge' });
  });

  app.use('/api', apiRouter);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
