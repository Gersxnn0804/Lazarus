const AUTH_USERS = [
  { username: "DHLUniformes", password: "Elmejoranalista.", role: "DHL" },
  { username: "LATAMUniformes", password: "Latam_Uniformes2026", role: "LATAM" }
];

const AUTH_KEY = "lazarus_session";
const DATA_FILE = "latest_tracking_client.json";
const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 60000;

const state = {
  raw: null,
  requestVersion: 0,
  shipments: [],
  filtered: [],
  temporal: null,
  periodLabel: "Todo el snapshot · sin restricción temporal",
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
  channelFilter: $("channelFilter"),
  dateFilter: $("dateFilter"),
  periodMode: $("periodMode"), periodDay: $("periodDay"), periodMonth: $("periodMonth"),
  periodYear: $("periodYear"), periodFrom: $("periodFrom"), periodTo: $("periodTo"),
  allDates: $("allDates"), activePeriod: $("activePeriod"), periodError: $("periodError"),
  periodDiagnostics: $("periodDiagnostics"), statusDonut: $("statusDonut"), statusLegend: $("statusLegend"),
  sourceDistribution: $("sourceDistribution"),


  recordCounter: $("recordCounter"),
  pageInfo: $("pageInfo"),
  prevPageBtn: $("prevPageBtn"),
  nextPageBtn: $("nextPageBtn"),
  ordersTable: $("ordersTable"),
  orderDetail: $("orderDetail"),

  donutChart: $("donutChart"),
  donutLegend: $("donutLegend"),
  statusDistribution: $("statusDistribution"),

  kpiTotal: $("kpiTotal"),
  kpiDelivered: $("kpiDelivered"),
  kpiDeliveredRate: $("kpiDeliveredRate"),
  kpiTransit: $("kpiTransit"),
  kpiPending: $("kpiPending"),
  kpiCritical: $("kpiCritical"),
  kpiReturns: $("kpiReturns"),
  kpiGenerated: $("kpiGenerated"),
  kpiActive: $("kpiActive"), kpiWarehouse: $("kpiWarehouse"), kpiShipped: $("kpiShipped"),
  kpiOutForDelivery: $("kpiOutForDelivery"), kpiInsufficient: $("kpiInsufficient"), kpiOwn: $("kpiOwn"),

  toast: $("toast")
};

function formatNumber(value) { return value === null || value === undefined ? "N/D" : new Intl.NumberFormat("es-CL").format(value); }

