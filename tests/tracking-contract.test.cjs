const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/tracking-contract.js');
const fixture = version => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `polaris-${version}.json`), 'utf8'));
const wrap = row => ({ schemaVersion: '1.2.0', generatedAt: '2026-10-21T12:00:00-03:00', shipments: [row] });
const legacyRow = extra => ({ order: 'LT00001', waybill: '0000123', status: 'SIN CLASIFICAR', ...extra });
const normalize = input => C.normalizePayload(input, { now: Date.parse('2026-10-21T19:00:00Z') });

for (const version of C.VERSIONS) test(`Consume ${version} y conserva identidad, fuentes y entrega real`, () => {
  const input = fixture(version), before = JSON.stringify(input), data = normalize(input);
  assert.equal(data.shipments.length, 22);
  assert.equal(data.shipments.find(r => r.order === 'LT000101').waybill, '0000000101');
  assert.equal(data.shipments.find(r => r.order === 'LT000201').waybill, '');
  assert.equal(data.shipments.find(r => r.order === 'LT000101').signedBy, 'RECEPTOR FICTICIO');
  assert.equal(data.shipments.find(r => r.order === 'LT000201').signedBy, '');
  assert.equal(data.shipments.find(r => r.order === 'LT000202').warehouseStatus, '');
  assert.equal(data.shipments.find(r => r.order === 'LT000006').transportStatus, '');
  assert.equal(data.summary.totalShipments, 22);
  assert.equal(data.summary.delivered, 2);
  assert.equal(data.summary.ownTransport, 1);
  for (let i = 1; i <= 6; i++) assert.equal(data.shipments.find(r => r.order === `LT${String(i).padStart(6, '0')}`).status, C.WAREHOUSE[i - 1]);
  assert.equal(JSON.stringify(input), before);
  const otherType = fixture(version);otherType.shipments.find(r => r.order === 'LT000200').orderType = 'OTRO';
  assert.equal(normalize(otherType).shipments.find(r => r.order === 'LT000200').transportHandover.confirmed, true);
});
test('Las fechas ISO conservan mes/día y no aceptan fechas imposibles', () => {
  assert.equal(C.parseDate('2026-08-10T15:00:00-04:00').month, 8);
  assert.equal(C.parseDate('2026-08-10').day, 10);
  assert.equal(C.parseDate('10/08/2026').month, 8);
  for (const value of ['2026-31-07', '2026-02-30', '2026-08-01 25:00:00', 'garbage']) assert.equal(C.parseDate(value), null);
});
test('Agrupa lastEventDate por día, mes y año en America/Santiago', () => {
  const rows = [
    { lastEventDate: '2025-12-31T23:30:00-03:00', deliveryConfirmed: true },
    { lastEventDate: '2026-01-01T01:00:00+14:00', deliveryConfirmed: false },
    { lastEventDate: '02/01/2026 10:00:00', deliveryConfirmed: true },
    { lastEventDate: '2026-02-15', deliveryConfirmed: false },
    { lastEventDate: '', deliveryConfirmed: false }
  ];
  const day = C.buildTemporalSeries(rows, 'day');
  assert.deepEqual(day.points.map(point => [point.label, point.total, point.delivered]), [
    ['31-12-2025', 2, 1], ['02-01-2026', 1, 1], ['15-02-2026', 1, 0]
  ]);
  assert.deepEqual(C.buildTemporalSeries(rows, 'month').points.map(point => [point.label, point.total]), [
    ['12-2025', 2], ['01-2026', 1], ['02-2026', 1]
  ]);
  assert.deepEqual(C.buildTemporalSeries(rows, 'year').points.map(point => [point.label, point.total]), [
    ['2025', 2], ['2026', 2]
  ]);
  for (const granularity of ['day', 'month', 'year']) {
    const series = C.buildTemporalSeries(rows, granularity);
    assert.equal(series.dated, 4);
    assert.equal(series.undated, 1);
    assert.equal(series.points.reduce((total, point) => total + point.total, 0), 4);
  }
});
test('La serie temporal soporta vacío, un registro y rechaza contratos inválidos', () => {
  assert.deepEqual(C.buildTemporalSeries([], 'day'), { granularity: 'day', points: [], dated: 0, undated: 0 });
  assert.deepEqual(C.buildTemporalSeries([{ lastEventDate: '2026-10-04', deliveryConfirmed: true }], 'year').points,
    [{ key: '2026', label: '2026', total: 1, delivered: 1 }]);
  assert.throws(() => C.buildTemporalSeries([], 'week'), /Granularidad/);
  assert.throws(() => C.buildTemporalSeries(null, 'day'), /lista/);
});
test('Todos los estados Warehouse y Cancelled mantienen su terminal alternativo', () => {
  for (const status of C.WAREHOUSE) {
    const row = normalize(wrap(legacyRow({ status, warehouseStatus: status }))).shipments[0];
    assert.equal(row.warehouseFlow.find(s => s.state === 'current').key, status);
    if (status === 'Cancelled') assert.ok(row.warehouseFlow.slice(1).every(s => s.state === 'disabled'));
    assert.equal(row.events.length, 0);
    assert.equal(row.deliveryConfirmed, false);
  }
});
for (const [raw, status] of Object.entries(C.CATALOG)) test(`Fallback 1.2.0: ${raw} → ${status}`, () => {
  const row = normalize(wrap(legacyRow({ status: 'ENTREGADO', category: 'Finalizado', shipmentState: raw, lastEventDate: '2026-10-01' }))).shipments[0];
  assert.equal(row.status, status);
  assert.equal(row.deliveryConfirmed, status === 'ENTREGADA');
  if (raw === 'shipment data received') assert.equal(row.transportStatus, '');
  if (raw === 'shipment on hold') assert.equal(row.transportStatus, '');
});
test('Se prefiere el canónico válido; Finalizado y ausencia de datos nunca prueban entrega', () => {
  const row = normalize(wrap(legacyRow({ status: 'PROGRAMADO', shipmentState: 'Shipment picked up' }))).shipments[0];
  assert.equal(row.status, 'PROGRAMADO');
  for (const extra of [{ status: 'ENTREGADO', category: 'Finalizado' }, { status: 'ENTREGADA', deliveryConfirmed: false }, { category: 'Finalizado' }]) {
    assert.equal(normalize(wrap(legacyRow(extra))).shipments[0].deliveryConfirmed, false);
  }
});
test('Las etapas inferidas no generan historial; L/M y firma vacía se preservan', () => {
  const row = normalize(wrap(legacyRow({ status: 'RECOLECTADO', shipmentState: 'Shipment picked up', warehouseStatus: 'Shipped',
    lastEventDate: '2026-10-01', signedByRaw: '', signedBy: 'Entregado', originalStatus: ' L\n ', originalComment: ' M ' }))).shipments[0];
  assert.equal(row.signedBy, ''); assert.equal(row.originalStatus, ' L\n '); assert.equal(row.originalComment, ' M ');
  assert.ok(row.warehouseFlow.some(step => step.evidence === 'inferred'));
  assert.equal(row.events.length, 1);
});
test('Privacidad: política denegada elimina campos y atributos internos de los modelos', () => {
  for (const version of C.VERSIONS) {
    const payload = fixture(version); payload.publicationPolicy = { signedBy: false, comments: false };
    payload.shipments[0].mitigation = { secret: 'PRIVATE_TOKEN' }; payload.shipments[0].rawRecord = { secret: 'PRIVATE_TOKEN' };
    const data = normalize(payload);
    assert.ok(data.shipments.every(r => !r.signedBy && !r.originalStatus && !r.originalComment));
    assert.ok(!JSON.stringify(data).includes('PRIVATE_TOKEN'));
  }
});
test('Duplicados iguales y fuentes complementarias conservan una LT; conflictos no inventan entrega', () => {
  const warehouse = legacyRow({ status: 'Shipped', warehouseStatus: 'Shipped', orderType: 'B2C' });
  const transport = legacyRow({ status: 'RECOLECTADO', shipmentState: 'Shipment picked up' });
  const source = wrap(warehouse);source.shipments.push(transport, transport);
  const data = normalize(source);assert.equal(data.shipments.length, 1);assert.equal(data.summary.totalShipments, 1);
  assert.equal(data.shipments[0].warehouseStatus, 'Shipped');assert.equal(data.shipments[0].transportStatus, 'Recolección');
  source.shipments.push({ ...transport, waybill: '000999' });
  const conflict = normalize(source).shipments[0];assert.equal(conflict.waybill, '');assert.equal(conflict.deliveryConfirmed, false);
  assert.ok(conflict.warnings.includes('DUPLICATE_ORDER_CONFLICT'));
});
test('Entradas inválidas se rechazan sin perder órdenes válidas, identificadores numéricos no se convierten', () => {
  for (const input of [null, {}, { schemaVersion: '3.0.0', shipments: [] }, { schemaVersion: '2.0.0', shipments: {} }]) assert.throws(() => normalize(input));
  const data = normalize({ ...wrap(legacyRow()), shipments: [legacyRow(), { order: 123, waybill: 123 }, null] });
  assert.equal(data.shipments.length, 1);assert.equal(data.diagnostics.rejected.length, 2);
});
test('Contradicciones de entrega/progreso y Cancelled se muestran en revisión', () => {
  for (const change of [{ deliveryConfirmed: false }, { warehouseStatus: 'Cancelled' }, { transportStatus: 'Recolección' }]) {
    const payload = fixture('2.0.0'), source = payload.shipments.find(r => r.order === 'LT000101');
    Object.assign(source, change);const row = normalize(payload).shipments.find(r => r.order === source.order);
    assert.equal(row.deliveryConfirmed, false);
  }
});
test('Frescura, campos ausentes y KPIs no disponibles son explícitos', () => {
  const data = normalize(wrap(legacyRow({ status: 'Released', warehouseStatus: 'Released' })));
  assert.equal(data.summary.delivered, null);assert.equal(data.summary.inTransit, null);assert.equal(data.summary.returns, null);
  assert.equal(data.summary.totalShipments, 1);
  assert.equal(normalize({ ...wrap(legacyRow()), generatedAt: '2026-01-01' }).freshness, 'stale');
  assert.equal(normalize({ ...wrap(legacyRow()), generatedAt: 'bad' }).freshness, 'unknown');
});
test('CSV conserva filtros y ceros iniciales sin permitir fórmulas', () => {
  const data = normalize(wrap(legacyRow({ originalComment: '=HYPERLINK("malicious")' })));
  const csv = C.csv(data.shipments);
  assert.ok(csv.includes('"\'0000123"'));assert.ok(csv.includes("'=HYPERLINK"));assert.equal(csv.split('\r\n').length, 2);
});
test('Los receptores ficticios heredados no se presentan como Signed By', () => {
  for (const signedBy of ['Entregado', 'No firma', 'Sin información']) {
    const row = normalize(wrap(legacyRow({ shipmentState: 'Shipment delivered ok', lastEventDate: '2026-10-01', signedBy }))).shipments[0];
    assert.equal(row.signedBy, '');
  }
});

