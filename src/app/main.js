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
const einspeisemanagementService    = require('../services/einspeisemanagementService');
const controlService                = require('../services/controlService');
const calibrationSamplerService     = require('../services/calibrationSamplerService');
const dashboardService              = require('../services/dashboardService');
const dargebotLernService           = require('../services/dargebotLernService');
const historyService                = require('../services/historyService');
const wirtschaftlichkeitService     = require('../services/wirtschaftlichkeitService');
const lastgangService               = require('../services/lastgangService');

initializeCollections([
  { name: 'sources',    fallback: [] },
  { name: 'registers',  fallback: [] },
  { name: 'profiles',   fallback: [] },
  { name: dargebotLernService.COLLECTION, fallback: [{}] },
  { name: dashboardService.COLLECTION,
    fallback: [dashboardService.createDefaultConfig()] },
  { name: historyService.COLLECTION,
    fallback: [historyService.createDefaultConfig()] },
  { name: wirtschaftlichkeitService.COLLECTION,
    fallback: [wirtschaftlichkeitService.createDefaultConfig()] },
  { name: lastgangService.COLLECTION, fallback: [] },
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
  { name: einspeisemanagementService.COLLECTION,
    fallback: [einspeisemanagementService.createDefaultConfig()] },
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
  controlService.startControl();
  calibrationSamplerService.init(); // Kalibrier-Sampler fortsetzen, falls aktiviert
  historyService.start();           // Verlaufs-Logger für die ausgewählten Live-Werte
});

// Gepufferte Verlaufspunkte beim Beenden noch wegschreiben, sonst geht bis zu einem
// Flush-Intervall an Aufzeichnung verloren (systemctl restart passiert hier regelmäßig).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try { historyService.flush(); } catch (e) { console.warn('[history] Flush beim Beenden:', e.message); }
    try { dargebotLernService.sichern(true); } catch (e) { console.warn('[dargebotLernen] Sichern beim Beenden:', e.message); }
    process.exit(0);
  });
}
