'use strict';

// Export der Einspeisemanagement-Regelgrößen nach Home Assistant.
//
// Die Regelgrößen (Dargebot, WR-Sollwert, Akku-Reserve, ...) sind berechnete Werte im
// controlService und damit weder Register noch Variablen — die Publish-Regeln und die
// HA-Auto-Discovery kennen sie also nicht. Dieser Service spiegelt sie in virtuelle
// Variablen mit festen Ids. Ab da greift die bestehende Kette von selbst:
// bridgeService -> mqttService.runPublishCycle -> discoveryService.publishStates.
//
// Die Variablen sind bewusst writable:false, damit die Discovery sie als `sensor` mit
// `state_class: measurement` anlegt — nur damit führt Home Assistant Langzeitstatistiken.

const virtualVariableRepository = require('../repositories/virtualVariableRepository');
const variableService           = require('./variableService');
const VirtualVariable           = require('../domain/VirtualVariable');

const ID_PREFIX = 'em-var-0000-0000-0000000000';
const id = (n) => ID_PREFIX + String(n).padStart(2, '0');

// pfad: Pfad in den controlService-Status (Punktnotation).
// deviceClass: '' = aus der Einheit ableiten, 'none' = bewusst keine.
//   'none' bei kWh ist wichtig: Home Assistant laesst device_class "energy" nur mit
//   state_class total/total_increasing zu — die ladbare Energie ist aber ein Momentanwert.
const STATUS_FELDER = [
  { nr:  1, pfad: 'pIstKw',                name: 'PV Produktion',              unit: 'kW',   dataType: 'float32' },
  { nr:  2, pfad: 'dargebotKw',            name: 'PV Dargebot',                unit: 'kW',   dataType: 'float32' },
  { nr:  3, pfad: 'pKannKw',               name: 'P kann an WWN',              unit: 'kW',   dataType: 'float32' },
  { nr:  4, pfad: 'pIstWwnKw',             name: 'P ist an WWN',               unit: 'kW',   dataType: 'float32' },
  { nr:  5, pfad: 'napEinspeisungKw',      name: 'Netzeinspeisung',            unit: 'kW',   dataType: 'float32' },
  { nr:  6, pfad: 'pLimitKw',              name: 'Leistungsgrenze',            unit: 'kW',   dataType: 'float32' },
  { nr:  7, pfad: 'wrSollwertKw',          name: 'WR Sollwert',                unit: 'kW',   dataType: 'float32' },
  { nr:  8, pfad: 'direktvermarkterKw',    name: 'Sollwert Direktvermarkter',  unit: 'kW',   dataType: 'float32' },
  { nr:  9, pfad: 'netzbetreiberKw',       name: 'Sollwert Netzbetreiber',     unit: 'kW',   dataType: 'float32' },
  { nr: 10, pfad: 'drosselAktiv',          name: 'Drosselung aktiv',           unit: '',     dataType: 'bool'    },
  { nr: 11, pfad: 'akku.socProzent',       name: 'Akku SoC',                   unit: '%',    dataType: 'float32', deviceClass: 'battery' },
  { nr: 12, pfad: 'akku.ladeleistungKw',   name: 'Akku Ladeleistung',          unit: 'kW',   dataType: 'float32' },
  { nr: 13, pfad: 'akku.ladbareEnergieKwh',name: 'Akku ladbare Energie',       unit: 'kWh',  dataType: 'float32', deviceClass: 'none' },
  { nr: 19, pfad: 'akku.entladeleistungKw', name: 'Akku Entladeleistung',    unit: 'kW',   dataType: 'float32' },
  { nr: 20, pfad: 'akku.wirkleistungKw',   name: 'Akku Wirkleistung',          unit: 'kW',   dataType: 'float32' },
  { nr: 14, pfad: 'akkuReserveKw',         name: 'Akku Ladereserve',           unit: 'kW',   dataType: 'float32' },
  { nr: 15, pfad: 'akkuRestdauerS',        name: 'Akku Restladedauer',         unit: 's',    dataType: 'float32', deviceClass: 'duration' },
  { nr: 16, pfad: 'akkuFreigabeFaktor',    name: 'Akku Freigabefaktor',        unit: '',     dataType: 'float32' },
  { nr: 17, pfad: 'akkuSperre.gesperrt',   name: 'Akku Reserve gesperrt',      unit: '',     dataType: 'bool'    },
  { nr: 18, pfad: 'akkuBetriebsbereit',    name: 'Akku betriebsbereit',        unit: '',     dataType: 'bool'    },
].map((f) => ({ ...f, id: id(f.nr), deviceClass: f.deviceClass || '' }));

function lies(obj, pfad) {
  return pfad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Legt fehlende Variablen an. Idempotent: vorhandene bleiben unangetastet, damit
// Umbenennungen oder ein abgeschaltetes haEnabled des Nutzers erhalten bleiben.
function ensureVariables() {
  const now = new Date().toISOString();
  const angelegt = [];
  const vorhanden = [];
  for (const f of STATUS_FELDER) {
    if (virtualVariableRepository.getById(f.id)) { vorhanden.push(f.name); continue; }
    virtualVariableRepository.create(new VirtualVariable({
      id: f.id,
      name: f.name,
      label: f.name,
      dataType: f.dataType,
      unit: f.unit,
      deviceClass: f.deviceClass,
      writable: false,          // -> HA-Entity wird `sensor` mit state_class measurement
      enabled: true,
      haEnabled: true,
      description: 'Einspeisemanagement: ' + f.pfad,
      createdAt: now,
      updatedAt: now,
    }));
    angelegt.push(f.name);
  }
  return { angelegt, vorhanden, gesamt: STATUS_FELDER.length };
}

// Spiegelt den aktuellen Reglerzustand in die Variablen. Nur was existiert wird geschrieben,
// gelöschte Variablen sind damit automatisch abgemeldet.
function publishStatus(state) {
  if (!state) return 0;
  let n = 0;
  for (const f of STATUS_FELDER) {
    if (!virtualVariableRepository.getById(f.id)) continue;
    const roh = lies(state, f.pfad);
    if (roh === undefined) continue;
    const wert = f.dataType === 'bool'
      ? (roh === null ? null : Boolean(roh))
      : (roh === null || !Number.isFinite(Number(roh)) ? null : Number(roh));
    if (wert === null) continue;
    if (variableService.setValue(f.id, wert, 'einspeisemanagement')) n++;
  }
  return n;
}

function getStatus() {
  return STATUS_FELDER.map((f) => ({
    id: f.id, name: f.name, pfad: f.pfad, unit: f.unit, dataType: f.dataType,
    vorhanden: Boolean(virtualVariableRepository.getById(f.id)),
  }));
}

module.exports = { STATUS_FELDER, ensureVariables, publishStatus, getStatus };