test('Períodos inclusivos: día completo, meses 28/29/30/31, año y calendario entre años', () => {
  for (const [month, end] of [['2023-02', '28'], ['2024-02', '29'], ['2026-04', '30'], ['2026-01', '31']]) {
    assert.deepEqual(C.buildPeriod('month', { month }), { from: `${month}-01`, to: `${month}-${end}` });
  }
  assert.deepEqual(C.buildPeriod('year', { year: '2024' }), { from: '2024-01-01', to: '2024-12-31' });
  const dates = ['2025-12-30', '2025-12-31T00:00:00-03:00', '2025-12-31T23:59:59-03:00', '2026-01-01', '2026-02-01', '2026-02-02'];
  const rows = dates.map((lastEventDate, i) => ({ order: `LT${i}`, lastEventDate }));
  const selected = period => C.selectDashboardRows(rows, { period }).rows.map(row => row.order);
  assert.deepEqual(selected(C.buildPeriod('day', { day: '2025-12-31' })), ['LT1', 'LT2']);
  assert.deepEqual(selected(C.buildPeriod('calendar', { from: '2025-12-31', to: '2025-12-31' })), ['LT1', 'LT2']);
  assert.deepEqual(selected(C.buildPeriod('calendar', { from: '2025-12-31', to: '2026-02-01' })), ['LT1', 'LT2', 'LT3', 'LT4']);
  for (const [mode, values] of [['calendar', { from: '2026-02-01', to: '2025-12-31' }], ['calendar', { from: '2026-01-01' }],
    ['day', { day: '2026-02-29' }], ['month', { month: '2026-13' }], ['year', { year: '1899' }], ['year', { year: '2026.5' }]]) {
    assert.throws(() => C.buildPeriod(mode, values), RangeError);
  }
});