function formatPercent(value) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString("es-CL", {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function formatRate(value, total) {
  return !total || value === null ? "N/D" : `${formatPercent(percent(value, total))}%`;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function isValidDateParts(year, month, day) {
  if (!year || !month || !day) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const test = new Date(year, month - 1, day);

  return test.getFullYear() === year
    && test.getMonth() === month - 1
    && test.getDate() === day;
}

function parseOperationalDate(value) { return LazarusTracking.parseDate(value); }

function formatShipmentDate(value) {
  const parsed = parseOperationalDate(value);

  if (!parsed) return value ? String(value) : "Sin fecha";

  return `${padDatePart(parsed.day)}-${padDatePart(parsed.month)}-${parsed.year}`;
}

function formatShipmentDateTime(value) {
  const parsed = parseOperationalDate(value);

  if (!parsed) return value ? String(value) : "Sin fecha";

  const date = `${padDatePart(parsed.day)}-${padDatePart(parsed.month)}-${parsed.year}`;

  if (!parsed.hasTime) return date;

  return `${date} ${padDatePart(parsed.hour)}:${padDatePart(parsed.minute)}`;
}

function getShipmentDateSortKey(value) {
  const parsed = parseOperationalDate(value);

  if (!parsed) return String(value || "");

  return [
    parsed.year,
    padDatePart(parsed.month),
    padDatePart(parsed.day),
    padDatePart(parsed.hour),
    padDatePart(parsed.minute),
    padDatePart(parsed.second)
  ].join("");
}

function formatDateTime(value) {
  return formatShipmentDateTime(value);
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

function normalizeKey(value) {
  return normalizeSearchText(String(value || "")).replace(/[^a-z0-9]/g, "");
}

function getByKeyVariants(object, variants = []) {
  if (!object || typeof object !== "object") return "";

  for (const key of variants) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
  }

  const normalizedVariants = variants.map(normalizeKey);
  const foundKey = Object.keys(object).find(key => normalizedVariants.includes(normalizeKey(key)));

  return foundKey ? object[foundKey] : "";
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const normalized = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");

  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
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
  if (el.channelFilter) el.channelFilter.value = "";
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


function resetDashboard(message = "No hay una publicación válida disponible.") {
  state.raw = null; state.shipments = []; state.filtered = []; state.selectedShipmentId = null; state.page = 1;
  renderSlaKpis();
  el.sourceStatus.textContent = "Sin datos"; el.sourceMeta.textContent = message;
  el.emptyState.classList.remove("hidden");
  el.emptyState.querySelector("h3").textContent = "No hay datos cargados";
  el.emptyState.querySelector("p").textContent = message;
  [el.kpiTotal, el.kpiDelivered, el.kpiTransit, el.kpiPending, el.kpiCritical, el.kpiReturns,
    el.kpiActive, el.kpiWarehouse, el.kpiShipped, el.kpiOutForDelivery, el.kpiInsufficient, el.kpiOwn].forEach(node => node.textContent = "N/D");
  el.kpiDeliveredRate.textContent = "Sin datos"; el.kpiGenerated.textContent = "Sin publicación válida";
  [el.donutChart, el.statusDonut].forEach(chart => {
    chart.className = "donut empty-donut"; chart.style.background = "";
    chart.setAttribute("aria-label", "Sin publicación válida"); delete chart.dataset.segments;
    chart.replaceChildren(); chart.textContent = "N/D";
  });
  el.donutLegend.innerHTML = ""; el.statusLegend.innerHTML = ""; el.statusDistribution.innerHTML = "";
  el.sourceDistribution.innerHTML = ""; el.periodDiagnostics.textContent = "Sin publicación válida para analizar.";
  clearFilterOptions(); el.searchInput.value = ""; renderTable(); renderEmptyDetail();
}

function buildCandidatePaths() {
  const script = new URL("js/app.js", document.baseURI);
  const url = new URL(`../data/${DATA_FILE}`, script);
  url.searchParams.set("v", String(Date.now()));
  return [url.href];
}

async function fetchJsonFromAvailablePaths() {
  const candidatePaths = [...new Set(buildCandidatePaths())];
  let lastError = null;

  for (const path of candidatePaths) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { cache: "no-store", signal: controller.signal });
      if (response.ok) {
        return { data: await response.json(), path };
      }
      lastError = new Error(`HTTP ${response.status} leyendo ${path}`);
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw lastError || new Error("No fue posible leer la fuente operativa.");
}

function getCurrentViewState() {
  return { search: el.searchInput.value, status: el.statusFilter.value, category: el.categoryFilter.value,
    channel: el.channelFilter.value, date: el.dateFilter.value, selectedShipmentId: state.selectedShipmentId, page: state.page };
}

function setSelectValueIfExists(selectElement, value) {
  if (!selectElement || !value) return false;

  const exists = [...selectElement.options].some(option => option.value === value);

  if (exists) {
    selectElement.value = value;
    return true;
  }

  // Keep an active filter even when the next snapshot has no matching orders.
  selectElement.add(new Option(value, value));
  selectElement.value = value;
  return true;
}

function restoreCurrentViewState(viewState) {
  if (!viewState) return;

  el.searchInput.value = viewState.search || "";
  setSelectValueIfExists(el.statusFilter, viewState.status);
  setSelectValueIfExists(el.categoryFilter, viewState.category);
  setSelectValueIfExists(el.channelFilter, viewState.channel);
  setSelectValueIfExists(el.dateFilter, viewState.date);


  state.selectedShipmentId = viewState.selectedShipmentId || null;
  state.page = viewState.page || 1;
}

async function loadData({ silent = false } = {}) {
  const version = ++state.requestVersion;
  if (!silent) { el.sourceStatus.textContent = "Leyendo datos"; el.sourceMeta.textContent = "Consultando publicación Polaris…"; }
  try {
    if (window.location.protocol === "file:") throw new Error("Abre Lazarus mediante un servidor HTTP o GitHub Pages.");
    const result = await fetchJsonFromAvailablePaths();
    const data = LazarusTracking.normalizePayload(result.data);
    const previousTime = LazarusTracking.parseDate(state.raw?.generatedAt)?.timestamp;
    const incomingTime = LazarusTracking.parseDate(data.generatedAt)?.timestamp;
    if (previousTime && incomingTime && incomingTime < previousTime) throw new Error("La fuente devolvió una publicación anterior a la última versión válida.");
    if (version !== state.requestVersion || !localStorage.getItem(AUTH_KEY)) return;
    const viewState = getCurrentViewState();
    const preserve = Boolean(state.raw);
    state.raw = data; state.shipments = data.shipments;
    el.sourceStatus.textContent = data.freshness === "stale" ? "Datos desactualizados" : data.freshness === "unknown" ? "Fecha no verificable" : "Datos cargados";
    const notices = [data.diagnostics.rejected.length ? `${data.diagnostics.rejected.length} registro(s) inválidos omitidos` : "",
      data.diagnostics.duplicates ? `${data.diagnostics.duplicates} duplicado(s) consolidados` : "",
      data.diagnostics.warnings ? `${data.diagnostics.warnings} orden(es) requieren revisión` : ""].filter(Boolean).join(" · ");
    el.sourceMeta.textContent = `${formatNumber(data.shipments.length)} órdenes · Contrato ${data.schemaVersion} · Generado ${formatDateTime(data.generatedAt)} · Actualización 60 s${notices ? " · " + notices : ""}`;
    renderFilters();
    if (preserve) restoreCurrentViewState(viewState);
    applyFilters({ preservePage: preserve });
    const selected = state.shipments.some(item => item.order === state.selectedShipmentId);
    if (selected) renderDetail(state.selectedShipmentId); else { state.selectedShipmentId = null; renderEmptyDetail(); }
    if (!silent) showToast("Publicación actualizada.");
  } catch (error) {
    if (version !== state.requestVersion || !localStorage.getItem(AUTH_KEY)) return;
    if (state.raw) {
      el.sourceStatus.textContent = "Actualización fallida";
      el.sourceMeta.textContent = `Se conserva la última publicación válida, generada ${formatDateTime(state.raw.generatedAt)}. ${error.message}`;
    } else resetDashboard(error.message);
  }
}

function getRawStatus(item) { return item.status; }

function getRawCategory(item) { return item.category; }

function getOrderType(item) { return item.orderType || ""; }

function getOrderSegment(item) { return item.orderSegment; }

function getSegmentClass(segment) {
  const normalized = normalizeSearchText(segment);

  if (normalized.includes("b2c")) return "b2c";
  if (normalized.includes("b2b")) return "b2b";

  return "unknown";
}

function filterByOrderSegment(items, segment) {
  if (!segment) return [...items];
  return items.filter(item => getOrderSegment(item) === segment);
}

function getOperationalScope() { return state.filtered; }

function renderFilters() {
  clearFilterOptions();

  const statuses = [...new Set(state.shipments.map(item => getRawStatus(item)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
  const categories = [...new Set(state.shipments.map(item => getRawCategory(item)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
  const dates = [...new Set(state.shipments.map(item => LazarusTracking.operationalDateKey(item.lastEventDate)).filter(Boolean))]
    .sort().reverse().map(date => date.split("-").reverse().join("-"));
  
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


function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}


function isDeliveredShipment(item) { return item.deliveryConfirmed === true; }

function getSignedByValue(item) { return item.signedBy; }

function renderSummary() {
  renderSlaKpis();
  const summary = LazarusTracking.buildSummary(getOperationalScope());
  const bindings = { totalShipments: el.kpiTotal, delivered: el.kpiDelivered, inTransit: el.kpiTransit,
    pendingCollection: el.kpiPending, thirdParty: el.kpiCritical, returns: el.kpiReturns, active: el.kpiActive,
    warehouseOrders: el.kpiWarehouse, shipped: el.kpiShipped, outForDelivery: el.kpiOutForDelivery,
    insufficient: el.kpiInsufficient, ownTransport: el.kpiOwn };
  Object.entries(bindings).forEach(([key, node]) => { node.textContent = formatNumber(summary[key]); });
  el.kpiDeliveredRate.textContent = summary.delivered === null ? "Sin evidencia disponible"
    : summary.totalShipments ? `${formatRate(summary.delivered, summary.totalShipments)} de ${formatNumber(summary.totalShipments)} órdenes filtradas`
    : "N/D · sin órdenes en el período";
  el.kpiGenerated.textContent = summary.totalShipments ? "Órdenes únicas · período y filtros activos" : "Sin datos para el período";
}

function renderSlaKpis() {
  let period = null, invalidPeriod = false;
  try { period = state.temporal.allDates ? null : LazarusTracking.buildPeriod(state.temporal.mode, state.temporal); }
  catch (error) { if (!(error instanceof RangeError)) throw error; invalidPeriod = true; }
  const unsupportedFilters = Boolean(el.searchInput.value.trim() || el.statusFilter.value || el.categoryFilter.value
    || el.dateFilter.value || (el.channelFilter.value && el.channelFilter.value !== "B2C"));
  const result = LazarusTracking.selectSlaKpis(state.raw?.slaKpis, { period, invalidPeriod, unsupportedFilters });
  for (const [key, id] of [["onTime", "kpiOnTime"], ["mitigated", "kpiMitigated"], ["unmitigated", "kpiUnmitigated"]]) {
    $(id).textContent = formatNumber(result[key]);
    $(id + "Status").textContent = result.reason;
  }
}

function renderDonut(chart, legend, items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;
  const segments = items.filter(item => item.value > 0).map(item => {
    const start = cumulative / total * 100;
    cumulative += item.value;
    return `${item.color} ${start}% ${cumulative / total * 100}%`;
  });
  chart.classList.toggle("empty-donut", total === 0);
  const background = total ? `conic-gradient(${segments.join(",")})` : "";
  const changed = chart.dataset.segments !== background;
  chart.dataset.segments = background;
  chart.style.background = background;
  if (changed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    chart.getAnimations().forEach(animation => animation.cancel());
    chart.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  }
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `${state.periodLabel}: ${total} órdenes. ${items.map(item => `${item.label}: ${item.value}`).join(". ")}`);
  if (!chart.querySelector("span")) chart.innerHTML = "<span><b></b><small></small></span>";
  chart.querySelector("span").innerHTML = `<b>${formatNumber(total)}</b><small>${total ? "Órdenes de la cohorte" : "Sin datos para el período"}</small>`;
  legend.innerHTML = items.map(item => `<div class="legend-row" data-count="${item.value}" data-percent="${total ? percent(item.value, total) : ""}">
    <span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>
    <strong>${formatNumber(item.value)} · ${formatRate(item.value, total)}</strong></div>`).join("")
    || '<p class="period-note">Sin datos para el período</p>';
}

function statusColor(status) {
  const colors = { ENTREGADA: "#34d399", "PENDIENTE DE RECOLECCION": "#fbbf24", PROGRAMADO: "#fde68a",
    "POR RECOGER": "#d97706", DEVOLUCION: "#f87171", "ENTREGA PARCIAL": "#fb7185", REINTENTO: "#fda4af",
    "DIRECCION ERRONEA": "#e11d48", TERCERIZADA: "#a78bfa", "INFORMACIÓN INSUFICIENTE": "#cbd5e1",
    "SIN CLASIFICAR": "#94a3b8", "EN RUTA": "#38bdf8", "EN REPARTO": "#818cf8",
    "EN SUCURSAL DE DESTINO": "#67e8f9", RECOLECTADO: "#2dd4bf", "EN ADUANA": "#c084fc",
    Cancelled: "#f87171", Released: "#cbd5e1", Allocated: "#94a3b8", Packed: "#60a5fa", Manifested: "#a5b4fc", Shipped: "#22d3ee" };
  return colors[status] || "#94a3b8";
}

function renderCompliance() {
  const rows = getOperationalScope();
  renderDonut(el.donutChart, el.donutLegend, LazarusTracking.buildDeliveryDistribution(rows));
  const counts = countBy(rows, "status");
  // Keep zero categories visible and colors stable when navigating between periods.
  const statuses = [...new Set(state.shipments.map(row => row.status))].sort((a, b) => a.localeCompare(b, "es"));
  renderDonut(el.statusDonut, el.statusLegend, statuses.map(label => ({ label, value: counts[label] || 0, color: statusColor(label) })));
  document.querySelectorAll(".chart-period").forEach(node => { node.textContent = state.periodLabel; });
}

function renderSourceDistribution() {
  const rows = getOperationalScope();
  el.sourceDistribution.innerHTML = [["Warehouse", "warehouseStatus", LazarusTracking.WAREHOUSE],
    ["Transporte", "transportStatus", LazarusTracking.TRANSPORT]].map(([title, field, labels]) => {
    const counts = countBy(rows, field);
    return `<section><h4>${title}</h4>${[...labels, "Sin información"].map(label => {
      const count = counts[label] || 0;
      return `<div class="source-row"><span>${escapeHtml(label)}</span><strong>${formatNumber(count)} · ${formatRate(count, rows.length)}</strong></div>`;
    }).join("")}</section>`;
  }).join("");
}

function renderStatusDistribution() {
  if (!el.statusDistribution) return;

  const scopedItems = getOperationalScope();
  const total = scopedItems.length;
  const entries = Object.entries(countBy(scopedItems.map(item => ({ status: getRawStatus(item) })), "status"))
    .filter(([label]) => label && label !== "Sin información")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es", { numeric: true }));

  if (!entries.length) {
    el.statusDistribution.innerHTML = `
      <div class="status-empty-card">
        <strong>Sin datos para el período</strong>
        <span>No hay registros suficientes para calcular la distribución.</span>
      </div>
    `;
    return;
  }

  el.statusDistribution.innerHTML = entries.map(([label, value]) => {
    const rate = percent(value, total);
    const className = getStatusClass(label);

    return `
      <div class="status-distribution-row">
        <div class="status-distribution-head">
          <span class="status-pill ${className}">${escapeHtml(label)}</span>
          <strong>${formatNumber(value)} · ${formatPercent(rate)}%</strong>
        </div>
        <div class="status-distribution-track">
          <div class="status-distribution-fill ${className}" style="width:${rate}%"></div>
        </div>
      </div>
    `;
  }).join("");
}


function renderAnalytics() { renderCompliance(); renderStatusDistribution(); renderSourceDistribution(); }

function applyFilters({ preservePage = false } = {}) {
  if (!state.raw) return;
  const previousPage = state.page;
  let error = "";
  try {
    const period = state.temporal.allDates ? null : LazarusTracking.buildPeriod(state.temporal.mode, state.temporal);
    state.periodLabel = period ? `${formatShipmentDate(period.from)} al ${formatShipmentDate(period.to)} · America/Santiago`
      : "Todo el snapshot · sin restricción temporal";
    const scope = LazarusTracking.selectDashboardRows(state.shipments, { period,
      search: el.searchInput.value, status: el.statusFilter.value, category: el.categoryFilter.value,
      channel: el.channelFilter.value, date: el.dateFilter.value });
    state.filtered = scope.rows;
    el.periodDiagnostics.textContent = `${formatNumber(scope.undated)} órdenes sin fecha operacional válida entre ${formatNumber(scope.matching)} que coinciden con los demás filtros. ${period ? "Excluidas de este período." : "Incluidas en el snapshot sin restricción temporal."} Las entregas confirmadas requieren evidencia y deliveryDate válida; no se usa esa fecha para seleccionar este período.`;
  } catch (exception) {
    if (!(exception instanceof RangeError)) throw exception;
    error = exception.message;
    state.filtered = [];
    state.periodLabel = "Período inválido · corrige las fechas para consultar";
    el.periodDiagnostics.textContent = "No se calculan resultados hasta completar un período válido.";
  }
  el.activePeriod.textContent = state.periodLabel;
  el.periodError.textContent = error;
  el.periodError.classList.toggle("hidden", !error);
  document.querySelectorAll("[data-period] input").forEach(input => input.setAttribute("aria-invalid", String(Boolean(error))));
  el.emptyState.classList.toggle("hidden", state.filtered.length > 0);
  el.emptyState.querySelector("h3").textContent = error ? "Período inválido" : "Sin datos para el período";
  el.emptyState.querySelector("p").textContent = error || "No hay órdenes que coincidan con el período y los filtros seleccionados.";

  sortFiltered(false);

  if (preservePage) {
    state.page = previousPage;
  } else {
    state.page = 1;
  }

  renderTable();
  renderSummary();
  renderAnalytics();
}

function updatePeriodControls() {
  const { mode, allDates } = state.temporal;
  el.allDates.checked = allDates;
  document.querySelectorAll("[data-period]").forEach(node => node.classList.toggle("hidden", node.dataset.period !== mode));
  el.periodMode.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(!allDates && button.dataset.periodMode === mode)));
}

function initializePeriod() {
  const today = LazarusTracking.operationalDateKey(new Date().toISOString());
  state.temporal = { mode: "day", allDates: true, day: today, month: today.slice(0, 7), year: today.slice(0, 4), from: today, to: today };
  el.periodDay.value = today; el.periodMonth.value = today.slice(0, 7); el.periodYear.value = today.slice(0, 4);
  el.periodFrom.value = today; el.periodTo.value = today;
  updatePeriodControls();
}

function updateNavigation() {
  const target = window.location.hash || "#overview";
  document.querySelectorAll(".top-nav a").forEach(link => {
    const active = link.getAttribute("href") === target;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
  });
}


function getSortableValue(item, key) {
  if (key === "lastEventDate") return getShipmentDateSortKey(item.lastEventDate);
  if (key === "status") return getRawStatus(item);
  if (key === "category") return getRawCategory(item);
  if (key === "orderSegment") return getOrderSegment(item);
  if (key === "signedBy") return getSignedByValue(item);
  return item?.[key] ?? "";
}

function sortFiltered(toggleDirection = true) {
  if (toggleDirection) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  }

  const direction = state.sortDirection === "asc" ? 1 : -1;
  const key = state.sortKey;

  state.filtered.sort((a, b) => {
    const valueA = String(getSortableValue(a, key)).toLowerCase();
    const valueB = String(getSortableValue(b, key)).toLowerCase();
    return valueA.localeCompare(valueB, "es", { numeric: true }) * direction;
  });
}

function getStatusClass(status) {
  if (status === "ENTREGADA") return "delivered";
  if (["PROGRAMADO", "PENDIENTE DE RECOLECCION", "POR RECOGER"].includes(status)) return "pending";
  if (status === "DEVOLUCION") return "return";
  if (["ENTREGA PARCIAL", "REINTENTO", "DIRECCION ERRONEA", "TERCERIZADA", "INFORMACIÓN INSUFICIENTE", "SIN CLASIFICAR"].includes(status)) return "critical";
  if (["EN RUTA", "EN REPARTO", "EN SUCURSAL DE DESTINO", "RECOLECTADO"].includes(status)) return "transit";
  return "neutral";
}

function renderTable() {
  el.recordCounter.textContent = `${formatNumber(state.filtered.length)} órdenes`;
  const pages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  state.page = Math.max(1, Math.min(state.page, pages));
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = state.filtered.slice(start, start + PAGE_SIZE);
  el.pageInfo.textContent = `${state.filtered.length ? start + 1 : 0}–${start + visible.length} de ${formatNumber(state.filtered.length)} · Página ${state.page} de ${pages}`;
  el.prevPageBtn.disabled = state.page <= 1; el.nextPageBtn.disabled = state.page >= pages;
  el.ordersTable.innerHTML = visible.length ? visible.map(item => `<tr class="${state.selectedShipmentId === item.order ? "selected" : ""}" data-shipment-id="${escapeHtml(item.order)}">
    <td><button class="order-select" data-shipment-id="${escapeHtml(item.order)}">${escapeHtml(item.order)}</button>${item.warnings.length || item.incidents.length ? '<small class="row-warning">Requiere revisión</small>' : ""}</td>
    <td>${escapeHtml(item.waybill || "Sin Waybill")}</td><td>${escapeHtml(formatShipmentDate(item.lastEventDate))}</td>
    <td><span class="status-pill ${item.transportHandover.confirmed ? "own" : getStatusClass(item.status)}">${escapeHtml(item.status)}</span>${item.transportHandover.confirmed ? '<small>Transporte propio</small>' : ""}</td>
    <td><span class="segment-pill ${getSegmentClass(item.orderSegment)}">${escapeHtml(item.orderType || "Sin tipo")}</span></td>
    <td>${renderProgress(item.warehouseFlow, "Warehouse")}</td><td>${renderProgress(item.transportFlow, "Transporte")}</td>
  </tr>`).join("") : '<tr><td colspan="7" class="table-empty">No hay órdenes que coincidan con los filtros</td></tr>';
}

function pickFirst(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "") ?? "";
}

function renderDetail(shipmentId) {
  const item = state.shipments.find(row => row.order === String(shipmentId));
  if (!item) { renderEmptyDetail(); return; }
  state.selectedShipmentId = item.order; renderTable();
  const field = (label, value, empty = "Sin información") => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${value === "" ? escapeLiteral(empty) : escapeHtml(value)}</strong></div>`;
  const remarks = item.shipmentState.trim().toLowerCase() !== "shipment delivered ok" && item.commentsAvailable
    ? `<div class="detail-description"><span>Comentario ProView L</span><p>${escapeLiteral(item.originalStatus)}</p><span>Comentario ProView M</span><p>${escapeLiteral(item.originalComment)}</p></div>` : "";
  el.orderDetail.className = "enterprise-detail";
  el.orderDetail.innerHTML = `<div class="detail-hero-row"><span>Orden LT</span><strong>${escapeHtml(item.order)}</strong></div>
    ${item.transportHandover.confirmed ? '<p class="handover-note">Entregada a transporte propio. No confirma recepción del destinatario.</p>' : ""}
    <div class="detail-list">${field("Waybill", item.waybill, "Sin Waybill")}${field("Order Type", item.orderType)}${field("Estado general", item.status)}
    ${field("Warehouse", item.warehouseStatus)}${field("Transporte", item.transportStatus)}
    ${field("Último evento ProView", item.shipmentState || item.lastEventDescription)}${field("Fecha de evento", formatShipmentDateTime(item.lastEventDate))}
    ${field("Entrega confirmada", item.deliveryConfirmed ? formatShipmentDateTime(item.deliveryDate) : "", "Sin evidencia válida de entrega")}
    ${item.status === "ENTREGADA" && item.signedByAvailable ? field("Signed By", item.signedBy, "") : ""}
    ${field("Actualización de orden", item.lastUpdatedAt ? formatShipmentDateTime(item.lastUpdatedAt) : "")}</div>
    <div class="detail-description">${renderProgress(item.warehouseFlow, "Warehouse")}${renderProgress(item.transportFlow, "Transporte")}</div>
    ${remarks}${item.incidents.length || item.warnings.length ? `<div class="detail-description"><span>Incidencias y validaciones</span><ul>${[...item.incidents, ...item.warnings.map(warningLabel)].map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>` : ""}
    <div class="detail-description"><span>Historial observado · ${item.events.length} evento(s)</span><ol class="event-list">${item.events.map(event => `<li><strong>${escapeHtml(event.status)}</strong><time>${escapeHtml(formatShipmentDateTime(event.date))}</time><p>${escapeLiteral(event.description)}</p></li>`).join("") || '<li>Sin historial publicado.</li>'}</ol></div>`;
}

function clearFilters() {
  el.searchInput.value = "";
  el.statusFilter.value = "";
  el.categoryFilter.value = "";
  if (el.channelFilter) el.channelFilter.value = "";
  el.dateFilter.value = "";
  initializePeriod();
  state.selectedShipmentId = null;

  applyFilters();
  renderEmptyDetail();
}

function exportCsv() {
  if (!state.filtered.length) { showToast("No hay registros para exportar."); return; }
  const blob = new Blob([LazarusTracking.csv(state.filtered)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `lazarus_tracking_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function escapeLiteral(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function warningLabel(code) {
  return ({ PROGRESS_INVALID: "Progreso publicado inconsistente", DELIVERY_NOT_CONFIRMED: "Entrega sin evidencia válida",
    STATUS_PROGRESS_CONFLICT: "Estado y progreso contradictorios", DELIVERY_PROGRESS_CONFLICT: "Hito de entrega no confirmado",
    DUPLICATE_ORDER_CONFLICT: "Fuentes duplicadas en conflicto; requiere revisión" })[code] || "Información en revisión";
}
function renderProgress(steps, title) {
  const states = { complete: "Completada", current: "Actual", pending: "Pendiente", disabled: "Inactiva", unknown: "Sin información", conflict: "En revisión" };
  return `<div class="progress-block"><strong class="progress-title">${title}</strong><ol class="progress-flow" aria-label="Progreso ${title}">${steps.map(step => `<li class="flow-step ${step.state} ${step.evidence === "inferred" ? "inferred" : ""} ${step.evidence === "warehouse" ? "own" : ""}" title="${escapeHtml(states[step.state] + " · " + (step.evidence === "inferred" ? "Etapa inferida, sin evento observado" : step.evidence === "observed" ? "Evidencia observada" : step.evidence === "warehouse" ? "Entrega a transporte propio por Warehouse" : "Sin evidencia"))}"><span>${step.evidence === "inferred" ? "≈ " : ""}${escapeHtml(step.label)}</span><small>${step.evidence === "inferred" ? "Inferida" : step.evidence === "none" ? "Sin evidencia" : step.evidence === "warehouse" ? "Transporte propio" : states[step.state]}</small></li>`).join("")}</ol></div>`;
}

function bindDashboardEvents() {
  initializePeriod();
  updateNavigation();
  window.addEventListener("hashchange", updateNavigation);
  el.reloadBtn.addEventListener("click", () => loadData());
  el.exportBtn.addEventListener("click", exportCsv);
  el.clearFiltersBtn.addEventListener("click", clearFilters);

  el.searchInput.addEventListener("input", applyFilters);
  el.statusFilter.addEventListener("change", applyFilters);
  el.categoryFilter.addEventListener("change", applyFilters);
  if (el.channelFilter) el.channelFilter.addEventListener("change", applyFilters);
  el.dateFilter.addEventListener("change", applyFilters);
  el.periodMode.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    state.temporal.mode = button.dataset.periodMode;
    state.temporal.allDates = false;
    updatePeriodControls();
    applyFilters();
  }));
  Object.entries({ day: el.periodDay, month: el.periodMonth, year: el.periodYear, from: el.periodFrom, to: el.periodTo }).forEach(([key, input]) => {
    input.setAttribute("aria-describedby", "periodError");
    input.addEventListener("input", () => {
      state.temporal[key] = input.value;
      state.temporal.allDates = false;
      updatePeriodControls();
      applyFilters();
    });
  });
  el.allDates.addEventListener("change", () => {
    state.temporal.allDates = el.allDates.checked;
    updatePeriodControls();
    applyFilters();
  });

  if (el.exportStockBreaksBtn) el.exportStockBreaksBtn.addEventListener("click", exportStockBreaks);


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

  el.prevPageBtn.addEventListener("click", () => { state.page--; renderTable(); });
  el.nextPageBtn.addEventListener("click", () => { state.page++; renderTable(); });
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

  resetDashboard("Esperando lectura de la fuente operativa.");
  loadData();

  window.clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = window.setInterval(() => {
    if (localStorage.getItem(AUTH_KEY)) loadData({ silent: true });
  }, AUTO_REFRESH_MS);
}

function stopDashboard() {
  window.clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  state.requestVersion++;
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
