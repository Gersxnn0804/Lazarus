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
  el.sourceStatus.textContent = "Sin datos"; el.sourceMeta.textContent = message;
  el.emptyState.classList.remove("hidden");
  [el.kpiTotal, el.kpiDelivered, el.kpiTransit, el.kpiPending, el.kpiCritical, el.kpiReturns,
    el.kpiActive, el.kpiWarehouse, el.kpiShipped, el.kpiOutForDelivery, el.kpiInsufficient, el.kpiOwn].forEach(node => node.textContent = "N/D");
  el.kpiDeliveredRate.textContent = "Sin datos"; el.kpiGenerated.textContent = "Sin publicación válida";
  el.donutChart.className = "donut empty-donut"; el.donutChart.style.setProperty("--value", 0);
  el.donutChart.innerHTML = "<span>N/D<small>Entregas confirmadas</small></span>";
  el.donutLegend.innerHTML = ""; el.statusDistribution.innerHTML = "";
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

  selectElement.value = "";
  return false;
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
    el.emptyState.classList.toggle("hidden", data.shipments.length > 0);
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
  const dates = [...new Set(state.shipments.map(item => formatShipmentDate(item.lastEventDate)).filter(date => date && date !== "Sin fecha"))].sort((a, b) => getShipmentDateSortKey(b).localeCompare(getShipmentDateSortKey(a)));
  
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
  const summary = LazarusTracking.buildSummary(getOperationalScope());
  const bindings = { totalShipments: el.kpiTotal, delivered: el.kpiDelivered, inTransit: el.kpiTransit,
    pendingCollection: el.kpiPending, thirdParty: el.kpiCritical, returns: el.kpiReturns, active: el.kpiActive,
    warehouseOrders: el.kpiWarehouse, shipped: el.kpiShipped, outForDelivery: el.kpiOutForDelivery,
    insufficient: el.kpiInsufficient, ownTransport: el.kpiOwn };
  Object.entries(bindings).forEach(([key, node]) => { node.textContent = formatNumber(summary[key]); });
  el.kpiDeliveredRate.textContent = summary.delivered === null ? "Sin evidencia disponible" : `${formatPercent(percent(summary.delivered, summary.totalShipments))}% de las órdenes filtradas`;
  el.kpiGenerated.textContent = "Órdenes únicas · filtros activos";
}

function renderDonutLegend(items) {
  el.donutLegend.innerHTML = items.map((item) => `
    <div class="legend-row ${item.className || ""}">
      <span><i></i>${escapeHtml(item.label)}</span>
      <strong>${item.value === null ? "N/D" : `${formatNumber(item.value)} (${formatPercent(item.rate)}%)`}</strong>
    </div>
  `).join("");
}

function renderCompliance() {
  const summary = LazarusTracking.buildSummary(getOperationalScope());
  const rate = summary.delivered === null ? null : percent(summary.delivered, summary.totalShipments);
  el.donutChart.className = rate === null ? "donut empty-donut" : "donut";
  el.donutChart.style.setProperty("--value", rate || 0);
  el.donutChart.innerHTML = `<span>${rate === null ? "N/D" : formatPercent(rate) + "%"}<small>Entrega confirmada</small></span>`;
  renderDonutLegend([
    { label: "Entregas confirmadas", value: summary.delivered, rate: rate || 0, className: "green" },
    { label: "Activas", value: summary.active, rate: percent(summary.active, summary.totalShipments), className: "blue" },
    { label: "Transporte propio", value: summary.ownTransport, rate: percent(summary.ownTransport, summary.totalShipments), className: "violet" },
    { label: "Canceladas", value: summary.cancelled, rate: percent(summary.cancelled, summary.totalShipments), className: "amber" },
    { label: "Devoluciones", value: summary.returns, rate: percent(summary.returns, summary.totalShipments), className: "red" }
  ]);
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
        <strong>Sin estados disponibles</strong>
        <span>No hay registros suficientes para calcular la distribución.</span>
      </div>
    `;
    return;
  }

  const maxValue = Math.max(...entries.map(([, value]) => value), 1);

  el.statusDistribution.innerHTML = entries.map(([label, value]) => {
    const width = percent(value, maxValue);
    const rate = percent(value, total);
    const className = getStatusClass(label);

    return `
      <div class="status-distribution-row">
        <div class="status-distribution-head">
          <span class="status-pill ${className}">${escapeHtml(label)}</span>
          <strong>${formatNumber(value)} · ${formatPercent(rate)}%</strong>
        </div>
        <div class="status-distribution-track">
          <div class="status-distribution-fill ${className}" style="width:${Math.max(Math.min(width, 100), 2)}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

































function renderAnalytics() { renderCompliance(); renderStatusDistribution(); }

function applyFilters({ preservePage = false } = {}) {
  const previousPage = state.page;
  const search = normalizeSearchText(el.searchInput.value);
  const status = el.statusFilter.value;
  const category = el.categoryFilter.value;
  const channel = el.channelFilter?.value || "";
  const date = el.dateFilter.value;

  state.filtered = state.shipments.filter(item => {
    const rawStatus = getRawStatus(item);
    const rawCategory = getRawCategory(item);
    const signedBy = getSignedByValue(item);
    const itemDate = formatShipmentDate(item.lastEventDate);

  const matchesSearch = !search || [
    item.order,
    item.waybill,
    itemDate,
    rawStatus,
    rawCategory,
    signedBy,
    item.lastEventLabel,
    item.lastEventDescription,
    item.customer,
    item.client,
    item.destination,
    item.destino
  ].some(value => normalizeSearchText(value).includes(search));

    return matchesSearch
      && (!status || rawStatus === status)
      && (!category || rawCategory === category)
      && (!channel || getOrderSegment(item) === channel)
      && (!date || itemDate === date);
  });

  sortFiltered(false);

  if (preservePage) {
    state.page = previousPage;
  } else {
    state.page = 1;
  }

  renderTable();
  renderSummary();
  renderCompliance();
  renderStatusDistribution();
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
  el.reloadBtn.addEventListener("click", () => loadData());
  el.exportBtn.addEventListener("click", exportCsv);
  el.clearFiltersBtn.addEventListener("click", clearFilters);

  el.searchInput.addEventListener("input", applyFilters);
  el.statusFilter.addEventListener("change", applyFilters);
  el.categoryFilter.addEventListener("change", applyFilters);
  if (el.channelFilter) el.channelFilter.addEventListener("change", applyFilters);
  el.dateFilter.addEventListener("change", applyFilters);

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