test('La fecha operacional convierte instantes UTC y conserva fechas civiles, incluyendo cambio de horario', () => {
  const values = [
    ['2026-01-01T02:59:59Z', '2025-12-31'], ['2026-01-01T03:00:00Z', '2026-01-01'],
    ['2026-07-01T03:59:59Z', '2026-06-30'], ['2026-07-01T04:00:00Z', '2026-07-01'],
    ['2026-09-06', '2026-09-06'], ['06/09/2026 00:30', '2026-09-06'], ['2026-09-06T04:00:00Z', '2026-09-06']
  ];
  for (const [value, expected] of values) assert.equal(C.operationalDateKey(value), expected);
  for (const value of ['', 'invalid', '2026-02-30', '2026-10-01T25:00:00Z']) assert.equal(C.operationalDateKey(value), null);
});

test('Una cohorte deduplicada alimenta KPIs, porcentajes y series con filtros combinados', () => {
  const payload = fixture('2.0.0');
  payload.shipments.push(payload.shipments.find(row => row.order === 'LT000101'));
  const rows = normalize(payload).shipments;
  const target = rows.find(row => row.order === 'LT000101');
  const period = C.buildPeriod('day', { day: C.operationalDateKey(target.lastEventDate) });
  const scope = C.selectDashboardRows(rows, { period, search: target.order.toLowerCase(), status: target.status,
    channel: target.orderSegment, category: target.category });
  assert.equal(scope.rows.length, 1);
  const summary = C.buildSummary(scope.rows), distribution = C.buildDeliveryDistribution(scope.rows);
  assert.equal(summary.totalShipments, 1); assert.equal(summary.delivered, 1);
  assert.equal(distribution.reduce((sum, item) => sum + item.value, 0), summary.totalShipments);
  assert.equal(C.buildTemporalSeries(scope.rows).dated, summary.totalShipments);
  assert.equal(C.selectDashboardRows([...rows, target], { period, search: target.order }).rows.length, 1);
  assert.equal(C.selectDashboardRows(rows, { period, channel: 'not-a-segment' }).rows.length, 0);
});

