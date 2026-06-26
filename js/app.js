const DATA_URL = 'data/latest_tracking_client.json';
const AUTO_REFRESH_MS = 60000;
const PAGE_SIZE = 50;

const AUTH_USERS = [
  {
    username: "DHLUniformes",
    password: "Elmejoranalista.",
    role: "DHL"
  },
  {
    username: "LATAMUniformes",
    password: "Latam_Uniformes2026",
    role: "LATAM"
  }
];

const AUTH_KEY = "lazarus_auth_session";

function initAuth() {
  const loginScreen = document.getElementById("loginScreen");
  const appShell = document.getElementById("appShell");
  const loginForm = document.getElementById("loginForm");
  const loginUser = document.getElementById("loginUser");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const logoutBtn = document.getElementById("logoutBtn");

  const currentSession = localStorage.getItem(AUTH_KEY);

  if (currentSession) {
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    return;
  }

  loginScreen.classList.remove("hidden");
  appShell.classList.add("hidden");

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const username = loginUser.value.trim();
    const password = loginPassword.value;

    const validUser = AUTH_USERS.find(
      (user) => user.username === username && user.password === password
    );

    if (!validUser) {
      loginError.textContent = "Usuario o contraseña incorrectos.";
      loginPassword.value = "";
      return;
    }

    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        username: validUser.username,
        role: validUser.role,
        loginAt: new Date().toISOString()
      })
    );

    loginError.textContent = "";
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");

    if (typeof loadTrackingData === "function") {
      loadTrackingData();
    }
  });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem(AUTH_KEY);
    window.location.reload();
  });
}

document.addEventListener("DOMContentLoaded", initAuth);

const state = {
  raw: null,
  shipments: [],
  filtered: [],
  selectedOrder: null,
  page: 1,
  sortKey: 'lastEventDate',
  sortDir: 'desc',
  lastDataSignature: null,
  refreshTimer: null
};

