const AUTH_USERS = [
  { username: "DHLUniformes", password: "Elmejoranalista.", role: "DHL" },
  { username: "LATAMUniformes", password: "Latam_Uniformes2026", role: "LATAM" }
];

const AUTH_KEY = "lazarus_session";
const DATA_FILE = "latest_tracking_client.json";
const PAGE_SIZE = 10;
const AUTO_REFRESH_MS = 60000;

const state = {
  raw: null,
  shipments: [],
  filtered: [],
  selectedShipmentId: null,
  started: false,
  page: 1,
  sortKey: "lastEventDate",
  sortDirection: "desc",
  autoRefreshTimer: null
};

const $ = (id) => document.getElementById(id);

const el = {
  loginScreen: $("loginScreen"),
  appShell: $("appShell"),
  loginForm: $("loginForm"),
  loginUser: $("loginUser"),
  loginPassword: $("loginPassword"),
  loginError: $("loginError"),
  logoutBtn: $("logoutBtn"),

  sourceStatus: $("sourceStatus"),
  sourceMeta: $("sourceMeta"),
  emptyState: $("emptyState"),

  reloadBtn: $("reloadBtn"),
  exportBtn: $("exportBtn"),
  clearFiltersBtn: $("clearFiltersBtn"),

  searchInput: $("searchInput"),
  statusFilter: $("statusFilter"),
  categoryFilter: $("categoryFilter"),
  dateFilter: $("dateFilter"),

  recordCounter: $("recordCounter"),
  pageInfo: $("pageInfo"),
  prevPageBtn: $("prevPageBtn"),
  nextPageBtn: $("nextPageBtn"),
  ordersTable: $("ordersTable"),
  orderDetail: $("orderDetail"),

  donutChart: $("donutChart"),
  donutLegend: $("donutLegend"),
  stockoutThermometer: $("stockoutThermometer"),
  stockoutList: $("stockoutList"),

  kpiTotal: $("kpiTotal"),
  kpiDelivered: $("kpiDelivered"),
  kpiDeliveredRate: $("kpiDeliveredRate"),
  kpiTransit: $("kpiTransit"),
  kpiPending: $("kpiPending"),
  kpiCritical: $("kpiCritical"),
  kpiReturns: $("kpiReturns"),
  kpiGenerated: $("kpiGenerated"),

  toast: $("toast")
};

function formatNumber(value) {
  return new Intl.NumberFormat("es-CL").format(Number(value || 0));
}