test('Sin fechas no se sustituye el evento por publicación, actualización o entrega; vacío no divide por cero', () => {
  const rows = [{ order: 'LT1', lastEventDate: '', deliveryDate: '2026-01-01', lastUpdatedAt: '2026-01-01', generatedAt: '2026-01-01' },
    { order: 'LT2', lastEventDate: 'invalid' }];
  const scope = C.selectDashboardRows(rows, { period: C.buildPeriod('year', { year: '2026' }) });
  assert.equal(scope.undated, 2); assert.deepEqual(scope.rows, []);
  assert.equal(C.selectDashboardRows(rows).rows.length, 2);
  assert.deepEqual(C.selectDashboardRows([]), { rows: [], undated: 0, matching: 0 });
  assert.equal(C.buildSummary(scope.rows).totalShipments, 0);
  assert.ok(C.buildDeliveryDistribution(scope.rows).every(item => item.value === 0));
});

test('La confirmación en la cohorte no se reinterpreta como entrega ocurrida durante el período', () => {
  const row = normalize(fixture('2.0.0')).shipments.find(row => row.deliveryConfirmed);
  const scope = C.selectDashboardRows([{ ...row, lastEventDate: '2026-10-20', deliveryDate: '2026-10-01' }], {
    period: C.buildPeriod('day', { day: '2026-10-20' })
  });
  assert.equal(C.buildSummary(scope.rows).delivered, 1);
  assert.equal(C.buildDeliveryDistribution(scope.rows)[0].value, 1);
});
