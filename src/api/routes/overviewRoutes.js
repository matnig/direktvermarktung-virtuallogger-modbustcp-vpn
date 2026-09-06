const express = require('express');

const runtimeService             = require('../../services/runtimeService');
const controlService             = require('../../services/controlService');
const einspeisemanagementService = require('../../services/einspeisemanagementService');
const externalServerService      = require('../../services/externalServerService');
const bridgeService              = require('../../services/bridgeService');
const watchdogService            = require('../../services/watchdogService');
const mqttService                = require('../../services/mqttService');
const networkService             = require('../../services/networkService');
const vpnService                 = require('../../services/vpnService');
const variableService            = require('../../services/variableService');
const externalRegisterValues     = require('../../services/externalRegisterValues');
const sourceRepository           = require('../../repositories/sourceRepository');
const registerRepository         = require('../../repositories/registerRepository');
const mappingRepository          = require('../../repositories/mappingRepository');
const watchdogRepository         = require('../../repositories/watchdogRepository');
const mqttPublishRuleRepository  = require('../../repositories/mqttPublishRuleRepository');
const virtualVariableRepository  = require('../../repositories/virtualVariableRepository');

const router = express.Router();

// GET /api/overview — alles, was die Übersichtsseite braucht, in EINER Antwort.
//
// Vorher holte die Oberfläche 15 Endpunkte parallel, alle 5 s. Über die VPN-Strecke zur
// Anlage sind das rund drei Verbindungen pro Sekunde von einer einzigen Adresse — genug,
// um in eine Verbindungsratenbegrenzung zu laufen (typische ufw-limit-Regel greift ab
// 6 Verbindungen in 30 s). Eine Anfrage je Zyklus ist auch ohne diesen Anlass die
// bessere Wahl: ein konsistenter Datenstand statt 15 leicht versetzter.
router.get('/', (req, res, next) => {
  const sicher = (fn, fallback = null) => {
    try { return fn(); } catch { return fallback; }
  };

  try {
    const net = sicher(() => networkService.getNetworkInfo());
    res.json({
      zeit: new Date().toISOString(),
      runtime: sicher(() => runtimeService.getRuntimeState(), null),
      em: sicher(() => controlService.getControlState(), null),
      emCfg: sicher(() => einspeisemanagementService.getConfig(), null),
      bridge: sicher(() => externalServerService.getSettings(), null),
      bridgeStatus: sicher(() => ({
        server: externalServerService.getStatus(),
        bridge: bridgeService.getBridgeState(),
        watchdog: watchdogService.getWatchdogStates(),
      }), null),
      mqtt: sicher(() => mqttService.getStatus(), null),
      net,
      vpn: sicher(() => vpnService.getPublicStatus(), null),
      variablen: sicher(() => virtualVariableRepository.list().map((v) => ({
        ...v, ...(variableService.getVariableState(v.id) || {}),
      })), []),
      externeWerte: sicher(() => externalRegisterValues.listValues(), []),
      bestand: sicher(() => ({
        quellen: sourceRepository.list().length,
        register: registerRepository.list().length,
        variablen: virtualVariableRepository.list().length,
        mappings: mappingRepository.list().length,
        watchdogs: watchdogRepository.list().length,
        publishRegeln: mqttPublishRuleRepository.list().length,
      }), null),
      registerDefs: sicher(() => registerRepository.list().map((r) => ({
        id: r.id, name: r.name, unit: r.unit, sourceId: r.sourceId,
      })), []),
      quellen: sicher(() => sourceRepository.list().map((s) => ({ id: s.id, name: s.name })), []),
    });
  } catch (err) { next(err); }
});

module.exports = router;