function formatPercent(value) {
  const numeric = Number(value || 0);

  return numeric.toLocaleString("es-CL", {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function safeText(value) {
  return value === undefined || value === null || value === "" ? "Sin información" : String(value);
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  return Math.round((Number(value || 0) / Number(total || 0)) * 1000) / 10;
}

function showToast(message) {
  if (!el.toast) return;

  el.toast.textContent = message;
  el.toast.classList.remove("hidden");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    el.toast.classList.add("hidden");
  }, 3200);
}

function setAuthenticatedView(isAuthenticated) {
  el.loginScreen.classList.toggle("hidden", isAuthenticated);
  el.appShell.classList.toggle("hidden", !isAuthenticated);
}

function getShipmentId(item) {
  return safeText(item.order || item.waybill || item.id || item.shipmentId);
}

function clearFilterOptions() {
  el.statusFilter.innerHTML = '<option value="">Todos los estados</option>';
  el.categoryFilter.innerHTML = '<option value="">Todas las categorías</option>';
  el.dateFilter.innerHTML = '<option value="">Todas las fechas</option>';
}

function renderEmptyDetail() {
  el.orderDetail.className = "detail-empty";
  el.orderDetail.innerHTML = `
    <div>
      <div class="empty-icon small">◇</div>
      <p>Selecciona un envío para ver su detalle.</p>
    </div>
  `;
}

function renderEmptyStockout() {
  if (!el.stockoutThermometer || !el.stockoutList) return;

  el.stockoutThermometer.style.setProperty("--level", 0);
  el.stockoutList.className = "stockout-list empty-stockout";
  el.stockoutList.innerHTML = `
    <div class="stockout-empty-card">
      <strong>Sin quiebres informados</strong>
      <span>El JSON actual no contiene datos por ítem/SKU para calcular este indicador.</span>
    </div>
  `;
}

function resetDashboard(message = "No se encontró información disponible.") {
  state.raw = null;
  state.shipments = [];
  state.filtered = [];
  state.selectedShipmentId = null;
  state.page = 1;

  el.sourceStatus.textContent = "Sin datos";
  el.sourceMeta.textContent = message;
  el.emptyState.classList.remove("hidden");

  el.kpiTotal.textContent = "0";
  el.kpiDelivered.textContent = "0";
  el.kpiDeliveredRate.textContent = "0% del total";
  el.kpiTransit.textContent = "0";
  el.kpiPending.textContent = "0";
  el.kpiCritical.textContent = "0";
  el.kpiReturns.textContent = "0";
  el.kpiGenerated.textContent = "Todos los envíos";

  el.donutChart.className = "donut empty-donut";
  el.donutChart.style.setProperty("--value", 0);
  el.donutChart.innerHTML = "<span>0%<small>Entregados</small></span>";
  el.donutLegend.innerHTML = "";

  renderEmptyStockout();
  clearFilterOptions();

  el.searchInput.value = "";
  el.recordCounter.textContent = "0 registros";
  el.pageInfo.textContent = "Página 1 de 1";
  el.prevPageBtn.disabled = true;
  el.nextPageBtn.disabled = true;
  el.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">Sin datos para mostrar</td></tr>';

  renderEmptyDetail();
}

function buildCandidatePaths() {
  const cacheBuster = `v=${Date.now()}`;
  const pathname = window.location.pathname;
  const repoName = pathname.split("/").filter(Boolean)[0] || "Lazarus";

  return [
    `data/${DATA_FILE}?${cacheBuster}`,
    `./data/${DATA_FILE}?${cacheBuster}`,
    `${window.location.origin}/${repoName}/data/${DATA_FILE}?${cacheBuster}`,
    `/Lazarus/data/${DATA_FILE}?${cacheBuster}`
  ];
}

async function fetchJsonFromAvailablePaths() {
  const candidatePaths = [...new Set(buildCandidatePaths())];
  let lastError = null;

  for (const path of candidatePaths) {
    try {
      const response = await fetch(path, { cache: "no-store" });

      if (response.ok) {
        return {
          data: await response.json(),
          path
        };
      }

      lastError = new Error(`HTTP ${response.status} leyendo ${path}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No fue posible leer el JSON.");
}

async function loadData({ silent = false } = {}) {
  try {
    if (!silent) {
      el.sourceStatus.textContent = "Leyendo JSON";
      el.sourceMeta.textContent = `Consultando data/${DATA_FILE}...`;
    }

    if (window.location.protocol === "file:") {
      resetDashboard("Estás abriendo el HTML directo desde Windows. Para leer JSON usa GitHub Pages, Live Server o un servidor local.");
      return;
    }

    const result = await fetchJsonFromAvailablePaths();
    const data = result.data;

    if (!data || !Array.isArray(data.shipments)) {
      resetDashboard("El JSON existe, pero no contiene un arreglo válido en la propiedad shipments.");
      return;
    }

    state.raw = data;
    state.shipments = data.shipments;
    state.filtered = [...state.shipments];
    state.selectedShipmentId = null;
    state.page = 1;

    el.emptyState.classList.add("hidden");
    el.sourceStatus.textContent = "Datos cargados";
    el.sourceMeta.textContent = `${formatNumber(state.shipments.length)} registros · Generado ${formatDateTime(data.generatedAt)} · Auto refresh 60s`;

    renderFilters();
    applyFilters();
    renderSummary();
    renderAnalytics();
    renderEmptyDetail();

    if (!silent) showToast("JSON cargado correctamente.");
  } catch (error) {
    resetDashboard(`No fue posible leer data/${DATA_FILE}. Verifica que el archivo exista y que la página esté publicada o ejecutada con Live Server.`);
    console.error(error);
  }
}

function renderFilters() {
  clearFilterOptions();

  const statuses = Object.keys(countBy(state.shipments, "status")).sort();
  const categories = Object.keys(countBy(state.shipments, "category")).sort();
  const dates = [...new Set(state.shipments.map(item => item.lastEventDate).filter(Boolean))].sort().reverse();

  statuses.forEach(status => {
    el.statusFilter.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`);
  });

  categories.forEach(category => {
    el.categoryFilter.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`);
  });

  dates.slice(0, 180).forEach(date => {
    el.dateFilter.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`);
  });
}

