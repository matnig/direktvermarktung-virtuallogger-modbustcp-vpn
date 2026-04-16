const createApp = require('./createApp');
const { HOST, PORT } = require('../config/appConfig');
const { initializeCollections } = require('../persistence/jsonStore');
const runtimeService = require('../services/runtimeService');
const settingsService = require('../services/settingsService');
const vpnService = require('../services/vpnService');

initializeCollections([
  { name: 'sources', fallback: [] },
  { name: 'registers', fallback: [] },
  { name: 'profiles', fallback: [] },
  { name: settingsService.COLLECTION, fallback: [settingsService.createDefaultSettings()] },
  { name: vpnService.VPN_COLLECTION, fallback: [vpnService.createDefaultConfig()] },
  { name: vpnService.VPN_SECRETS_COLLECTION, fallback: [vpnService.createDefaultSecrets()] },
]);

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Modbus bridge listening on http://${HOST}:${PORT}`);
  runtimeService.startRuntime();
});
