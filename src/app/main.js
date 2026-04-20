const createApp = require('./createApp');
const { HOST, PORT } = require('../config/appConfig');
const { initializeCollections } = require('../persistence/jsonStore');
const runtimeService        = require('../services/runtimeService');
const settingsService       = require('../services/settingsService');
const vpnService            = require('../services/vpnService');
const externalServerService = require('../services/externalServerService');
const bridgeService         = require('../services/bridgeService');
const watchdogService       = require('../services/watchdogService');
const externalRegisterRepository    = require('../repositories/externalRegisterRepository');
const mappingRepository             = require('../repositories/mappingRepository');
const watchdogRepository            = require('../repositories/watchdogRepository');
const virtualVariableRepository     = require('../repositories/virtualVariableRepository');
const mqttSubscriptionRepository    = require('../repositories/mqttSubscriptionRepository');
const mqttPublishRuleRepository     = require('../repositories/mqttPublishRuleRepository');
const mqttService                   = require('../services/mqttService');
const variableService               = require('../services/variableService');

initializeCollections([
  { name: 'sources',    fallback: [] },
  { name: 'registers',  fallback: [] },
  { name: 'profiles',   fallback: [] },
  { name: settingsService.COLLECTION,         fallback: [settingsService.createDefaultSettings()] },
  { name: vpnService.VPN_COLLECTION,          fallback: [vpnService.createDefaultConfig()] },
  { name: vpnService.VPN_SECRETS_COLLECTION,  fallback: [vpnService.createDefaultSecrets()] },
  { name: externalRegisterRepository.COLLECTION, fallback: [] },
  { name: mappingRepository.COLLECTION,          fallback: [] },
  { name: watchdogRepository.COLLECTION,         fallback: [] },
  { name: externalServerService.COLLECTION,
    fallback: { ...externalServerService.DEFAULT_SETTINGS } },
  { name: virtualVariableRepository.COLLECTION,      fallback: [] },
  { name: mqttSubscriptionRepository.COLLECTION,     fallback: [] },
  { name: mqttPublishRuleRepository.COLLECTION,      fallback: [] },
  { name: mqttService.COLLECTION,
    fallback: { ...mqttService.DEFAULT_CONFIG } },
]);

const app = createApp();

app.listen(PORT, HOST, async () => {
  console.log(`Modbus bridge listening on http://${HOST}:${PORT}`);
  runtimeService.startRuntime();
  variableService.initVariableStates();
  await externalServerService.initServer();
  bridgeService.startBridge();
  watchdogService.startWatchdog();
  mqttService.connect();
});