function getSummaryValue(key) {
  return Number(state.raw?.summary?.[key] || 0);
}

function countStatusByWords(words) {
  return state.shipments.filter(item => {
    const text = [
      item.status,
      item.category,
      item.lastEventLabel,
      item.lastEventDescription
    ].join(" ").toLowerCase();

    return words.some(word => text.includes(word));
  }).length;
}

function renderSummary() {
  const total = getSummaryValue("totalShipments") || state.shipments.length;
  const delivered = getSummaryValue("delivered") || countStatusByWords(["entregado", "finalizado"]);
  const inTransit = getSummaryValue("inTransit") || countStatusByWords(["tránsito", "transito", "ruta", "proceso"]);
  const scheduled = getSummaryValue("scheduled") || countStatusByWords(["programado", "agendado"]);
  const retry = getSummaryValue("retry") || countStatusByWords(["reintento", "retry"]);
  const critical = getSummaryValue("critical") || countStatusByWords(["crítico", "critico", "incidencia", "error", "fallido", "dirección incorrecta", "direccion incorrecta"]);
  const returns = getSummaryValue("returns") || countStatusByWords(["devolución", "devolucion", "retorno", "return"]);
  const deliveredRate = percent(delivered, total);

  el.kpiTotal.textContent = formatNumber(total);
  el.kpiDelivered.textContent = formatNumber(delivered);
  el.kpiDeliveredRate.textContent = `${formatPercent(deliveredRate)}% del total`;
  el.kpiTransit.textContent = formatNumber(inTransit);
  el.kpiPending.textContent = formatNumber(scheduled + retry);
  el.kpiCritical.textContent = formatNumber(critical);
  el.kpiReturns.textContent = formatNumber(returns);
  el.kpiGenerated.textContent = state.raw?.generatedAt ? `Generado ${formatDateTime(state.raw.generatedAt)}` : "Todos los envíos";
}

function renderDonutLegend(items) {
  el.donutLegend.innerHTML = items.map((item) => `
    <div class="legend-row ${item.className || ""}">
      <span><i></i>${escapeHtml(item.label)}</span>
      <strong>${formatNumber(item.value)} (${formatPercent(item.rate)}%)</strong>
    </div>
  `).join("");
}

function renderCompliance() {
  const total = getSummaryValue("totalShipments") || state.shipments.length;
  const delivered = getSummaryValue("delivered") || countStatusByWords(["entregado", "finalizado"]);
  const inTransit = getSummaryValue("inTransit") || countStatusByWords(["tránsito", "transito", "ruta", "proceso"]);
  const pending = (getSummaryValue("scheduled") || countStatusByWords(["programado", "agendado"])) + (getSummaryValue("retry") || countStatusByWords(["reintento", "retry"]));
  const returns = getSummaryValue("returns") || countStatusByWords(["devolución", "devolucion", "retorno", "return"]);
  const critical = getSummaryValue("critical") || countStatusByWords(["crítico", "critico", "incidencia", "error", "fallido"]);
  const deliveredRate = percent(delivered, total);

  el.donutChart.className = "donut";
  el.donutChart.style.setProperty("--value", deliveredRate);
  el.donutChart.innerHTML = `<span>${formatPercent(deliveredRate)}%<small>Entregados</small></span>`;

  renderDonutLegend([
    { label: "Entregados", value: delivered, rate: deliveredRate, className: "green" },
    { label: "En tránsito", value: inTransit, rate: percent(inTransit, total), className: "blue" },
    { label: "Pendientes", value: pending, rate: percent(pending, total), className: "amber" },
    { label: "Devoluciones", value: returns, rate: percent(returns, total), className: "violet" },
    { label: "Casos críticos", value: critical, rate: percent(critical, total), className: "red" }
  ]);
}

