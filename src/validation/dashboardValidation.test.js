const { test } = require('node:test');
const assert = require('node:assert');
const { validateDashboard } = require('./dashboardValidation');
const DashboardConfig = require('../domain/DashboardConfig');

test('leeres Payload ist gueltig (Teil-Update)', () => {
  assert.strictEqual(validateDashboard({}).isValid, true);
});

test('gueltige Auswahl wird akzeptiert', () => {
  const r = validateDashboard({
    liveItems: [{ kind: 'em', id: 'pIstKw' }, { kind: 'register', id: 'abc' }],
    startAnsicht: 'uebersicht',
  });
  assert.strictEqual(r.isValid, true, r.errors.join('; '));
});

test('unbekannte Art wird abgelehnt', () => {
  const r = validateDashboard({ liveItems: [{ kind: 'quatsch', id: 'x' }] });
  assert.strictEqual(r.isValid, false);
  assert.ok(r.errors[0].includes('kind'));
});

test('leere Id wird abgelehnt', () => {
  const r = validateDashboard({ liveItems: [{ kind: 'em', id: '  ' }] });
  assert.strictEqual(r.isValid, false);
});

test('liveItems muss ein Array sein', () => {
  assert.strictEqual(validateDashboard({ liveItems: 'nein' }).isValid, false);
});

test('Config verwirft unbrauchbare Eintraege statt zu werfen', () => {
  const c = new DashboardConfig({
    liveItems: [null, { kind: 'em' }, { id: 'x' }, { kind: 'em', id: 'pIstKw' }],
  });
  assert.deepStrictEqual(c.liveItems, [{ kind: 'em', id: 'pIstKw' }]);
});

test('Defaults sind gesetzt', () => {
  const c = new DashboardConfig();
  assert.deepStrictEqual(c.liveItems, []);
  assert.strictEqual(c.startAnsicht, 'uebersicht');
  assert.ok(c.parameterKarten.includes('runtime'));
});
