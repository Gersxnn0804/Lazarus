const state = {
  raw: null,
  shipments: [],
  filtered: [],
  selectedOrder: null
};

const el = {
  sourceStatus: document.getElementById('sourceStatus'),
  sourceMeta: document.getElementById('sourceMeta'),
  emptyState: document.getElementById('emptyState'),
  reloadBtn: document.getElementById('reloadBtn'),
  clearFiltersBtn: document.getElementById('clearFiltersBtn'),
  searchInput: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  categoryFilter: document.getElementById('categoryFilter'),
  dateFilter: document.getElementById('dateFilter'),
  recordCounter: document.getElementById('recordCounter'),
  ordersTable: document.getElementById('ordersTable'),
  orderDetail: document.getElementById('orderDetail'),
  statusBars: document.getElementById('statusBars'),
  categoryList: document.getElementById('categoryList'),
  riskStrip: document.getElementById('riskStrip'),
  donutChart: document.getElementById('donutChart'),
  kpiTotal: document.getElementById('kpiTotal'),
  kpiDelivered: document.getElementById('kpiDelivered'),
  kpiDeliveredRate: document.getElementById('kpiDeliveredRate'),
  kpiTransit: document.getElementById('kpiTransit'),
  kpiPending: document.getElementById('kpiPending'),
  kpiCritical: document.getElementById('kpiCritical'),
  kpiReturns: document.getElementById('kpiReturns'),
  kpiGenerated: document.getElementById('kpiGenerated')
};

function formatNumber(value) {
  return new Intl.NumberFormat('es-CL').format(Number(value || 0));
}

function safeText(value) {
  return value === undefined || value === null || value === '' ? 'Sin información' : String(value);
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

function resetDashboard(message = 'No se encontró información disponible.') {
  state.raw = null;
  state.shipments = [];
  state.filtered = [];
  state.selectedOrder = null;

  el.sourceStatus.textContent = 'Sin datos';
  el.sourceMeta.textContent = message;
  el.emptyState.classList.remove('hidden');

  el.kpiTotal.textContent = '0';
  el.kpiDelivered.textContent = '0';
  el.kpiDeliveredRate.textContent = '0%';
  el.kpiTransit.textContent = '0';
  el.kpiPending.textContent = '0';
  el.kpiCritical.textContent = '0';
  el.kpiReturns.textContent = '0';
  el.kpiGenerated.textContent = 'Sin fecha';

  el.statusBars.className = 'bar-chart empty-chart';
  el.statusBars.innerHTML = '';
  el.categoryList.className = 'category-list empty-chart';
  el.categoryList.innerHTML = '';
  el.riskStrip.className = 'risk-strip empty-chart';
  el.riskStrip.innerHTML = '';
  el.donutChart.className = 'donut empty-donut';
  el.donutChart.style.setProperty('--value', 0);
  el.donutChart.innerHTML = '<span>0%</span>';

  clearFilterOptions();
  el.recordCounter.textContent = '0 registros';
  el.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">Sin datos para mostrar</td></tr>';
  renderEmptyDetail();
}

function clearFilterOptions() {
  el.statusFilter.innerHTML = '<option value="">Todos los estados</option>';
  el.categoryFilter.innerHTML = '<option value="">Todas las categorías</option>';
  el.dateFilter.innerHTML = '<option value="">Todas las fechas</option>';
}

function renderEmptyDetail() {
  el.orderDetail.className = 'detail-empty';
  el.orderDetail.innerHTML = '<div><div class="empty-icon small">◇</div><p>Selecciona una orden para ver su detalle.</p></div>';
}

async function loadData() {
  try {
    const response = await fetch(`data/latest_tracking_client.json?v=${Date.now()}`, { cache: 'no-store' });

    if (!response.ok) {
      resetDashboard('No se encontró el archivo data/latest_tracking_client.json.');
      return;
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.shipments)) {
      resetDashboard('El JSON no contiene un arreglo válido de envíos.');
      return;
    }

    state.raw = data;
    state.shipments = data.shipments;
    state.filtered = [...state.shipments];
    state.selectedOrder = null;

    el.emptyState.classList.add('hidden');
    el.sourceStatus.textContent = 'Datos cargados';
    el.sourceMeta.textContent = `${formatNumber(state.shipments.length)} registros · ${data.generatedAt || 'sin fecha de generación'}`;

    renderFilters();
    applyFilters();
    renderSummary();
    renderCharts();
    renderEmptyDetail();
  } catch (error) {
    resetDashboard('No fue posible leer el archivo JSON. Verifica que exista en data/latest_tracking_client.json.');
    console.error(error);
  }
}