function getFirstArray(...candidates) {
  return candidates.find(Array.isArray) || [];
}

function getStockoutSource() {
  return getFirstArray(
    state.raw?.inventoryThermometer?.topCriticalItems,
    state.raw?.inventoryThermometer?.items,
    state.raw?.inventoryThermometer?.criticalItems,
    state.raw?.inventoryThermometer?.data,

    state.raw?.stockBreaks,
    state.raw?.stockBreakItems,
    state.raw?.stockBreaksByItem,
    state.raw?.stockoutItems,
    state.raw?.stockouts,
    state.raw?.stockoutIndex,
    state.raw?.quiebresStock,
    state.raw?.itemsQuiebreStock,
    state.raw?.itemsConQuiebre,

    state.raw?.analytics?.stockBreaks,
    state.raw?.analytics?.stockBreakItems,
    state.raw?.analytics?.stockBreaksByItem,
    state.raw?.analytics?.stockoutItems,
    state.raw?.analytics?.stockouts,
    state.raw?.analytics?.quiebresStock,

    state.raw?.summary?.stockBreaks,
    state.raw?.summary?.stockBreakItems,
    state.raw?.summary?.stockBreaksByItem,
    state.raw?.summary?.stockoutItems,
    state.raw?.summary?.stockouts,
    state.raw?.summary?.quiebresStock
  );
}

function normalizeStockoutValue(item) {
  const rawValue = item.stockoutIndex
    ?? item.severity
    ?? item.indiceQuiebre
    ?? item.indice_quiebre
    ?? item.breakIndex
    ?? item.quiebreIndex
    ?? item.index
    ?? item.score
    ?? item.rate
    ?? item.percentage
    ?? item.percent
    ?? item.value
    ?? item.count
    ?? item.missingUnits
    ?? item.unidadesFaltantes
    ?? item.quiebres
    ?? item.stockBreaks
    ?? 0;

  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = 0;

  if (value > 0 && value <= 1 && (
    "rate" in item ||
    "percentage" in item ||
    "percent" in item ||
    "stockoutIndex" in item ||
    "severity" in item ||
    "indiceQuiebre" in item ||
    "indice_quiebre" in item
  )) {
    value = value * 100;
  }

  return value;
}

