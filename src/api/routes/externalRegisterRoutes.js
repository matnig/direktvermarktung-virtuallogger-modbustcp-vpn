const express = require('express');
const { v4: uuidv4 } = require('uuid');
const externalRegisterRepository = require('../../repositories/externalRegisterRepository');
const mappingRepository          = require('../../repositories/mappingRepository');
const watchdogRepository         = require('../../repositories/watchdogRepository');
const mqttPublishRuleRepository  = require('../../repositories/mqttPublishRuleRepository');
const ExternalRegister = require('../../domain/ExternalRegister');
const { validateExternalRegister, validateNoAddressConflict } = require('../../validation/externalRegisterValidation');
const externalServerService = require('../../services/externalServerService');
const { decodeWords } = require('../../modbus/encodeRegisterValue');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(externalRegisterRepository.list());
});

// Live values currently held in the external Modbus server register space.
// Returns per register: raw words (+ hex/binary) and the decoded numeric value.
router.get('/values', (req, res) => {
  const out = externalRegisterRepository.list().map((r) => {
    const registerType = r.registerType === 'input' ? 'input' : 'holding';
    const len = r.length || 1;
    let words = [];
    try {
      words = registerType === 'input'
        ? externalServerService.readInputWords(r.address, len)
        : externalServerService.readWords(r.address, len);
    } catch (e) {
      words = [];
    }
    const raw = decodeWords(words, r.dataType);
    const prec = Number.isInteger(Number(r.precision)) ? Number(r.precision) : 0;
    const value = typeof raw === 'number' ? Number(raw.toFixed(prec)) : raw;
    const hex = words.map((w) => '0x' + (w & 0xffff).toString(16).toUpperCase().padStart(4, '0'));
    const bin = words.map((w) => (w & 0xffff).toString(2).padStart(16, '0'));
    return {
      id: r.id,
      name: r.name,
      registerType,
      address: r.address,
      dataType: r.dataType,
      unit: r.unit || '',
      precision: prec,
      words,
      hex,
      bin,
      raw,
      value,
    };
  });
  res.json(out);
});

router.get('/:id', (req, res) => {
  const reg = externalRegisterRepository.getById(req.params.id);
  if (!reg) return res.status(404).json({ error: 'Not found' });
  res.json(reg);
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const validation = validateExternalRegister(body);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const conflict = validateNoAddressConflict(
    Number(body.address), body.dataType, body.registerType || 'holding', externalRegisterRepository.list()
  );
  if (!conflict.isValid) return res.status(400).json({ errors: [conflict.error] });

  const now = new Date().toISOString();
  const reg = new ExternalRegister({ ...body, id: uuidv4(), createdAt: now, updatedAt: now });
  res.status(201).json(externalRegisterRepository.create(reg));
});

router.put('/:id', (req, res) => {
  const existing = externalRegisterRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const merged = { ...existing, ...body };
  const validation = validateExternalRegister(merged);
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  const conflict = validateNoAddressConflict(
    Number(merged.address), merged.dataType, merged.registerType || 'holding', externalRegisterRepository.list(), req.params.id
  );
  if (!conflict.isValid) return res.status(400).json({ errors: [conflict.error] });

  const regType = merged.registerType === 'input' ? 'input' : 'holding';
  const updated = externalRegisterRepository.update(req.params.id, (item) => ({
    ...item,
    ...body,
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
    registerType: regType,
    writable: regType === 'input' ? false : !!merged.writable,
    length: ['uint32', 'int32', 'float32'].includes(merged.dataType) ? 2 : 1,
  }));
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = externalRegisterRepository.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const id = req.params.id;
  const refMappings = mappingRepository.list().filter(
    (m) => m.externalRegisterId === id || m.targetId === id
  );
  const refWatchdogs = watchdogRepository.list().filter((w) => w.externalRegisterId === id);
  const refRules = mqttPublishRuleRepository.list().filter(
    (r) => r.sourceType === 'external_register' && r.sourceId === id
  );
  if (refMappings.length > 0 || refWatchdogs.length > 0 || refRules.length > 0) {
    return res.status(400).json({
      error: 'external_register_referenced',
      message: 'Remove references to this register before deleting it.',
      mappings:     refMappings.map((m) => ({ id: m.id, label: m.label })),
      watchdogs:    refWatchdogs.map((w) => ({ id: w.id, label: w.label })),
      publishRules: refRules.map((r) => ({ id: r.id, label: r.label })),
    });
  }

  const deleted = externalRegisterRepository.remove(id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

module.exports = router;
