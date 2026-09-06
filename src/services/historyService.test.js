const { test } = require('node:test');
const assert = require('node:assert');
const { buendeln } = require('./historyService');

const reihe = (n, fn) => Array.from({ length: n }, (_, i) => [1000 + i * 1000, fn(i)]);

test('wenige Punkte werden unveraendert durchgereicht', () => {
  const roh = reihe(5, (i) => i);
  const out = buendeln(roh, 1000, 6000, 400);
  assert.strictEqual(out.length, 5);
  assert.deepStrictEqual(out[0], { t: 1000, v: 0, min: 0, max: 0 });
});

test('viele Punkte werden auf maxPunkte gebuendelt', () => {
  const roh = reihe(5000, (i) => i);
  const out = buendeln(roh, roh[0][0], roh[4999][0], 100);
  assert.ok(out.length <= 100, `erwartet <= 100, war ${out.length}`);
  assert.ok(out.length >= 90);
});

test('Spitzen ueberleben das Buendeln als min/max', () => {
  // Gleichmaessig 10, aber ein einzelner Ausreisser auf 500
  const roh = reihe(1000, (i) => (i === 500 ? 500 : 10));
  const out = buendeln(roh, roh[0][0], roh[999][0], 20);
  assert.ok(out.some((b) => b.max === 500), 'Ausreisser muss als max erhalten bleiben');
  // und darf den Mittelwert nicht dominieren
  assert.ok(out.every((b) => b.v < 60), 'Mittelwert darf nicht auf den Ausreisser springen');
});

test('Luecken erzeugen kein Buendel', () => {
  // Punkte nur in der ersten und letzten Zehntel-Spanne
  const roh = [...reihe(300, () => 5), ...Array.from({ length: 300 }, (_, i) => [900000 + i * 1000, 7])];
  const out = buendeln(roh, 1000, 1200000, 50);
  assert.ok(out.length < 50, 'leere Abschnitte duerfen nicht aufgefuellt werden');
  assert.ok(out.some((b) => b.v === 5) && out.some((b) => b.v === 7));
});

test('Mittelwert je Buendel stimmt', () => {
  const roh = reihe(400, (i) => i);          // Werte 0..399
  const out = buendeln(roh, roh[0][0], roh[399][0], 10);
  assert.strictEqual(out.length, 10);
  assert.ok(Math.abs(out[0].v - 19.5) < 0.6, `erstes Buendel ~19,5, war ${out[0].v}`);
  assert.strictEqual(out[0].min, 0);
  assert.strictEqual(out[9].max, 399);
});

test('maxPunkte wird nach unten auf 10 geklemmt', () => {
  const roh = reihe(400, (i) => i);
  assert.strictEqual(buendeln(roh, roh[0][0], roh[399][0], 1).length, 10);
});

test('entartete Spanne fuehrt nicht zu einer Endlosschleife oder NaN', () => {
  const roh = reihe(1000, (i) => i);
  const out = buendeln(roh, 5000, 5000, 50);  // von == bis
  assert.ok(out.length > 0);
  assert.ok(out.every((b) => Number.isFinite(b.v) && Number.isFinite(b.t)));
});
