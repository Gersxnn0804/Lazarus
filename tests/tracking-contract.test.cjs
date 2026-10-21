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
