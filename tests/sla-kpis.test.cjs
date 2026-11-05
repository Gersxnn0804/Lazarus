const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/tracking-contract.js');

function bucket(onTime = 0, mitigated = 0, unmitigated = 0, notEvaluable = 0) {
  const eligible = onTime + mitigated + unmitigated;
  return { b2cOrders: eligible + notEvaluable, eligible, notEvaluable, excluded: 0, onTime, mitigated, unmitigated, withinDeadline: 0 };
}
function fixture() {
  return { version: '1.0.0', available: true, timeBasis: 'lastEventDate', timezone: 'America/Santiago',
    semantics: 'currentSnapshot', scope: 'B2C', days: [
      { date: '2025-12-31', ...bucket(1, 0, 0) }, { date: '2026-01-01', ...bucket(0, 2, 1) },
      { date: '2026-02-01', ...bucket(3, 0, 2) }], undated: bucket(0, 1, 0), total: bucket(4, 3, 3) };
}
test('SLA día/mes/año/rango/snapshot suman exclusivamente buckets de lastEventDate', () => {
  const data = C.normalizeSlaKpis(fixture());
  for (const [mode, values, expected] of [
    ['day', { day: '2026-01-01' }, [0, 2, 1]], ['month', { month: '2026-02' }, [3, 0, 2]],
    ['year', { year: '2026' }, [3, 2, 3]], ['calendar', { from: '2025-12-31', to: '2026-01-01' }, [1, 2, 1]]]) {
    const result = C.selectSlaKpis(data, { period: C.buildPeriod(mode, values) });
    assert.deepEqual([result.onTime, result.mitigated, result.unmitigated], expected);
  }
  const total = C.selectSlaKpis(data);
  assert.deepEqual([total.onTime, total.mitigated, total.unmitigated], [4, 3, 3]);
  assert.equal(C.selectSlaKpis(data, { period: { from: '2027-01-01', to: '2027-01-02' } }).onTime, 0);
});
test('contrato antiguo, cobertura parcial y filtros incompatibles muestran N/D', () => {
  assert.equal(C.selectSlaKpis(C.normalizeSlaKpis()).onTime, null);
  const raw = fixture(); raw.days[0] = { date: '2025-12-31', ...bucket(1, 0, 0, 1) }; raw.total = bucket(4, 3, 3, 1);
  const data = C.normalizeSlaKpis(raw);
  assert.equal(C.selectSlaKpis(data).onTime, null);
  assert.equal(C.selectSlaKpis(data, { period: C.buildPeriod('year', { year: '2026' }) }).onTime, 3);
  assert.equal(C.selectSlaKpis(data, { unsupportedFilters: true }).mitigated, null);
  assert.equal(C.selectSlaKpis(data, { invalidPeriod: true }).unmitigated, null);
});
test('contrato corrupto, fechas duplicadas, conteos negativos y versión desconocida no producen ceros falsos', () => {
  for (const mutate of [r => r.total.onTime++, r => r.days.push(r.days[0]), r => r.days[0].date = '2026-02-30',
    r => r.version = '2.0.0', r => r.total.onTime = -1, r => r.total.onTime = '4', r => r.timeBasis = 'deliveryDate',
    r => delete r.undated, r => r.available = false]) {
    const raw = fixture(); mutate(raw); assert.equal(C.normalizeSlaKpis(raw), null);
  }
});
test('adaptador conserva extensión y actualización sustituye valores sin mutar snapshot', () => {
  const raw = { schemaVersion: '2.0.0', shipments: [], slaKpis: fixture() };
  const original = JSON.stringify(raw);
  assert.equal(C.selectSlaKpis(C.normalizePayload(raw).slaKpis).onTime, 4);
  assert.equal(JSON.stringify(raw), original);
  raw.slaKpis.days[0] = { date: '2025-12-31', ...bucket(2, 0, 0) }; raw.slaKpis.total = bucket(5, 3, 3);
  assert.equal(C.selectSlaKpis(C.normalizePayload(raw).slaKpis).onTime, 5);
  delete raw.slaKpis;
  assert.equal(C.normalizePayload(raw).slaKpis, null);
});
