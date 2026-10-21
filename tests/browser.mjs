import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.LAZARUS_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.LAZARUS_PLAYWRIGHT_MODULE).href : 'playwright');
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
try {
  for (const [width, height] of [[1920,1080], [1366,768], [768,1024], [390,844]]) {
    source = { ...fixture, generatedAt: '' };fault = '';
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    const errors = [];page.on('pageerror', error => errors.push(error.message));
    await login(page, width === 1920 ? '/' : '/Lazarus/');
    assert.equal(await page.locator('#kpiTotal').innerText(), '22');
    assert.equal(await page.locator('#channelFilter').inputValue(), '');
    assert.equal(await page.locator('#ordersTable tr').count(), 22);
    assert.equal(await page.locator('#stock-breaks').count(), 0);
    assert.equal(await page.getByText('Termómetro de quiebres de stock', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '16px');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#channelFilter').selectOption('B2B');
    assert.equal(await page.locator('#ordersTable tr').count(), 1);
    assert.equal(await page.locator('#kpiOwn').innerText(), '1');
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
    if (output) await page.screenshot({ path: path.join(output, `lazarus-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    logs.push({ width, height, login: 'PASS', scopes: 'PASS', ownTransport: 'PASS', emptySignedBy: 'PASS', comments: 'PASS', overflow: 'PASS' });
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