function normalizeStockoutItems() {
  const explicitItems = getStockoutSource();

  if (explicitItems.length) {
    return explicitItems.map((item) => {
      const label = item.item
        || item.sku
        || item.itemCode
        || item.productCode
        || item.material
        || item.codigo
        || item.code
        || item.name
        || item.description
        || item.descripcion;

      const value = normalizeStockoutValue(item);

      const unit = item.unit
        || item.unitLabel
        || item.unidad
        || ("severity" in item ? "%" : "");

      return {
        label: safeText(label),
        description: safeText(item.description || item.descripcion || ""),
        value,
        unit,
        level: safeText(item.level || item.nivel || ""),
        trend: safeText(item.trend || item.tendencia || ""),
        affectedOrders: Number(item.affectedOrders || item.ordenesAfectadas || 0),
        missingUnits: Number(item.missingUnits || item.unidadesFaltantes || 0),
        requiredUnits: Number(item.requiredUnits || item.unidadesRequeridas || 0),
        availableUnits: Number(item.availableUnits ?? item.unidadesDisponibles ?? 0),
        orderTypes: Array.isArray(item.orderTypes) ? item.orderTypes : []
      };
    })
      .filter(item => item.label !== "Sin información" && item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  const itemKeyCandidates = ["item", "sku", "itemCode", "productCode", "material", "codigo", "code"];
  const detectedKey = itemKeyCandidates.find(key => state.shipments.some(row => row[key]));

  if (!detectedKey) return [];

  const criticalWords = /quiebre|stock|sin stock|no stock|no fill|nofill|agotado|insuficiente/i;
  const criticalShipments = state.shipments.filter(row => criticalWords.test([
    row.status,
    row.category,
    row.lastEventLabel,
    row.lastEventDescription,
    row.observation,
    row.observacion,
    row.notes
  ].join(" ")));

  const counts = Object.entries(countBy(criticalShipments, detectedKey))
    .filter(([label]) => label !== "Sin información")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return counts.map(([label, value]) => ({
    label,
    description: "",
    value,
    unit: "casos",
    level: "",
    trend: "",
    affectedOrders: 0,
    missingUnits: 0,
    requiredUnits: 0,
    availableUnits: 0,
    orderTypes: []
  }));
}

function renderStockoutThermometer() {
  const items = normalizeStockoutItems();

  if (!items.length) {
    renderEmptyStockout();
    return;
  }

  const maxValue = Math.max(...items.map(item => item.value), 1);
  const thermometerLevel = maxValue <= 100 ? maxValue : 100;

  el.stockoutThermometer.style.setProperty("--level", Math.min(Math.max(thermometerLevel, 0), 100));
  el.stockoutList.className = "stockout-list";

  el.stockoutList.innerHTML = items.map((item, index) => {
    const width = maxValue <= 100 ? item.value : percent(item.value, maxValue);
    const score = Number.isInteger(item.value) ? formatNumber(item.value) : formatPercent(item.value);

    const suffix = item.unit === "%"
      ? "%"
      : item.unit
        ? ` ${escapeHtml(item.unit)}`
        : maxValue <= 100
          ? "%"
          : "";

    const detailParts = [];

    if (item.level && item.level !== "Sin información") detailParts.push(item.level);
    if (item.affectedOrders) detailParts.push(`${formatNumber(item.affectedOrders)} órdenes`);
    if (item.missingUnits) detailParts.push(`${formatNumber(item.missingUnits)} unid. faltantes`);
    if (item.requiredUnits) detailParts.push(`${formatNumber(item.requiredUnits)} unid. requeridas`);
    if (item.availableUnits || item.availableUnits === 0) detailParts.push(`${formatNumber(item.availableUnits)} stock disponible`);
    if (item.orderTypes.length) detailParts.push(item.orderTypes.join(" / "));

    const detailText = detailParts.length ? detailParts.join(" · ") : "Sin detalle adicional";

    return `
      <div class="stockout-row risk-${index + 1}">
        <span class="rank">${index + 1}</span>
        <span class="stockout-name" title="${escapeHtml(detailText)}">${escapeHtml(item.label)}</span>
        <div class="stockout-track">
          <div class="stockout-fill" style="width:${Math.max(Math.min(width, 100), 3)}%"></div>
        </div>
        <strong>${escapeHtml(score)}${suffix}</strong>
      </div>
    `;
  }).join("");
}

function renderAnalytics() {
  renderCompliance();
  renderStockoutThermometer();
}

function applyFilters() {
  const search = el.searchInput.value.trim().toLowerCase();
  const status = el.statusFilter.value;
  const category = el.categoryFilter.value;
  const date = el.dateFilter.value;

  state.filtered = state.shipments.filter(item => {
    const matchesSearch = !search || [
      item.order,
      item.waybill,
      item.status,
      item.category,
      item.lastEventLabel,
      item.lastEventDescription,
      item.customer,
      item.client,
      item.destination,
      item.destino
    ].some(value => String(value || "").toLowerCase().includes(search));

    return matchesSearch
      && (!status || item.status === status)
      && (!category || item.category === category)
      && (!date || item.lastEventDate === date);
  });

  sortFiltered(false);
  state.page = 1;
  renderTable();
}

function sortFiltered(toggleDirection = true) {
  if (toggleDirection) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  }

  const direction = state.sortDirection === "asc" ? 1 : -1;
  const key = state.sortKey;

  state.filtered.sort((a, b) => {
    const valueA = String(a[key] || "").toLowerCase();
    const valueB = String(b[key] || "").toLowerCase();
    return valueA.localeCompare(valueB, "es", { numeric: true }) * direction;
  });
}

function getStatusClass(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized.includes("entregado") || normalized.includes("finalizado")) return "delivered";
  if (normalized.includes("pend") || normalized.includes("program") || normalized.includes("reint")) return "pending";
  if (normalized.includes("dev") || normalized.includes("retorno") || normalized.includes("return")) return "return";
  if (normalized.includes("crit") || normalized.includes("incid") || normalized.includes("error") || normalized.includes("fall")) return "critical";
  if (normalized.includes("tránsito") || normalized.includes("transito") || normalized.includes("ruta") || normalized.includes("proceso")) return "transit";

  return "neutral";
}