const el = {
  sourceStatus: document.getElementById('sourceStatus'),
  sourceMeta: document.getElementById('sourceMeta'),
  emptyState: document.getElementById('emptyState'),
  reloadBtn: document.getElementById('reloadBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearFiltersBtn: document.getElementById('clearFiltersBtn'),
  searchInput: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  categoryFilter: document.getElementById('categoryFilter'),
  dateFilter: document.getElementById('dateFilter'),
  recordCounter: document.getElementById('recordCounter'),
  pageInfo: document.getElementById('pageInfo'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  ordersTable: document.getElementById('ordersTable'),
  orderDetail: document.getElementById('orderDetail'),
  statusBars: document.getElementById('statusBars'),
  categoryList: document.getElementById('categoryList'),
  dateBars: document.getElementById('dateBars'),
  donutChart: document.getElementById('donutChart'),
  toast: document.getElementById('toast'),
  kpiTotal: document.getElementById('kpiTotal'),
  kpiDelivered: document.getElementById('kpiDelivered'),
  kpiDeliveredRate: document.getElementById('kpiDeliveredRate'),
  kpiTransit: document.getElementById('kpiTransit'),
  kpiPending: document.getElementById('kpiPending'),
  kpiCritical: document.getElementById('kpiCritical'),
  kpiReturns: document.getElementById('kpiReturns'),
  kpiGenerated: document.getElementById('kpiGenerated'),
  lastGenerated: document.getElementById('lastGenerated'),
  lastRead: document.getElementById('lastRead'),
  autoRefreshStatus: document.getElementById('autoRefreshStatus')
};

function formatNumber(value) {
  return new Intl.NumberFormat('es-CL').format(Number(value || 0));
}

function safeText(value) {
  return value === undefined || value === null || value === '' ? 'Sin información' : String(value);
}

function escapeHtml(value) {
  return safeText(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDateTime(value) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = safeText(item[key]);
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function getSummaryValue(key) {
  return Number(state.raw?.summary?.[key] || 0);
}

function getDataSignature(data) {
  return `${data?.generatedAt || ''}|${data?.shipments?.length || 0}|${JSON.stringify(data?.summary || {})}`;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

function resetDashboard(message = 'No se encontró información disponible.') {
  state.raw = null;
  state.shipments = [];
  state.filtered = [];
  state.selectedOrder = null;
  state.page = 1;
  state.lastDataSignature = null;

  el.sourceStatus.textContent = 'Sin datos';
  el.sourceMeta.textContent = message;
  el.emptyState.classList.remove('hidden');
  el.lastGenerated.textContent = 'Sin fecha';
  el.lastRead.textContent = formatDateTime(new Date().toISOString());

  el.kpiTotal.textContent = '0';
  el.kpiDelivered.textContent = '0';
  el.kpiDeliveredRate.textContent = '0%';
  el.kpiTransit.textContent = '0';
  el.kpiPending.textContent = '0';
  el.kpiCritical.textContent = '0';
  el.kpiReturns.textContent = '0';
  el.kpiGenerated.textContent = 'Sin fecha';

  renderEmptyChart(el.statusBars, 'Sin datos para graficar');
  renderEmptyChart(el.categoryList, 'Sin categorías disponibles');
  renderEmptyChart(el.dateBars, 'Sin fechas disponibles');
  el.donutChart.className = 'donut empty-donut';
  el.donutChart.style.setProperty('--value', 0);
  el.donutChart.innerHTML = '<span>0%</span>';

  clearFilterOptions();
  el.recordCounter.textContent = '0 registros';
  el.pageInfo.textContent = 'Página 1 de 1';
  el.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">Sin datos para mostrar</td></tr>';
  renderEmptyDetail();
}

function renderEmptyChart(target, message) {
  target.className = target.id === 'categoryList' ? 'category-list empty-chart' : 'bar-chart empty-chart';
  target.innerHTML = `<div>${escapeHtml(message)}</div>`;
}

function clearFilterOptions() {
  el.statusFilter.innerHTML = '<option value="">Todos los estados</option>';
  el.categoryFilter.innerHTML = '<option value="">Todas las categorías</option>';
  el.dateFilter.innerHTML = '<option value="">Todas las fechas</option>';
}

function renderEmptyDetail() {
  el.orderDetail.className = 'detail-empty';
  el.orderDetail.innerHTML = '<div><div class="empty-icon small">◇</div><p>Selecciona un envío para ver su detalle.</p></div>';
}

async function loadData({ silent = false } = {}) {
  try {
    if (!silent) el.sourceStatus.textContent = 'Leyendo JSON...';
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });

    if (!response.ok) {
      resetDashboard(`No se encontró el archivo ${DATA_URL}.`);
      return;
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.shipments)) {
      resetDashboard('El JSON no contiene un arreglo válido de envíos.');
      return;
    }

    const signature = getDataSignature(data);
    const changed = signature !== state.lastDataSignature;
    state.raw = data;
    state.shipments = data.shipments;
    state.lastDataSignature = signature;
    state.selectedOrder = null;

    el.emptyState.classList.add('hidden');
    el.sourceStatus.textContent = 'Datos cargados';
    el.sourceMeta.textContent = `${formatNumber(state.shipments.length)} registros · ${formatDateTime(data.generatedAt)}`;
    el.lastGenerated.textContent = formatDateTime(data.generatedAt);
    el.lastRead.textContent = formatDateTime(new Date().toISOString());

    renderFilters();
    applyFilters(false);
    renderSummary();
    renderCharts();
    renderEmptyDetail();

    if (changed && silent) showToast('Lazarus detectó una actualización del JSON.');
    if (!silent) showToast('Datos actualizados correctamente.');
  } catch (error) {
    resetDashboard(`No fue posible leer ${DATA_URL}.`);
    console.error(error);
  }
}

function renderFilters() {
  const current = {
    status: el.statusFilter.value,
    category: el.categoryFilter.value,
    date: el.dateFilter.value
  };
  clearFilterOptions();
  const statuses = Object.keys(countBy(state.shipments, 'status')).sort();
  const categories = Object.keys(countBy(state.shipments, 'category')).sort();
  const dates = [...new Set(state.shipments.map(item => item.lastEventDate).filter(Boolean))].sort().reverse();

  statuses.forEach(status => el.statusFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`));
  categories.forEach(category => el.categoryFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`));
  dates.slice(0, 180).forEach(date => el.dateFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`));

  el.statusFilter.value = statuses.includes(current.status) ? current.status : '';
  el.categoryFilter.value = categories.includes(current.category) ? current.category : '';
  el.dateFilter.value = dates.includes(current.date) ? current.date : '';
}

function renderSummary() {
  const total = getSummaryValue('totalShipments') || state.shipments.length;
  const delivered = getSummaryValue('delivered') || state.shipments.filter(x => String(x.status).toUpperCase().includes('ENTREGADO')).length;
  const deliveredRate = percent(delivered, total);

  el.kpiTotal.textContent = formatNumber(total);
  el.kpiDelivered.textContent = formatNumber(delivered);
  el.kpiDeliveredRate.textContent = `${deliveredRate}% del total`;
  el.kpiTransit.textContent = formatNumber(getSummaryValue('inTransit'));
  el.kpiPending.textContent = formatNumber(getSummaryValue('scheduled') + getSummaryValue('retry'));
  el.kpiCritical.textContent = formatNumber(getSummaryValue('critical'));
  el.kpiReturns.textContent = formatNumber(getSummaryValue('returns'));
  el.kpiGenerated.textContent = state.raw?.generatedAt ? `Generado: ${formatDateTime(state.raw.generatedAt)}` : 'Sin fecha';

  el.donutChart.className = 'donut';
  el.donutChart.style.setProperty('--value', deliveredRate);
  el.donutChart.innerHTML = `<span>${deliveredRate}%</span>`;
}

function renderBars(target, entries, total) {
  target.className = 'bar-chart';
  target.innerHTML = entries.length ? entries.map(([label, value]) => {
    const width = Math.max(percent(value, total), 1);
    return `<div class="bar-row"><div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><div class="bar-value">${formatNumber(value)}</div></div>`;
  }).join('') : '';
  if (!entries.length) renderEmptyChart(target, 'Sin datos para graficar');
}

function renderCharts() {
  const total = getSummaryValue('totalShipments') || state.shipments.length;
  const summaryItems = [
    ['Entregados', getSummaryValue('delivered')],
    ['En tránsito', getSummaryValue('inTransit')],
    ['Programados', getSummaryValue('scheduled')],
    ['Reintentos', getSummaryValue('retry')],
    ['Dirección incorrecta', getSummaryValue('wrongAddress')],
    ['Devoluciones', getSummaryValue('returns')],
    ['Incidencias', getSummaryValue('incidents')],
    ['Críticos', getSummaryValue('critical')]
  ].filter(([, value]) => Number(value) > 0);
  renderBars(el.statusBars, summaryItems, total);

  const categoryCounts = Object.entries(countBy(state.shipments, 'category')).sort((a, b) => b[1] - a[1]);
  el.categoryList.className = 'category-list';
  el.categoryList.innerHTML = categoryCounts.length ? categoryCounts.map(([category, value]) =>
    `<div class="category-item"><span>${escapeHtml(category)}</span><strong>${formatNumber(value)}</strong><small>${percent(value, total)}%</small></div>`
  ).join('') : '';
  if (!categoryCounts.length) renderEmptyChart(el.categoryList, 'Sin categorías disponibles');

  const dateCounts = Object.entries(countBy(state.shipments, 'lastEventDate')).sort((a, b) => b[1] - a[1]).slice(0, 8);
  renderBars(el.dateBars, dateCounts, total);
}

function applyFilters(resetPage = true) {
  const search = el.searchInput.value.trim().toLowerCase();
  const status = el.statusFilter.value;
  const category = el.categoryFilter.value;
  const date = el.dateFilter.value;

  state.filtered = state.shipments.filter(item => {
    const matchesSearch = !search || [item.order, item.waybill, item.status, item.category, item.lastEventLabel, item.lastEventDescription]
      .some(value => String(value || '').toLowerCase().includes(search));
    return matchesSearch && (!status || item.status === status) && (!category || item.category === category) && (!date || item.lastEventDate === date);
  });

  sortFiltered();
  if (resetPage) state.page = 1;
  renderTable();
}

function sortFiltered() {
  const key = state.sortKey;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  state.filtered.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), 'es', { numeric: true }) * dir);
}

function renderTable() {
  el.recordCounter.textContent = `${formatNumber(state.filtered.length)} registros`;
  const totalPages = Math.max(Math.ceil(state.filtered.length / PAGE_SIZE), 1);
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  el.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  el.prevPageBtn.disabled = state.page <= 1;
  el.nextPageBtn.disabled = state.page >= totalPages;

  if (!state.filtered.length) {
    el.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">No hay registros que coincidan con los filtros</td></tr>';
    return;
  }

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = state.filtered.slice(start, start + PAGE_SIZE);
  el.ordersTable.innerHTML = pageRows.map(item => {
    const selected = state.selectedOrder === item.order ? 'selected' : '';
    return `<tr class="${selected}" data-order="${escapeHtml(item.order)}">
      <td>${escapeHtml(item.order)}</td>
      <td>${escapeHtml(item.waybill)}</td>
      <td>${escapeHtml(item.lastEventDate)}</td>
      <td><span class="status-pill ${getStatusClass(item)}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.category)}</td>
    </tr>`;
  }).join('');
}

function getStatusClass(item) {
  const text = `${item.status || ''} ${item.category || ''}`.toLowerCase();
  if (text.includes('entregado') || text.includes('finalizado')) return 'is-success';
  if (text.includes('devol')) return 'is-dark';
  if (text.includes('crit') || text.includes('incid') || text.includes('direccion') || text.includes('dirección')) return 'is-danger';
  if (text.includes('trans')) return 'is-info';
  return 'is-warning';
}

function renderDetail(orderId) {
  const item = state.shipments.find(row => row.order === orderId);
  if (!item) return renderEmptyDetail();

  state.selectedOrder = item.order;
  renderTable();
  el.orderDetail.className = 'detail-card';
  el.orderDetail.innerHTML = `
    <div class="detail-title"><span>Orden seleccionada</span><strong>${escapeHtml(item.order)}</strong></div>
    <div class="detail-grid">
      <div class="detail-field"><span>Waybill</span><strong>${escapeHtml(item.waybill)}</strong></div>
      <div class="detail-field"><span>Fecha último evento</span><strong>${escapeHtml(item.lastEventDate)}</strong></div>
      <div class="detail-field"><span>Estado</span><strong>${escapeHtml(item.status)}</strong></div>
      <div class="detail-field"><span>Categoría</span><strong>${escapeHtml(item.category)}</strong></div>
      <div class="detail-field"><span>Etiqueta</span><strong>${escapeHtml(item.lastEventLabel)}</strong></div>
      <div class="detail-field"><span>Origen</span><strong>${escapeHtml(state.raw?.source?.company || 'Lazarus')}</strong></div>
    </div>
    <div class="timeline">
      <div class="timeline-item"><span></span><div><strong>${escapeHtml(item.lastEventLabel)}</strong><p>${escapeHtml(item.lastEventDescription)}</p><small>${escapeHtml(item.lastEventDate)}</small></div></div>
    </div>
    <div class="detail-description"><strong>Descripción operacional:</strong><br>${escapeHtml(item.lastEventDescription)}</div>
  `;
}

function clearFilters() {
  el.searchInput.value = '';
  el.statusFilter.value = '';
  el.categoryFilter.value = '';
  el.dateFilter.value = '';
  applyFilters(true);
}

function changePage(delta) {
  state.page += delta;
  renderTable();
}

function setSort(key) {
  if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else {
    state.sortKey = key;
    state.sortDir = key === 'lastEventDate' ? 'desc' : 'asc';
  }
  applyFilters(false);
}

function exportCsv() {
  if (!state.filtered.length) {
    showToast('No hay registros para exportar.');
    return;
  }
  const headers = ['order', 'waybill', 'lastEventDate', 'status', 'category', 'lastEventLabel', 'lastEventDescription'];
  const rows = [headers.join(';')].concat(state.filtered.map(item => headers.map(key => `"${String(item[key] ?? '').replaceAll('"', '""')}"`).join(';')));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lazarus_tracking_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function startAutoRefresh() {
  el.autoRefreshStatus.textContent = `Activo · ${Math.round(AUTO_REFRESH_MS / 1000)}s`;
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => loadData({ silent: true }), AUTO_REFRESH_MS);
}

el.reloadBtn.addEventListener('click', () => loadData());
el.exportBtn.addEventListener('click', exportCsv);
el.clearFiltersBtn.addEventListener('click', clearFilters);
el.searchInput.addEventListener('input', () => applyFilters(true));
el.statusFilter.addEventListener('change', () => applyFilters(true));
el.categoryFilter.addEventListener('change', () => applyFilters(true));
el.dateFilter.addEventListener('change', () => applyFilters(true));
el.prevPageBtn.addEventListener('click', () => changePage(-1));
el.nextPageBtn.addEventListener('click', () => changePage(1));
document.querySelectorAll('.sort-btn').forEach(button => button.addEventListener('click', () => setSort(button.dataset.sort)));
el.ordersTable.addEventListener('click', event => {
  const row = event.target.closest('tr[data-order]');
  if (row) renderDetail(row.dataset.order);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadData({ silent: true });
});

resetDashboard('Esperando lectura del archivo JSON.');
loadData();
startAutoRefresh();
