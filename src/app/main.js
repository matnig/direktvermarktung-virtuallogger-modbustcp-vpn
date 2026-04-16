const createApp = require('./createApp');
const { HOST, PORT } = require('../config/appConfig');
const { initializeCollections } = require('../persistence/jsonStore');
const runtimeService = require('../services/runtimeService');
const settingsService = require('../services/settingsService');

initializeCollections([
  { name: 'sources', fallback: [] },
  { name: 'registers', fallback: [] },
  { name: 'profiles', fallback: [] },
  { name: settingsService.COLLECTION, fallback: [settingsService.createDefaultSettings()] },
]);

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Modbus bridge listening on http://${HOST}:${PORT}`);
  runtimeService.startRuntime();
});