function renderTable() {
  el.recordCounter.textContent = `${formatNumber(state.filtered.length)} registros`;

  if (!state.filtered.length) {
    el.pageInfo.textContent = "Página 1 de 1";
    el.prevPageBtn.disabled = true;
    el.nextPageBtn.disabled = true;
    el.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">No hay registros que coincidan con los filtros</td></tr>';
    return;
  }

  const totalPages = Math.max(Math.ceil(state.filtered.length / PAGE_SIZE), 1);
  state.page = Math.min(Math.max(state.page, 1), totalPages);

  const start = (state.page - 1) * PAGE_SIZE;
  const visibleRows = state.filtered.slice(start, start + PAGE_SIZE);

  el.pageInfo.textContent = `Mostrando ${formatNumber(start + 1)} a ${formatNumber(Math.min(start + PAGE_SIZE, state.filtered.length))} de ${formatNumber(state.filtered.length)} envíos · Página ${formatNumber(state.page)} de ${formatNumber(totalPages)}`;
  el.prevPageBtn.disabled = state.page <= 1;
  el.nextPageBtn.disabled = state.page >= totalPages;

  el.ordersTable.innerHTML = visibleRows.map(item => {
    const shipmentId = getShipmentId(item);
    const selected = state.selectedShipmentId === shipmentId ? "selected" : "";
    const statusClass = getStatusClass(item.status);

    return `
      <tr class="${selected}" data-shipment-id="${escapeHtml(shipmentId)}">
        <td>${escapeHtml(item.order)}</td>
        <td>${escapeHtml(item.waybill)}</td>
        <td>${escapeHtml(item.lastEventDate)}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.category)}</td>
      </tr>
    `;
  }).join("");
}

function pickFirst(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "") ?? "";
}

function renderDetail(shipmentId) {
  const item = state.shipments.find(row => getShipmentId(row) === String(shipmentId));

  if (!item) {
    renderEmptyDetail();
    return;
  }

  state.selectedShipmentId = getShipmentId(item);
  renderTable();

  const statusClass = getStatusClass(item.status);
  const destination = pickFirst(item.destination, item.destino, item.city, item.comuna, item.region, item.address);
  const customer = pickFirst(item.customer, item.client, item.cliente, state.raw?.source?.company);
  const observation = pickFirst(item.lastEventDescription, item.observation, item.observacion, item.notes, "Sin observaciones registradas.");

  el.orderDetail.className = "enterprise-detail";
  el.orderDetail.innerHTML = `
    <div class="detail-hero-row">
      <span>Orden seleccionada</span>
      <strong>${escapeHtml(item.order)}</strong>
    </div>

    <div class="detail-list">
      <div class="detail-row">
        <span>Waybill</span>
        <strong>${escapeHtml(item.waybill)}</strong>
      </div>

      <div class="detail-row">
        <span>Estado</span>
        <strong><em class="status-pill ${statusClass}">${escapeHtml(item.status)}</em></strong>
      </div>

      <div class="detail-row">
        <span>Categoría</span>
        <strong>${escapeHtml(item.category)}</strong>
      </div>

      <div class="detail-row">
        <span>Último evento</span>
        <strong>${escapeHtml(pickFirst(item.lastEventLabel, item.status))}</strong>
      </div>

      <div class="detail-row">
        <span>Fecha evento</span>
        <strong>${escapeHtml(item.lastEventDate)}</strong>
      </div>

      <div class="detail-row">
        <span>Cliente / cuenta</span>
        <strong>${escapeHtml(customer)}</strong>
      </div>

      <div class="detail-row">
        <span>Destino</span>
        <strong>${escapeHtml(destination || "Sin información")}</strong>
      </div>
    </div>

    <div class="detail-description">
      <span>Observaciones</span>
      <p>${escapeHtml(observation)}</p>
    </div>
  `;
}