function renderFilters() {
  clearFilterOptions();
  const statuses = Object.keys(countBy(state.shipments, 'status')).sort();
  const categories = Object.keys(countBy(state.shipments, 'category')).sort();
  const dates = [...new Set(state.shipments.map(item => item.lastEventDate).filter(Boolean))].sort().reverse();

  statuses.forEach(status => el.statusFilter.insertAdjacentHTML('beforeend', `<option value="${status}">${status}</option>`));
  categories.forEach(category => el.categoryFilter.insertAdjacentHTML('beforeend', `<option value="${category}">${category}</option>`));
  dates.slice(0, 120).forEach(date => el.dateFilter.insertAdjacentHTML('beforeend', `<option value="${date}">${date}</option>`));
}

function getSummaryValue(key) {
  return state.raw?.summary?.[key] || 0;
}

function renderSummary() {
  const total = getSummaryValue('totalShipments') || state.shipments.length;
  const delivered = getSummaryValue('delivered') || state.shipments.filter(x => String(x.status).toUpperCase().includes('ENTREGADO')).length;
  const inTransit = getSummaryValue('inTransit');
  const scheduled = getSummaryValue('scheduled');
  const retry = getSummaryValue('retry');
  const critical = getSummaryValue('critical');
  const returns = getSummaryValue('returns');
  const deliveredRate = percent(delivered, total);

  el.kpiTotal.textContent = formatNumber(total);
  el.kpiDelivered.textContent = formatNumber(delivered);
  el.kpiDeliveredRate.textContent = `${deliveredRate}% del total`;
  el.kpiTransit.textContent = formatNumber(inTransit);
  el.kpiPending.textContent = formatNumber(scheduled + retry);
  el.kpiCritical.textContent = formatNumber(critical);
  el.kpiReturns.textContent = formatNumber(returns);
  el.kpiGenerated.textContent = state.raw?.generatedAt ? `Generado: ${state.raw.generatedAt}` : 'Sin fecha';

  el.donutChart.className = 'donut';
  el.donutChart.style.setProperty('--value', deliveredRate);
  el.donutChart.innerHTML = `<span>${deliveredRate}%</span>`;
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

  el.statusBars.className = 'bar-chart';
  el.statusBars.innerHTML = summaryItems.length ? summaryItems.map(([label, value]) => {
    const width = Math.max(percent(value, total), 1);
    return `<div class="bar-row"><div class="bar-label">${label}</div><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><div class="bar-value">${formatNumber(value)}</div></div>`;
  }).join('') : '';
  if (!summaryItems.length) el.statusBars.className = 'bar-chart empty-chart';

  const categoryCounts = Object.entries(countBy(state.shipments, 'category')).sort((a, b) => b[1] - a[1]);
  el.categoryList.className = 'category-list';
  el.categoryList.innerHTML = categoryCounts.length ? categoryCounts.map(([category, value]) =>
    `<div class="category-item"><span>${category}</span><strong>${formatNumber(value)}</strong></div>`
  ).join('') : '';
  if (!categoryCounts.length) el.categoryList.className = 'category-list empty-chart';

  const riskItems = [
    ['Incidencias', getSummaryValue('incidents')],
    ['Críticos', getSummaryValue('critical')],
    ['Dirección', getSummaryValue('wrongAddress')],
    ['Retornos', getSummaryValue('returns')]
  ];
  el.riskStrip.className = 'risk-strip';
  el.riskStrip.innerHTML = riskItems.map(([label, value]) =>
    `<div class="risk-card"><span>${label}</span><strong>${formatNumber(value)}</strong></div>`
  ).join('');
}

