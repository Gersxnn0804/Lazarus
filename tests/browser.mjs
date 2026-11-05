import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localPlaywright = path.join(root, '.runtime/browser-tools/node_modules/playwright/index.mjs');
const playwrightModule = process.env.LAZARUS_PLAYWRIGHT_MODULE || (existsSync(localPlaywright) ? localPlaywright : null);
const { chromium } = await import(playwrightModule ? pathToFileURL(path.resolve(root, playwrightModule)).href : 'playwright');
const fixture = JSON.parse(await readFile(path.join(root, 'tests/fixtures/polaris-2.0.0.json'), 'utf8'));
let source = fixture, fault = '';
const logs = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const relative = decodeURIComponent(url.pathname.replace(/^\/Lazarus\//, '/')).replace(/^\//, '') || 'index.html';
  if (relative === 'data/latest_tracking_client.json') {
    response.setHeader('content-type', 'application/json');
    if (fault === 'http') { response.writeHead(503);response.end('{}');return; }
    response.end(fault === 'json' ? '{invalid' : JSON.stringify({ ...source, generatedAt: source.generatedAt || new Date().toISOString() }));return;
  }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403);response.end();return; }
  try {
    let data = await readFile(file);
    if (relative === 'js/app.js') {
      // Tests never serve, inspect or ship the installation's existing credentials.
      const body = data.toString('utf8');
      data = Buffer.from('const AUTH_USERS = [{username:"fixture-user",password:"fixture-pass",role:"TEST"}];\n' + body.slice(body.indexOf('const AUTH_KEY')));
    }
    response.setHeader('content-type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.png') ? 'image/png' : 'text/html');
    response.end(data);
  } catch { response.writeHead(404);response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const output = process.env.LAZARUS_BROWSER_OUTPUT;
if (output) await mkdir(output, { recursive: true });
async function login(page, prefix) {
  await page.goto(base + prefix);
  await page.getByLabel('Usuario', { exact: true }).fill('fixture-user');
  await page.getByLabel('Contraseña', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Entrar al dashboard' }).click();
  await page.getByText('Usuario o contraseña incorrectos.').waitFor();
  await page.getByLabel('Contraseña', { exact: true }).fill('fixture-pass');
  await page.getByRole('button', { name: 'Entrar al dashboard' }).click();
  await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
}

function temporalFixture() {
  const active = fixture.shipments.find(row => row.status === 'RECOLECTADO');
  const delivered = fixture.shipments.find(row => row.deliveryConfirmed);
  const dates = ['2024-02-28', '2024-02-29', '2025-12-31T23:59:59-03:00',
    '2026-01-01T00:00:00-03:00', '2026-01-01T23:59:59-03:00', '2026-01-02T02:59:59Z',
    '2026-01-02T03:00:00Z', '2026-04-30', '2026-05-01', '', 'invalid'];
  const shipments = dates.map((lastEventDate, i) => ({ ...(i === 1 || i === 2 || i === 4 ? delivered : active),
    order: `LT800${i}`, orderType: i === 3 ? 'B2B' : 'B2C', lastEventDate,
    deliveryDate: i === 1 ? '2024-02-29' : i === 2 ? '2025-12-31' : i === 4 ? '2026-01-01' : '' }));
  return { ...fixture, generatedAt: '', shipments: [...shipments, { ...shipments[4] }] };
}

function slaFixture() {
  const bucket = (onTime, mitigated, unmitigated) => ({ b2cOrders: onTime + mitigated + unmitigated,
    eligible: onTime + mitigated + unmitigated, notEvaluable: 0, excluded: 0, onTime, mitigated, unmitigated, withinDeadline: 0 });
  const days = [{ date: '2025-12-31', ...bucket(1, 0, 0) }, { date: '2026-01-01', ...bucket(0, 2, 1) },
    { date: '2026-02-01', ...bucket(3, 0, 2) }];
  const template = fixture.shipments.find(row => row.status === 'RECOLECTADO');
  const delivered = fixture.shipments.find(row => row.deliveryConfirmed);
  const shipments = days.flatMap((day, index) => Array.from({ length: day.b2cOrders }, (_, i) => ({ ...(i < day.onTime ? delivered : template),
    order: `LT700${index}${i}`, orderType: 'B2C', lastEventDate: day.date, deliveryDate: i < day.onTime ? day.date : '' })));
  shipments.push({ ...template, order: 'LT70099', orderType: 'B2C', lastEventDate: '' });
  return { ...fixture, generatedAt: '', shipments, slaKpis: { version: '1.0.0', available: true,
    timeBasis: 'lastEventDate', timezone: 'America/Santiago', semantics: 'currentSnapshot', scope: 'B2C',
    days, undated: bucket(0, 1, 0), total: bucket(4, 3, 3) } };
}

async function assertSla(page, expected) {
  for (const [i, id] of ['kpiOnTime', 'kpiMitigated', 'kpiUnmitigated'].entries())
    assert.equal(await page.locator(`#${id}`).innerText(), String(expected[i]));
}

async function assertCohort(page, total, delivered) {
  assert.equal(await page.locator('#kpiTotal').innerText(), String(total));
  assert.equal(await page.locator('#kpiDelivered').innerText(), String(delivered));
  for (const [chart, legend] of [['#donutChart', '#donutLegend'], ['#statusDonut', '#statusLegend']]) {
    assert.equal(await page.locator(`${chart} b`).innerText(), String(total));
    const counts = await page.locator(`${legend} .legend-row`).evaluateAll(nodes => nodes.map(node => ({
      count: Number(node.dataset.count), rate: node.dataset.percent === '' ? null : Number(node.dataset.percent)
    })));
    assert.equal(counts.reduce((sum, item) => sum + item.count, 0), total);
    for (const item of counts) assert.equal(item.rate, total ? Math.round(item.count / total * 1000) / 10 : null);
    const segments = await page.locator(chart).evaluate(node => node.style.background);
    assert.equal(segments.includes('conic-gradient'), total > 0);
  }
  assert.equal(Number(await page.locator('#donutLegend .legend-row').first().getAttribute('data-count')), delivered);
  const bars = await page.locator('.temporal-values strong').allTextContents();
  assert.equal(bars.reduce((sum, value) => sum + Number(value), 0), total);
  if (!total) {
    assert.ok((await page.locator('#kpiDeliveredRate').innerText()).includes('N/D'));
    assert.ok((await page.locator('#sourceDistribution').innerText()).includes('N/D'));
    assert.equal(await page.locator('#donutLegend').getByText(/0%/).count(), 0);
    const kpis = await page.locator('#kpiGrid .kpi-card > strong').allTextContents();
    assert.deepEqual(kpis, [...Array(12).fill('0'), ...Array(3).fill('N/D')]);
  }
}

async function choosePeriod(page, mode) {
  await page.locator(`[data-period-mode="${mode}"]`).click();
  const visible = await page.locator('[data-period]:visible input').evaluateAll(nodes => nodes.map(node => node.id));
  assert.deepEqual(visible, ({ day: ['periodDay'], month: ['periodMonth'], year: ['periodYear'], calendar: ['periodFrom', 'periodTo'] })[mode]);
}

function allKpiFixture() {
  const row = order => structuredClone(fixture.shipments.find(item => item.order === order));
  const out = { ...row('LT000112'), status: 'EN REPARTO', transportStatus: 'En reparto',
    transportFlow: ['Recolección', 'En tránsito', 'En reparto', 'Entregada'].map(key => ({ key, label: key,
      state: key === 'En reparto' ? 'current' : 'unknown', evidence: key === 'En reparto' ? 'observed' : 'none' })) };
  const insufficient = { ...row('LT000002'), status: 'SIN CLASIFICAR' };
  const templates = [row('LT000101'), row('LT000102'), row('LT000108'), out, row('LT000200'), row('LT000104'),
    row('LT000103'), insufficient, row('LT000002'), row('LT000001')];
  const dated = (day, copies, prefix) => Array.from({ length: copies }, (_, copy) => templates.map((item, i) => ({
    ...item, order: `LT${prefix}${copy}${i}`, lastEventDate: `${day}T23:59:59-03:00`,
    deliveryDate: item.deliveryConfirmed ? `${day}T12:00:00-03:00` : ''
  }))).flat();
  const first = dated('2026-01-01', 1, '91'), second = dated('2026-02-02', 2, '92');
  return { payload: { ...fixture, generatedAt: '', shipments: [...first, ...second, { ...first[0] },
    { ...templates[0], order: 'LT9300', lastEventDate: '' }, { ...templates[0], order: 'LT9301', lastEventDate: 'invalid' }] },
    first: first.map(row => row.order), second: second.map(row => row.order) };
}

async function assertAllKpis(page, multiplier) {
  const expected = { kpiTotal: 10, kpiDelivered: 1, kpiActive: 6, kpiWarehouse: 10, kpiShipped: 7,
    kpiPending: 1, kpiTransit: 1, kpiOutForDelivery: 1, kpiOwn: 1, kpiCritical: 1, kpiReturns: 1, kpiInsufficient: 1 };
  for (const [id, value] of Object.entries(expected)) {
    assert.equal(await page.locator(`#${id}`).innerText(), String(value * multiplier), id);
  }
  await assertCohort(page, 10 * multiplier, multiplier);
  assert.equal(await page.locator('#kpiDeliveredRate').innerText(), `10% de ${10 * multiplier} órdenes filtradas`);
}

async function assertExport(page, expectedOrders) {
  const event = page.waitForEvent('download'); await page.locator('#exportBtn').click();
  const download = await event;
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  const orders = [...csv.matchAll(/^"(LT\d+)",/gm)].map(match => match[1]);
  assert.deepEqual(orders.sort(), [...expectedOrders].sort());
  assert.equal(new Set(orders).size, orders.length);
}

try {
  for (const [width, height] of [[1920,1080], [1366,768], [768,1024], [390,844]]) {
    source = { ...fixture, generatedAt: '' };fault = '';
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    const errors = [];page.on('pageerror', error => errors.push(error.message));
    await login(page, width === 1920 ? '/' : '/Lazarus/');
    assert.equal(await page.locator('.sidebar, .side-nav, .sidebar-footer, aside').count(), 0);
    const main = await page.locator('main').boundingBox();
    assert.ok(Math.abs(main.x) < 1 && Math.abs(main.width - width) < 1);
    for (const target of ['analytics', 'orders', 'detail', 'overview']) {
      await page.locator(`.top-nav a[href="#${target}"]`).click();
      await page.waitForFunction(id => location.hash === `#${id}` && document.querySelector(`.top-nav a[href="#${id}"]`).getAttribute('aria-current') === 'location', target);
      assert.equal(await page.locator('.top-nav a[aria-current]').count(), 1);
    }
    await choosePeriod(page, 'calendar');
    for (const id of ['periodFrom', 'periodTo']) assert.equal(await page.locator(`#${id}`).getAttribute('type'), 'date');
    await page.locator('#clearFiltersBtn').click();
    assert.equal(await page.locator('#kpiTotal').innerText(), '22');
    assert.equal(await page.locator('#channelFilter').inputValue(), '');
    assert.equal(await page.locator('#ordersTable tr').count(), 22);
    assert.equal(await page.locator('#timeGranularity').inputValue(), 'day');
    assert.ok((await page.locator('#temporalDescription').innerText()).includes('lastEventDate'));
    assert.equal(await page.locator('.temporal-column').count(), 1);
    assert.ok((await page.locator('#temporalMeta').innerText()).includes('15 órdenes con fecha · 7 sin fecha válida'));
    await page.locator('#timeGranularity').selectOption('month');
    assert.ok((await page.locator('#temporalDescription').innerText()).includes('por mes'));
    await page.locator('#timeGranularity').selectOption('year');
    assert.equal(await page.locator('.temporal-label').innerText(), '2026');
    assert.equal(await page.locator('.temporal-values strong').innerText(), '15');
    await page.locator('#timeGranularity').selectOption('day');
    assert.equal(await page.locator('#stock-breaks').count(), 0);
    assert.equal(await page.getByText('Termómetro de quiebres de stock', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '16px');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#channelFilter').selectOption('B2B');
    assert.equal(await page.locator('#ordersTable tr').count(), 1);
    assert.equal(await page.locator('#kpiOwn').innerText(), '1');
    assert.equal(await page.locator('.temporal-column').count(), 0);
    assert.ok((await page.locator('#temporalMeta').innerText()).includes('0 órdenes con fecha · 1 sin fecha válida'));
    await page.locator('.order-select').click();
    await page.getByText('Entregada a transporte propio. No confirma recepción del destinatario.').waitFor();
    await page.locator('#channelFilter').selectOption('');
    await page.locator('#searchInput').fill('LT000112');
    await page.locator('.order-select').click();
    const detail = page.locator('#orderDetail');
    assert.ok((await detail.innerText()).includes('RECOLECTADO'));
    assert.ok((await detail.textContent()).includes(' L literal\n'));
    assert.ok((await detail.textContent()).includes(' M literal '));
    await page.locator('#searchInput').fill('LT000201');await page.locator('.order-select').click();
    const signed = page.locator('.detail-row').filter({ has: page.getByText('Signed By', { exact: true }) }).locator('strong');
    assert.equal(await signed.innerText(), '');
    await page.locator('#clearFiltersBtn').click();
    const layout = await page.evaluate(() => {
      const selectors = '.topbar, .top-nav, .top-nav a, .period-modes, .period-panel, .kpi-card, .analytics-grid .panel, .legend-row, .source-row, .status-distribution-row';
      const clipped = [...document.querySelectorAll(selectors)].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className);
      const circles = [...document.querySelectorAll('.donut')].map(node => {
        const outer = node.getBoundingClientRect(), inner = node.querySelector('span').getBoundingClientRect();
        return Math.abs(outer.width - outer.height) < 1 && Math.abs((outer.left + outer.right - inner.left - inner.right) / 2) < 1
          && Math.abs((outer.top + outer.bottom - inner.top - inner.bottom) / 2) < 1;
      });
      return { clipped, circles };
    });
    assert.deepEqual(layout.clipped, []); assert.ok(layout.circles.every(Boolean));
    if (output) {
      await page.locator('.topbar').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `header-${width}.png`), style: '#toast { visibility: hidden; }' });
      await page.screenshot({ path: path.join(output, `lazarus-${width}.png`), fullPage: true, style: '#toast { visibility: hidden; }' });
      await page.locator('#analytics').screenshot({ path: path.join(output, `donuts-${width}.png`), style: '#toast { visibility: hidden; }' });
    }
    assert.deepEqual(errors, []);
    logs.push({ width, height, login: 'PASS', scopes: 'PASS', temporalGranularity: 'PASS', temporalFilters: 'PASS', ownTransport: 'PASS', emptySignedBy: 'PASS', comments: 'PASS', overflow: 'PASS', topNavigation: 'PASS', sidebarRemoved: 'PASS', visibleRange: 'PASS' });
    await context.close();
  }
  for (const timezoneId of ['America/Santiago', 'UTC', 'Asia/Tokyo']) {
    source = temporalFixture(); fault = '';
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId });
    const page = await context.newPage();
    await page.clock.install();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page, '/Lazarus/');
    assert.equal(await page.locator('#kpiTotal').innerText(), '11');
    await page.locator('#periodDay').fill('2026-01-01');
    await assertCohort(page, 3, 1);
    assert.ok((await page.locator('#periodDiagnostics').innerText()).includes('2 órdenes sin fecha'));
    const before = await page.locator('#donutChart').evaluate(node => { window.testDonut = node; return node.style.background; });
    await page.locator('#periodDay').fill('2025-12-31');
    await assertCohort(page, 1, 1);
    assert.notEqual(await page.locator('#donutChart').evaluate(node => node.style.background), before);
    assert.equal(await page.locator('#donutChart').evaluate(node => node === window.testDonut), true);
    await choosePeriod(page, 'month');
    await page.locator('#periodMonth').fill('2026-01');
    await assertCohort(page, 4, 1);
    await page.locator('#periodMonth').fill('2024-02');
    await assertCohort(page, 2, 1);
    assert.ok((await page.locator('#activePeriod').innerText()).includes('29-02-2024'));
    for (const [month, total, end] of [['2023-02', 0, '28-02-2023'], ['2026-04', 1, '30-04-2026'], ['2026-05', 1, '31-05-2026']]) {
      await page.locator('#periodMonth').fill(month); await assertCohort(page, total, 0);
      assert.ok((await page.locator('#activePeriod').innerText()).includes(end));
    }
    await choosePeriod(page, 'year');
    await page.locator('#periodYear').fill('2026'); await page.locator('#periodYear').press('Tab');
    await assertCohort(page, 6, 1);
    await choosePeriod(page, 'calendar');
    await page.locator('#periodFrom').fill('2025-12-31'); await page.locator('#periodTo').fill('2026-01-01');
    await assertCohort(page, 4, 2);
    await page.locator('#periodFrom').fill('2026-01-01');
    await assertCohort(page, 3, 1);
    await page.locator('#periodFrom').fill('2026-02-01');
    assert.ok((await page.locator('#periodError').innerText()).includes('posterior'));
    await assertCohort(page, 0, 0);
    await page.locator('#periodFrom').fill('2026-01-01');
    await page.locator('#channelFilter').selectOption('B2C');
    await page.locator('#statusFilter').selectOption('ENTREGADA');
    await page.locator('#searchInput').fill('lt8004');
    await page.locator('#dateFilter').selectOption('01-01-2026');
    await assertCohort(page, 1, 1);
    const periodLabel = await page.locator('#activePeriod').innerText();
    await page.locator('#reloadBtn').click();
    await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
    await assertCohort(page, 1, 1);
    assert.equal(await page.locator('#activePeriod').innerText(), periodLabel);
    source = { ...source, shipments: source.shipments.filter(row => row.order !== 'LT8004') };
    const refreshed = page.waitForResponse(response => response.url().includes('latest_tracking_client.json'));
    await page.clock.fastForward(60001); await refreshed;
    await page.waitForFunction(() => document.getElementById('kpiTotal').textContent === '0');
    await assertCohort(page, 0, 0);
    assert.equal(await page.locator('#activePeriod').innerText(), periodLabel);
    assert.equal(await page.locator('#statusFilter').inputValue(), 'ENTREGADA');
    assert.equal(await page.locator('#searchInput').inputValue(), 'lt8004');
    assert.equal(await page.locator('#channelFilter').inputValue(), 'B2C');
    assert.equal(await page.locator('#dateFilter').inputValue(), '01-01-2026');
    source = { ...source, shipments: source.shipments.filter(row => !row.deliveryConfirmed) };
    await page.locator('#reloadBtn').click();
    await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
    assert.equal(await page.locator('#statusFilter').inputValue(), 'ENTREGADA');
    await assertCohort(page, 0, 0);
    await page.locator('#clearFiltersBtn').click();
    assert.equal(await page.locator('#allDates').isChecked(), true);
    assert.equal(await page.locator('#kpiTotal').innerText(), '8');
    source = { ...source, shipments: [] }; await page.locator('#reloadBtn').click();
    await page.waitForFunction(() => document.getElementById('kpiTotal').textContent === '0');
    await assertCohort(page, 0, 0);
    await page.getByRole('heading', { name: 'Sin datos para el período', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    logs.push({ timezoneId, temporalSelection: 'PASS', dynamicKpisAndSegments: 'PASS', inclusiveLimits: 'PASS',
      leapYear: 'PASS', combinedFilters: 'PASS', duplicateLT: 'PASS', invalidRange: 'PASS', empty: 'PASS', refreshPeriod: 'PASS' });
    await context.close();
  }
  for (const width of [1920, 1366]) {
    const sample = allKpiFixture(); source = sample.payload; fault = '';
    const context = await browser.newContext({ viewport: { width, height: 1080 }, timezoneId: 'America/Santiago' });
    const page = await context.newPage();
    await login(page, '/Lazarus/');
    await choosePeriod(page, 'day');
    await page.locator('#periodDay').fill('2026-01-01');
    await assertAllKpis(page, 1); await assertExport(page, sample.first);
    await page.locator('#periodDay').fill('2026-02-02');
    await assertAllKpis(page, 2); await assertExport(page, sample.second);
    await page.locator('#timeGranularity').selectOption('year');
    await assertAllKpis(page, 2);
    const label = await page.locator('#activePeriod').innerText();
    await page.locator('#reloadBtn').click();
    await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
    await assertAllKpis(page, 2);
    assert.equal(await page.locator('#activePeriod').innerText(), label);
    await page.locator('#statusFilter').selectOption('ENTREGADA');
    await page.locator('#channelFilter').selectOption('B2C');
    await page.locator('#searchInput').fill('LT9200');
    await assertExport(page, ['LT9200']);
    await page.locator('#clearFiltersBtn').click();
    assert.equal(await page.locator('#kpiTotal').innerText(), '32');
    await choosePeriod(page, 'calendar');
    await page.locator('#periodFrom').fill('2026-01-01'); await page.locator('#periodTo').fill('2026-02-02');
    await assertAllKpis(page, 3); await assertExport(page, [...sample.first, ...sample.second]);
    if (output) await page.locator('.period-panel').screenshot({ path: path.join(output, `range-${width}.png`) });
    await page.locator('#periodFrom').fill('');
    await assertCohort(page, 0, 0);
    assert.equal(await page.locator('#periodError').isVisible(), true);
    logs.push({ width, all12KpisChange: 'PASS', scopedCsvContents: 'PASS', groupingIndependent: 'PASS', rangeAndReset: 'PASS' });
    await context.close();
  }
  for (const width of [1920, 1366, 768, 390, 320]) {
    source = slaFixture(); fault = '';
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); await page.clock.install();
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await login(page, '/Lazarus/'); await assertSla(page, [4, 3, 3]);
    await choosePeriod(page, 'day'); await page.locator('#periodDay').fill('2026-01-01');
    await assertSla(page, [0, 2, 1]);
    await choosePeriod(page, 'month'); await page.locator('#periodMonth').fill('2026-02');
    await assertSla(page, [3, 0, 2]);
    await choosePeriod(page, 'year'); await page.locator('#periodYear').fill('2026');
    await assertSla(page, [3, 2, 3]);
    await choosePeriod(page, 'calendar'); await page.locator('#periodFrom').fill('2025-12-31');
    await page.locator('#periodTo').fill('2026-01-01'); await assertSla(page, [1, 2, 1]);
    source.slaKpis.days[1].mitigated--; source.slaKpis.days[1].unmitigated++;
    source.slaKpis.total.mitigated--; source.slaKpis.total.unmitigated++;
    await page.clock.fastForward(60001);
    await page.waitForFunction(() => document.getElementById('kpiMitigated').textContent === '1');
    await assertSla(page, [1, 1, 2]);
    assert.equal(await page.locator('#periodFrom').inputValue(), '2025-12-31');
    await page.locator('#searchInput').fill('LT700'); await assertSla(page, ['N/D', 'N/D', 'N/D']);
    await page.locator('#clearFiltersBtn').click(); await assertSla(page, [4, 2, 4]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const clipped = await page.locator('.kpi-card, .kpi-card > strong, .kpi-card > small').evaluateAll(nodes =>
      nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.id || node.className));
    assert.deepEqual(clipped, []);
    if (output) await page.locator('#kpiGrid').screenshot({ path: path.join(output, `sla-kpis-${width}.png`) });
    delete source.slaKpis; await page.locator('#reloadBtn').click();
    await page.waitForFunction(() => document.getElementById('kpiOnTime').textContent === 'N/D');
    await assertSla(page, ['N/D', 'N/D', 'N/D']);
    logs.push({ width, slaPeriods: 'PASS', slaAutomaticRefresh: 'PASS', slaOldJson: 'PASS', slaResponsive: 'PASS' });
    await context.close();
  }
  const context = await browser.newContext();const page = await context.newPage();
  await page.clock.install();source = { ...fixture, generatedAt: '' };
  await login(page, '/Lazarus/');
  for (const failure of ['http', 'json', 'version']) {
    fault = failure === 'version' ? '' : failure;
    source = failure === 'version' ? { ...fixture, schemaVersion: '9.0.0' } : { ...fixture, generatedAt: '' };
    await page.locator('#reloadBtn').click();
    await page.locator('#sourceStatus').filter({ hasText: 'Actualización fallida' }).waitFor();
    assert.equal(await page.locator('#kpiTotal').innerText(), '22');
  }
  fault = '';source = { ...fixture, generatedAt: '2020-01-01' };
  await page.reload();await page.locator('#sourceStatus').filter({ hasText: 'Datos desactualizados' }).waitFor();
  const legacy = JSON.parse(await readFile(path.join(root, 'tests/fixtures/published-1.2.0.sanitized.json'), 'utf8'));
  source = { ...legacy, generatedAt: '' };await page.reload();
  await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
  assert.ok((await page.locator('#sourceMeta').innerText()).includes('1.2.0'));
  const template = fixture.shipments.find(r => r.status === 'RECOLECTADO');
  source = { ...fixture, generatedAt: '', shipments: Array.from({ length: 2000 }, (_, i) => ({ ...template, order: `LT99${String(i).padStart(7, '0')}`, waybill: `000${String(i).padStart(8, '0')}` })) };
  await page.reload();await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
  assert.equal(await page.locator('#ordersTable tr').count(), 50);
  await page.locator('#nextPageBtn').click();
  const pageInfo = await page.locator('#pageInfo').innerText();
  await page.clock.fastForward(60001);
  await page.waitForFunction(() => document.getElementById('sourceStatus').textContent === 'Datos cargados');
  assert.equal(await page.locator('#pageInfo').innerText(), pageInfo);
  await page.locator('#searchInput').fill('LT990000001');
  const download = page.waitForEvent('download');await page.locator('#exportBtn').click();
  const file = await download;assert.ok(file.suggestedFilename().endsWith('.csv'));
  source.shipments[1].originalComment = '<img src=x onerror="window.__xss=1">';
  await page.reload();await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
  await page.locator('#searchInput').fill(source.shipments[1].order);await page.locator('.order-select').click();
  assert.equal(await page.locator('#orderDetail img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  fault = 'http';await page.reload();await page.locator('#sourceStatus').filter({ hasText: 'Sin datos' }).waitFor();
  assert.equal(await page.locator('#kpiTotal').innerText(), 'N/D');
  fault = '';await page.locator('#reloadBtn').click();await page.locator('#sourceStatus').filter({ hasText: 'Datos cargados' }).waitFor();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.locator('#loginForm').waitFor();
  logs.push({ failuresRetainSnapshot: 'PASS', firstLoadFailure: 'PASS', xss: 'PASS', stale: 'PASS', publishedLegacySample: 'PASS', rows: 2000, rendered: 50, refreshPagination: 'PASS', export: 'PASS', logout: 'PASS' });
  await context.close();
  if (output) await writeFile(path.join(output, 'browser-results.json'), JSON.stringify(logs, null, 2));
  console.log(JSON.stringify(logs, null, 2));
} finally { await browser.close();await new Promise(resolve => server.close(resolve)); }