function clearFilters() {
  el.searchInput.value = "";
  el.statusFilter.value = "";
  el.categoryFilter.value = "";
  el.dateFilter.value = "";
  state.selectedShipmentId = null;

  applyFilters();
  renderEmptyDetail();
}

function exportCsv() {
  if (!state.filtered.length) {
    showToast("No hay registros para exportar.");
    return;
  }

  const headers = [
    "order",
    "waybill",
    "lastEventDate",
    "status",
    "category",
    "lastEventLabel",
    "lastEventDescription"
  ];

  const rows = state.filtered.map(item => {
    return headers.map(header => `"${String(item[header] ?? "").replaceAll('"', '""')}"`).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `lazarus_tracking_${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function bindDashboardEvents() {
  el.reloadBtn.addEventListener("click", () => loadData());
  el.exportBtn.addEventListener("click", exportCsv);
  el.clearFiltersBtn.addEventListener("click", clearFilters);

  el.searchInput.addEventListener("input", applyFilters);
  el.statusFilter.addEventListener("change", applyFilters);
  el.categoryFilter.addEventListener("change", applyFilters);
  el.dateFilter.addEventListener("change", applyFilters);

  el.prevPageBtn.addEventListener("click", () => {
    state.page -= 1;
    renderTable();
  });

  el.nextPageBtn.addEventListener("click", () => {
    state.page += 1;
    renderTable();
  });

  document.querySelectorAll(".sort-btn").forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;

      if (state.sortKey !== key) {
        state.sortKey = key;
        state.sortDirection = "asc";
      } else {
        sortFiltered(true);
        state.page = 1;
        renderTable();
        return;
      }

      sortFiltered(false);
      state.page = 1;
      renderTable();
    });
  });

  el.ordersTable.addEventListener("click", event => {
    const row = event.target.closest("tr[data-shipment-id]");
    if (row) renderDetail(row.dataset.shipmentId);
  });
}

function startDashboard() {
  if (!state.started) {
    bindDashboardEvents();
    state.started = true;
  }

  resetDashboard("Esperando lectura del archivo JSON.");
  loadData();

  window.clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = window.setInterval(() => {
    if (localStorage.getItem(AUTH_KEY)) loadData({ silent: true });
  }, AUTO_REFRESH_MS);
}

function stopDashboard() {
  window.clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  resetDashboard("Sesión cerrada.");
}

function initAuth() {
  const session = localStorage.getItem(AUTH_KEY);

  if (session) {
    setAuthenticatedView(true);
    startDashboard();
  } else {
    setAuthenticatedView(false);
  }

  el.loginForm.addEventListener("submit", event => {
    event.preventDefault();

    const usernameInput = el.loginUser.value.trim();
    const password = el.loginPassword.value;

    const user = AUTH_USERS.find(item =>
      item.username.toLowerCase() === usernameInput.toLowerCase() && item.password === password
    );

    if (!user) {
      el.loginError.textContent = "Usuario o contraseña incorrectos.";
      el.loginPassword.value = "";
      el.loginPassword.focus();
      return;
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify({
      username: user.username,
      role: user.role,
      loginAt: new Date().toISOString()
    }));

    el.loginError.textContent = "";
    el.loginPassword.value = "";
    setAuthenticatedView(true);
    startDashboard();
  });

  el.logoutBtn.addEventListener("click", () => {
    localStorage.removeItem(AUTH_KEY);
    stopDashboard();
    setAuthenticatedView(false);
    el.loginUser.value = "";
    el.loginPassword.value = "";
    el.loginError.textContent = "";
    el.loginUser.focus();
  });
}

document.addEventListener("DOMContentLoaded", initAuth);