function applyFilters() {
  const search = el.searchInput.value.trim().toLowerCase();
  const status = el.statusFilter.value;
  const category = el.categoryFilter.value;
  const date = el.dateFilter.value;

  state.filtered = state.shipments.filter(item => {
    const matchesSearch = !search || [item.order, item.waybill, item.status, item.category, item.lastEventDescription]
      .some(value => String(value || '').toLowerCase().includes(search));
    const matchesStatus = !status || item.status === status;
    const matchesCategory = !category || item.category === category;
    const matchesDate = !date || item.lastEventDate === date;
    return matchesSearch && matchesStatus && matchesCategory && matchesDate;
  });

  renderTable();
}

function renderTable() {
  el.recordCounter.textContent = `${formatNumber(state.filtered.length)} registros`;

  if (!state.filtered.length) {
    el.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">No hay registros que coincidan con los filtros</td></tr>';
    return;
  }

  el.ordersTable.innerHTML = state.filtered.slice(0, 700).map(item => {
    const selected = state.selectedOrder === item.order ? 'selected' : '';
    return `<tr class="${selected}" data-order="${item.order}">
      <td>${safeText(item.order)}</td>
      <td>${safeText(item.waybill)}</td>
      <td>${safeText(item.lastEventDate)}</td>
      <td><span class="status-pill">${safeText(item.status)}</span></td>
      <td>${safeText(item.category)}</td>
    </tr>`;
  }).join('');

  if (state.filtered.length > 700) {
    el.ordersTable.insertAdjacentHTML('beforeend', '<tr><td colspan="5" class="table-empty">Mostrando los primeros 700 registros. Usa filtros para acotar la búsqueda.</td></tr>');
  }
}

function renderDetail(orderId) {
  const item = state.shipments.find(row => row.order === orderId);
  if (!item) {
    renderEmptyDetail();
    return;
  }

  state.selectedOrder = item.order;
  renderTable();
  el.orderDetail.className = 'detail-card';
  el.orderDetail.innerHTML = `
    <div class="detail-title"><span>Orden seleccionada</span><strong>${safeText(item.order)}</strong></div>
    <div class="detail-grid">
      <div class="detail-field"><span>Waybill</span><strong>${safeText(item.waybill)}</strong></div>
      <div class="detail-field"><span>Fecha último evento</span><strong>${safeText(item.lastEventDate)}</strong></div>
      <div class="detail-field"><span>Estado</span><strong>${safeText(item.status)}</strong></div>
      <div class="detail-field"><span>Categoría</span><strong>${safeText(item.category)}</strong></div>
      <div class="detail-field"><span>Etiqueta</span><strong>${safeText(item.lastEventLabel)}</strong></div>
      <div class="detail-field"><span>Origen dato</span><strong>${safeText(state.raw?.source?.company || 'Lazarus')}</strong></div>
    </div>
    <div class="detail-description"><strong>Descripción:</strong><br>${safeText(item.lastEventDescription)}</div>
  `;
}

function clearFilters() {
  el.searchInput.value = '';
  el.statusFilter.value = '';
  el.categoryFilter.value = '';
  el.dateFilter.value = '';
  applyFilters();
}

el.reloadBtn.addEventListener('click', loadData);
el.clearFiltersBtn.addEventListener('click', clearFilters);
el.searchInput.addEventListener('input', applyFilters);
el.statusFilter.addEventListener('change', applyFilters);
el.categoryFilter.addEventListener('change', applyFilters);
el.dateFilter.addEventListener('change', applyFilters);
el.ordersTable.addEventListener('click', event => {
  const row = event.target.closest('tr[data-order]');
  if (row) renderDetail(row.dataset.order);
});

resetDashboard('Esperando lectura del archivo JSON.');
loadData();
