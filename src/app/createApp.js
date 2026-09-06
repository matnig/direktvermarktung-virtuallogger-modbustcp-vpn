const express = require('express');
const path = require('path');
const apiRouter = require('../api');
const errorHandler = require('../middleware/errorHandler');

function createApp() {
  const app = express();

  // 25 MB: Lastgang-CSVs des Netzbetreibers sind mit 15-Minuten-Werten je Jahr rund 1-2 MB,
  // der Standardwert von 100 kB reicht dafuer nicht.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.text({ limit: '25mb', type: 'text/csv' }));
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
