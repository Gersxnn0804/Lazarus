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
  stockBreakLines: [],
  stockBreakFiltered: [],
  orderTypeByOrder: new Map(),
  stockBreakSourceMode: "none",
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

  stockBreakLinesKpi: $("stockBreakLinesKpi"),
  stockBreakOrdersKpi: $("stockBreakOrdersKpi"),
  stockBreakMissingKpi: $("stockBreakMissingKpi"),
  stockBreakDominantTypeKpi: $("stockBreakDominantTypeKpi"),
  stockBreakSearch: $("stockBreakSearch"),
  stockBreakTypeFilter: $("stockBreakTypeFilter"),
  exportStockBreaksBtn: $("exportStockBreaksBtn"),
  stockBreaksTable: $("stockBreaksTable"),
  stockBreaksCounter: $("stockBreaksCounter"),
  stockBreaksMeta: $("stockBreaksMeta"),

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
  statusDistribution: $("statusDistribution"),

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

function renderEmptyStockout() {
  el.stockoutThermometer.style.setProperty("--level", 0);
  el.stockoutList.className = "stockout-list empty-stockout";
  el.stockoutList.innerHTML = `
    <div class="stockout-empty-card">
      <strong>Sin quiebres informados</strong>
      <span>La información actual no contiene datos por ítem/SKU para calcular este indicador.</span>
    </div>
  `;
}

function resetDashboard(message = "No se encontró información disponible.") {
  state.raw = null;
  state.shipments = [];
  state.filtered = [];
  state.stockBreakLines = [];
  state.stockBreakFiltered = [];
  state.orderTypeByOrder = new Map();
  state.stockBreakSourceMode = "none";
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
  renderStockBreaks();

  clearFilterOptions();

  el.searchInput.value = "";
  el.recordCounter.textContent = "0 registros";
  if (el.pageInfo) el.pageInfo.textContent = "Mostrando 0 envíos";
  el.ordersTable.innerHTML = '<tr><td colspan="6" class="table-empty">Sin datos para mostrar</td></tr>';

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
        return { data: await response.json(), path };
      }
      lastError = new Error(`HTTP ${response.status} leyendo ${path}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No fue posible leer la fuente operativa.");
}

function getCurrentViewState() {
  return {
    search: el.searchInput?.value || "",
    status: el.statusFilter?.value || "",
    category: el.categoryFilter?.value || "",
    channel: el.channelFilter?.value || "",
    date: el.dateFilter?.value || "",
    stockBreakSearch: el.stockBreakSearch?.value || "",
    stockBreakType: el.stockBreakTypeFilter?.value || "",
    selectedShipmentId: state.selectedShipmentId,
    page: state.page
  };
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

  if (el.stockBreakSearch) el.stockBreakSearch.value = viewState.stockBreakSearch || "";
  setSelectValueIfExists(el.stockBreakTypeFilter, viewState.stockBreakType);

  state.selectedShipmentId = viewState.selectedShipmentId || null;
  state.page = viewState.page || 1;
}

async function loadData({ silent = false } = {}) {
  try {
    if (!silent) {
      el.sourceStatus.textContent = "Leyendo datos";
      el.sourceMeta.textContent = `Consultando fuente operativa...`;
    }

    if (window.location.protocol === "file:") {
      resetDashboard("Estás abriendo el HTML directo desde Windows. Para cargar la información usa GitHub Pages, Live Server o un servidor local.");
      return;
    }

    const result = await fetchJsonFromAvailablePaths();
    const data = result.data;

    if (!data || !Array.isArray(data.shipments)) {
      resetDashboard("La fuente existe, pero no contiene un arreglo válido de envíos.");
      return;
    }

    const viewState = getCurrentViewState();
    const shouldPreserveView = Boolean(state.raw);

    state.raw = data;
    state.shipments = data.shipments;
    state.orderTypeByOrder = buildOrderTypeIndex(data);
    state.stockBreakLines = normalizeStockBreakLines(data);
    state.filtered = [...state.shipments];
    state.stockBreakFiltered = [...state.stockBreakLines];

    if (!shouldPreserveView) {
      state.selectedShipmentId = null;
      state.page = 1;
    }

    el.emptyState.classList.add("hidden");
    el.sourceStatus.textContent = "Datos cargados";
    el.sourceMeta.textContent = `${formatNumber(state.shipments.length)} registros · Generado ${formatDateTime(data.generatedAt)} · Auto refresh 60s`;

    renderFilters();

    if (shouldPreserveView) {
      restoreCurrentViewState(viewState);
    }

    applyFilters({ preservePage: shouldPreserveView });
    renderStockBreaks();
    renderSummary();
    renderAnalytics();

    const selectedStillExists = state.selectedShipmentId
      && state.shipments.some(item => getShipmentId(item) === state.selectedShipmentId);

    if (selectedStillExists) {
      renderDetail(state.selectedShipmentId);
    } else {
      state.selectedShipmentId = null;
      renderEmptyDetail();
    }

    if (!silent) showToast("Datos actualizados correctamente.");
  } catch (error) {
    resetDashboard(`No fue posible leer la fuente operativa. Verifica que el archivo exista y que la página esté publicada o ejecutada con Live Server.`);
    console.error(error);
  }
}


function getIdentifierKeysFromAny(item) {
  if (!item || typeof item !== "object") return [];

  const candidates = [
    item.order,
    item.orderId,
    item.OrderId,
    item.OrderID,
    item.orden,
    item.codigo_orden,
    item.orderNumber,
    item.originalOrderId,
    item.original_order_id,
    item.waybill,
    item.tracking,
    item.trackingNumber,
    item.shipmentId,
    item.id,
    getByKeyVariants(item, [
      "order", "orderId", "Order ID", "OrderId", "OrderID", "Orden", "codigo orden",
      "order number", "originalOrderId", "original order id", "waybill", "tracking",
      "tracking number", "shipmentId", "shipment id"
    ])
  ];

  return [...new Set(candidates
    .map(value => safeText(value))
    .filter(value => value && value !== "Sin información"))];
}

function getOrderKeyFromAny(item) {
  return getIdentifierKeysFromAny(item)[0] || "";
}

function getOrderTypeFromAny(item) {
  return pickFirst(
    item?.orderType,
    item?.order_type,
    item?.OrderType,
    item?.Ordertype,
    item?.["Order Type"],
    item?.["order type"],
    item?.tipoOrden,
    item?.tipo_orden,
    item?.tipoDeOrden,
    item?.tipo_de_orden,
    item?.tipoOperacion,
    item?.tipo_operacion,
    item?.operationType,
    item?.operation_type,
    item?.orderClass,
    item?.order_class,
    item?.channel,
    item?.canal,
    item?.businessType,
    item?.business_type,
    item?.segment,
    item?.segmento,
    getByKeyVariants(item, [
      "orderType", "order_type", "Order Type", "OrderType", "Tipo Orden", "Tipo de Orden",
      "tipoOrden", "tipo_orden", "tipoOperacion", "tipo operacion", "operationType",
      "operation type", "orderClass", "order class", "channel", "canal", "businessType",
      "business type", "segment", "segmento"
    ])
  );
}

function collectObjectsDeep(source, output = [], depth = 0) {
  if (!source || depth > 7) return output;

  if (Array.isArray(source)) {
    source.forEach(item => collectObjectsDeep(item, output, depth + 1));
    return output;
  }

  if (typeof source !== "object") return output;

  output.push(source);

  Object.values(source).forEach(value => {
    if (value && typeof value === "object") collectObjectsDeep(value, output, depth + 1);
  });

  return output;
}

function buildOrderTypeIndex(data = state.raw) {
  const index = new Map();
  const sources = [
    data?.shipments,
    data?.orders,
    data?.supplyAudit?.orders,
    data?.supplyAudit?.lines,
    data?.supplyAudit?.stockBreakLines,
    data?.supplyAudit?.stockBreaks?.orders,
    data?.supplyAudit?.stockBreaks?.lines,
    data?.stockBreaks?.orders,
    data?.stockBreaks?.lines,
    data?.ordersWithStockBreaks,
    data?.orderTypes,
    data?.filters?.orderTypes
  ].filter(Boolean);

  const objects = [
    ...sources.flatMap(source => flattenStockBreakSource(source)),
    ...collectObjectsDeep(data?.supplyAudit || {}),
    ...collectObjectsDeep(data?.stockBreaks || {})
  ];

  objects.forEach(item => {
    const orderType = getOrderTypeFromAny(item);
    if (!orderType) return;

    getIdentifierKeysFromAny(item).forEach(identifier => {
      index.set(identifier, orderType);
      index.set(normalizeSearchText(identifier), orderType);
    });
  });

  return index;
}

function getRawStatus(item) {
  return pickFirst(
    item?.status,
    item?.estado,
    item?.state,
    item?.lastEventLabel,
    item?.lastStatus,
    item?.trackingStatus,
    item?.shipmentStatus,
    "Sin estado"
  );
}

function getRawCategory(item) {
  return pickFirst(item?.category, item?.categoria, item?.group, item?.statusGroup, item?.channel, item?.canal, "Sin categoría");
}

function getOrderType(item) {
  const directType = getOrderTypeFromAny(item);
  if (directType) return directType;

  const identifiers = [
    ...getIdentifierKeysFromAny(item),
    getShipmentId(item)
  ].map(value => safeText(value)).filter(Boolean);

  for (const identifier of identifiers) {
    const exactMatch = state.orderTypeByOrder?.get(identifier);
    if (exactMatch) return exactMatch;

    const normalizedMatch = state.orderTypeByOrder?.get(normalizeSearchText(identifier));
    if (normalizedMatch) return normalizedMatch;
  }

  return "";
}

function getOrderSegment(item) {
  const rawType = getOrderType(item);
  const type = normalizeSearchText(rawType);

  if (!type) return "Sin tipo";

  return type.includes("b2c") || type.includes("business to consumer") || type.includes("consumer") ? "B2C" : "B2B";
}

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

function getOperationalScope() {
  return filterByOrderSegment(state.shipments, el.channelFilter?.value || "");
}

function renderFilters() {
  clearFilterOptions();

  const statuses = [...new Set(state.shipments.map(item => getRawStatus(item)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
  const categories = [...new Set(state.shipments.map(item => getRawCategory(item)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
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

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function countStatusByWords(words) {
  const normalizedWords = words.map(normalizeSearchText);

  return state.shipments.filter(item => {
    const text = normalizeSearchText([
      getRawStatus(item),
      getRawCategory(item),
      item.lastEventLabel,
      item.lastEventDescription
    ].join(" "));

    return normalizedWords.some(word => text.includes(word));
  }).length;
}

function isDeliveredShipment(item) {
  const text = normalizeSearchText([
    getRawStatus(item),
    getRawCategory(item),
    item.lastEventLabel,
    item.lastEventDescription
  ].join(" "));

  return text.includes("entregado") || text.includes("finalizado") || text.includes("delivered");
}

function isThirdPartyShipment(item) {
  const text = normalizeSearchText(Object.values(item || {}).join(" "));

  return [
    "tercerizado",
    "tercerizada",
    "tercerizados",
    "tercero",
    "terceros",
    "subcontratista",
    "subcontratado",
    "subcontratada",
    "outsourcing",
    "externalizado",
    "externalizada"
  ].some(word => text.includes(word));
}

function getThirdPartyTotal(items = getOperationalScope()) {
  const segmentActive = Boolean(el.channelFilter?.value);
  const summary = state.raw?.summary || {};
  const summaryValue = pickFirst(
    summary.thirdParty,
    summary.thirdparty,
    summary.thirdPartyShipments,
    summary.thirdPartyDeliveries,
    summary.tercerizados,
    summary.tercerizado,
    summary.outsourced,
    summary.subcontracted,
    summary.critical
  );

  if (!segmentActive && summaryValue !== "") return Number(summaryValue) || 0;

  return items.filter(isThirdPartyShipment).length;
}

function isMeaningfulSignedBy(value) {
  const text = normalizeSearchText(value);
  if (!text) return false;

  return ![
    "no poseo informacion",
    "no poseo información",
    "sin informacion",
    "sin información",
    "sin info",
    "n/a",
    "na",
    "null",
    "undefined",
    "-"
  ].includes(text);
}

function getSignedByValue(item) {
  const candidates = [
    item?.signedByRaw,
    item?.signed_by_raw,
    item?.["signed by raw"],
    item?.columnO,
    item?.colO,
    item?.o,
    item?.O,
    item?.signedBy,
    item?.signed_by,
    item?.signedby,
    item?.["signed by"],
    item?.["Signed by"],
    item?.["Signed By"],
    item?.["SIGNED BY"],
    item?.receivedBy,
    item?.received_by,
    item?.receivedby,
    item?.receiver,
    item?.recipient,
    item?.receivedByName,
    getByKeyVariants(item, [
      "signedByRaw", "signed by raw", "signedBy", "signed_by", "signed by", "Signed By", "SIGNED BY",
      "receivedBy", "received_by", "received by", "Recibido por", "recibido por",
      "receiver", "recipient", "columnO", "colO", "o", "O"
    ])
  ];

  const signedBy = candidates.find(isMeaningfulSignedBy);
  if (signedBy) return signedBy;

  return isDeliveredShipment(item) ? "Entregado" : "";
}

function countStatusByWordsInItems(items, words) {
  const normalizedWords = words.map(normalizeSearchText);

  return items.filter(item => {
    const text = normalizeSearchText([
      getRawStatus(item),
      getRawCategory(item),
      item.lastEventLabel,
      item.lastEventDescription
    ].join(" "));

    return normalizedWords.some(word => text.includes(word));
  }).length;
}

function renderSummary() {
  const items = getOperationalScope();
  const segmentActive = Boolean(el.channelFilter?.value);
  const total = !segmentActive && getSummaryValue("totalShipments") ? getSummaryValue("totalShipments") : items.length;
  const delivered = !segmentActive && getSummaryValue("delivered") ? getSummaryValue("delivered") : countStatusByWordsInItems(items, ["entregado", "finalizado", "delivered"]);
  const inTransit = !segmentActive && getSummaryValue("inTransit") ? getSummaryValue("inTransit") : countStatusByWordsInItems(items, ["tránsito", "transito", "ruta", "proceso", "in transit"]);
  const scheduled = !segmentActive && getSummaryValue("scheduled") ? getSummaryValue("scheduled") : countStatusByWordsInItems(items, ["programado", "agendado", "scheduled"]);
  const retry = !segmentActive && getSummaryValue("retry") ? getSummaryValue("retry") : countStatusByWordsInItems(items, ["reintento", "retry"]);
  const thirdParty = getThirdPartyTotal(items);
  const returns = !segmentActive && getSummaryValue("returns") ? getSummaryValue("returns") : countStatusByWordsInItems(items, ["devolución", "devolucion", "retorno", "return"]);
  const deliveredRate = percent(delivered, total);

  el.kpiTotal.textContent = formatNumber(total);
  el.kpiDelivered.textContent = formatNumber(delivered);
  el.kpiDeliveredRate.textContent = `${formatPercent(deliveredRate)}% del total`;
  el.kpiTransit.textContent = formatNumber(inTransit);
  el.kpiPending.textContent = formatNumber(scheduled + retry);
  el.kpiCritical.textContent = formatNumber(thirdParty);
  el.kpiReturns.textContent = formatNumber(returns);
  const segmentLabel = el.channelFilter?.value ? `Segmento ${el.channelFilter.value}` : "Todos los envíos";
  el.kpiGenerated.textContent = state.raw?.generatedAt ? `${segmentLabel} · Generado ${formatDateTime(state.raw.generatedAt)}` : segmentLabel;
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
  const items = getOperationalScope();
  const segmentActive = Boolean(el.channelFilter?.value);
  const total = !segmentActive && getSummaryValue("totalShipments") ? getSummaryValue("totalShipments") : items.length;
  const delivered = !segmentActive && getSummaryValue("delivered") ? getSummaryValue("delivered") : countStatusByWordsInItems(items, ["entregado", "finalizado", "delivered"]);
  const inTransit = !segmentActive && getSummaryValue("inTransit") ? getSummaryValue("inTransit") : countStatusByWordsInItems(items, ["tránsito", "transito", "ruta", "proceso", "in transit"]);
  const pending = (!segmentActive && getSummaryValue("scheduled") ? getSummaryValue("scheduled") : countStatusByWordsInItems(items, ["programado", "agendado", "scheduled"])) + (!segmentActive && getSummaryValue("retry") ? getSummaryValue("retry") : countStatusByWordsInItems(items, ["reintento", "retry"]));
  const returns = !segmentActive && getSummaryValue("returns") ? getSummaryValue("returns") : countStatusByWordsInItems(items, ["devolución", "devolucion", "retorno", "return"]);
  const thirdParty = getThirdPartyTotal(items);
  const deliveredRate = percent(delivered, total);

  el.donutChart.className = "donut";
  el.donutChart.style.setProperty("--value", deliveredRate);
  el.donutChart.innerHTML = `<span>${formatPercent(deliveredRate)}%<small>${el.channelFilter?.value || "Entregados"}</small></span>`;

  renderDonutLegend([
    { label: "Entregados", value: delivered, rate: deliveredRate, className: "green" },
    { label: "En tránsito", value: inTransit, rate: percent(inTransit, total), className: "blue" },
    { label: "Pendientes", value: pending, rate: percent(pending, total), className: "amber" },
    { label: "Devoluciones", value: returns, rate: percent(returns, total), className: "violet" },
    { label: "Tercerizados", value: thirdParty, rate: percent(thirdParty, total), className: "red" }
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

function getFirstArray(...candidates) {
  return candidates.find(Array.isArray) || [];
}


function getNestedStockBreakLines(data = state.raw) {
  const explicitLineSources = [
    data?.supplyAudit?.stockBreaks?.lines,
    data?.stockBreaks?.lines,
    data?.supplyAudit?.stockBreakLines,
    data?.stockBreakLines
  ].filter(source => Array.isArray(source) && source.length);

  if (explicitLineSources.length) {
    return explicitLineSources.flatMap(source => flattenStockBreakSource(source));
  }

  const orderSources = [
    data?.supplyAudit?.stockBreaks?.orders,
    data?.stockBreaks?.orders,
    data?.ordersWithStockBreaks,
    data?.supplyAudit?.orders
  ].filter(source => Array.isArray(source) && source.length);

  return orderSources.flatMap(source => flattenStockBreakSource(source));
}

function aggregateStockBreakLinesForThermometer() {
  const lines = state.stockBreakLines.length ? state.stockBreakLines : normalizeStockBreakLines(state.raw);
  const grouped = new Map();

  lines.forEach(line => {
    const key = line.sku || line.description || "Sin SKU";
    if (!grouped.has(key)) {
      grouped.set(key, {
        item: key,
        description: line.description,
        affectedOrderSet: new Set(),
        missingUnits: 0,
        requiredUnits: 0,
        availableUnits: 0,
        orderTypes: new Set()
      });
    }

    const current = grouped.get(key);
    if (line.order) current.affectedOrderSet.add(line.order);
    current.missingUnits += Number(line.missingQty || 0);
    current.requiredUnits += Number(line.requiredQty || 0);
    current.availableUnits += Number(line.availableQty || 0);
    current.orderTypes.add(line.segment || "B2B");
  });

  const totalOrders = new Set(lines.map(line => line.order).filter(Boolean)).size;

  return [...grouped.values()].map(item => ({
    item: item.item,
    description: item.description,
    stockoutIndex: totalOrders ? percent(item.affectedOrderSet.size, totalOrders) : 0,
    affectedOrders: item.affectedOrderSet.size,
    totalAuditOrders: totalOrders,
    affectedRatio: totalOrders ? `${item.affectedOrderSet.size}/${totalOrders}` : "",
    missingUnits: item.missingUnits,
    requiredUnits: item.requiredUnits,
    availableUnits: item.availableUnits,
    orderTypes: [...item.orderTypes],
    unit: "%"
  }));
}

function getStockoutSource() {
  return getFirstArray(
    state.raw?.inventoryThermometer?.topCriticalItems,
    state.raw?.inventoryThermometer?.items,
    state.raw?.inventoryThermometer?.criticalItems,
    state.raw?.inventoryThermometer?.data,
    state.raw?.supplyAudit?.stockBreaks?.items,
    state.raw?.supplyAudit?.stockBreaks?.topCriticalItems,
    state.raw?.stockBreaks?.items,
    state.raw?.stockBreaks?.topCriticalItems,
    state.raw?.stockBreaks,
    state.raw?.stockBreakItems,
    state.raw?.stockBreaksByItem,
    state.raw?.stockoutItems,
    state.raw?.stockouts,
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
    ?? item.value
    ?? item.indiceQuiebre
    ?? item.indice_quiebre
    ?? item.breakIndex
    ?? item.quiebreIndex
    ?? item.index
    ?? item.score
    ?? item.rate
    ?? item.percentage
    ?? item.percent
    ?? item.severity
    ?? item.count
    ?? item.missingUnits
    ?? item.unidadesFaltantes
    ?? item.quiebres
    ?? item.stockBreaks
    ?? 0;

  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = 0;

  const unit = String(item.unit || item.unitLabel || item.unidad || "").trim();
  const hasExplicitPercent = unit === "%" || "stockoutIndex" in item || "value" in item;

  if (value > 0 && value <= 1 && !hasExplicitPercent && (
    "rate" in item ||
    "percentage" in item ||
    "percent" in item ||
    "indiceQuiebre" in item ||
    "indice_quiebre" in item
  )) {
    value = value * 100;
  }

  return value;
}

function normalizeStockoutItems() {
  const explicitItems = getStockoutSource();

  if (!explicitItems.length) return aggregateStockBreakLinesForThermometer();

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

    return {
      label: safeText(label),
      stockoutIndex: normalizeStockoutValue(item),
      affectedOrders: Number(item.affectedOrders ?? item.orders ?? item.orderCount ?? item.ordenesAfectadas ?? 0) || 0,
      totalAuditOrders: Number(item.totalAuditOrders ?? item.totalOrders ?? state.raw?.inventoryThermometer?.totalAuditOrders ?? 0) || 0,
      affectedRatio: item.affectedRatio || item.ratio || "",
      missingUnits: Number(item.missingUnits ?? item.unidadesFaltantes ?? item.shortageUnits ?? 0) || 0,
      requiredUnits: Number(item.requiredUnits ?? item.unidadesRequeridas ?? 0) || 0,
      availableUnits: Number(item.availableUnits ?? item.stockDisponible ?? item.available ?? 0) || 0,
      orderTypes: Array.isArray(item.orderTypes) ? item.orderTypes.join(", ") : safeText(item.orderTypes || ""),
      unit: item.unit || item.unitLabel || item.unidad || "%"
    };
  })
    .filter(item => item.label !== "Sin información" && (item.affectedOrders > 0 || item.stockoutIndex > 0 || item.missingUnits > 0))
    .sort((a, b) => b.affectedOrders - a.affectedOrders || b.missingUnits - a.missingUnits || b.stockoutIndex - a.stockoutIndex);
}

function getThermometerTotalAuditOrders(items) {
  const fromRoot = Number(state.raw?.inventoryThermometer?.totalAuditOrders ?? state.raw?.inventoryThermometer?.totalOrders ?? 0) || 0;
  const fromItems = Math.max(...items.map(item => Number(item.totalAuditOrders || 0)), 0);
  return fromRoot || fromItems || Math.max(...items.map(item => Number(item.affectedOrders || 0)), 0);
}

function renderThermometerScale(totalAuditOrders) {
  const scale = document.querySelector(".thermo-scale");
  if (!scale) return;

  const total = Number(totalAuditOrders || 0);
  const values = total > 0
    ? [total, Math.round(total * .75), Math.round(total * .50), Math.round(total * .25), 0]
    : [100, 75, 50, 25, 0];

  scale.innerHTML = values.map(value => `<span>${formatNumber(value)}</span>`).join("");
}

function updateStockoutTitle(totalItems) {
  const title = document.querySelector(".stockout-content h4");
  if (!title) return;
  title.textContent = totalItems ? `${formatNumber(totalItems)} ítems críticos detectados` : "Ítems críticos detectados";
}

function renderStockoutThermometer() {
  const items = normalizeStockoutItems();

  if (!items.length) {
    renderThermometerScale(0);
    updateStockoutTitle(0);
    renderEmptyStockout();
    return;
  }

  const totalAuditOrders = getThermometerTotalAuditOrders(items);
  const topAffectedOrders = Math.max(...items.map(item => item.affectedOrders), 1);
  const thermometerLevel = totalAuditOrders > 0 ? percent(topAffectedOrders, totalAuditOrders) : 0;

  renderThermometerScale(totalAuditOrders);
  updateStockoutTitle(items.length);
  el.stockoutThermometer.style.setProperty("--level", Math.min(Math.max(thermometerLevel, 0), 100));
  el.stockoutList.className = "stockout-list";

  el.stockoutList.innerHTML = items.map((item, index) => {
    const width = percent(item.affectedOrders || item.stockoutIndex || item.missingUnits, topAffectedOrders || 1);
    const ratio = item.affectedRatio || `${formatNumber(item.affectedOrders)}/${formatNumber(totalAuditOrders)} órdenes`;
    const details = [
      `Afectación: ${ratio}`,
      `Índice: ${formatPercent(item.stockoutIndex)}%`,
      `Faltantes: ${formatNumber(item.missingUnits)}`,
      `Requeridas: ${formatNumber(item.requiredUnits)}`,
      `Disponibles: ${formatNumber(item.availableUnits)}`,
      item.orderTypes ? `Tipos: ${item.orderTypes}` : ""
    ].filter(Boolean).join(" · ");

    return `
      <div class="stockout-row risk-${Math.min(index + 1, 3)}" title="${escapeHtml(details)}">
        <span class="rank">${index + 1}</span>
        <span class="stockout-name" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
        <div class="stockout-track">
          <div class="stockout-fill" style="width:${Math.max(Math.min(width, 100), 3)}%"></div>
        </div>
        <strong>${formatNumber(item.affectedOrders)} ord · ${formatPercent(item.stockoutIndex)}%</strong>
      </div>
    `;
  }).join("");
}


function flattenStockBreakSource(source, parent = {}) {
  if (!source) return [];

  if (Array.isArray(source)) {
    return source.flatMap(item => flattenStockBreakSource(item, parent));
  }

  if (typeof source !== "object") return [];

  const childLines = source.lines || source.items || source.products || source.skus || source.detail || source.details || source.detalle;

  if (Array.isArray(childLines)) {
    return childLines.flatMap(child => flattenStockBreakSource(child, { ...parent, ...source }));
  }

  return [{ ...parent, ...source }];
}

function normalizeStockBreakLinesFromThermometer(data = state.raw) {
  const items = getFirstArray(
    data?.inventoryThermometer?.topCriticalItems,
    data?.inventoryThermometer?.items,
    data?.inventoryThermometer?.criticalItems,
    data?.inventoryThermometer?.data
  );

  return items.map((item, index) => {
    const orderTypes = Array.isArray(item.orderTypes)
      ? item.orderTypes
      : String(item.orderTypes || "").split(/[;,|]/).map(value => value.trim()).filter(Boolean);
    const orderType = orderTypes[0] || "B2B";
    const normalizedType = normalizeSearchText(orderType);
    const segment = normalizedType.includes("b2c") ? "B2C" : "B2B";
    const affectedRatio = item.affectedRatio || `${formatNumber(item.affectedOrders || 0)}/${formatNumber(item.totalAuditOrders || data?.inventoryThermometer?.totalAuditOrders || 0)}`;

    return {
      id: `thermometer-${item.item || item.sku || index}`,
      order: affectedRatio ? `Resumen ${affectedRatio}` : "Resumen SKU",
      client: safeText(data?.source?.company || "Supply Audit"),
      orderType: orderType || segment,
      segment,
      sku: safeText(item.item || item.sku || item.itemCode || item.productCode || item.codigo || item.description),
      description: safeText(item.description || item.descripcion || "Resumen agregado por SKU"),
      requiredQty: toNumber(item.requiredUnits ?? item.requiredQty ?? 0),
      availableQty: toNumber(item.availableUnits ?? item.availableQty ?? 0),
      missingQty: toNumber(item.missingUnits ?? item.missingQty ?? 0),
      aggregated: true
    };
  }).filter(line => Number(line.missingQty || 0) > 0)
    .sort((a, b) => b.missingQty - a.missingQty || a.sku.localeCompare(b.sku, "es", { numeric: true }));
}

function normalizeStockBreakLines(data = state.raw) {
  const rawLines = getNestedStockBreakLines(data);

  if (!rawLines.length) {
    const fallbackLines = normalizeStockBreakLinesFromThermometer(data);
    state.stockBreakSourceMode = fallbackLines.length ? "thermometer" : "none";
    return fallbackLines;
  }

  state.stockBreakSourceMode = "lines";

  const normalizedLines = rawLines.map((line, index) => {
    const order = pickFirst(
      line.order,
      line.orderId,
      line.OrderId,
      line.orden,
      line.codigo_orden,
      getByKeyVariants(line, ["order", "orderId", "Order ID", "Orden"])
    );

    const client = pickFirst(
      line.client,
      line.customer,
      line.cliente,
      line.account,
      line.cuenta,
      getByKeyVariants(line, ["client", "customer", "cliente", "account", "cuenta"])
    );

    const orderType = pickFirst(
      line.orderType,
      line.order_type,
      line.OrderType,
      line["Order Type"],
      line.tipoOrden,
      line.tipo_orden,
      getByKeyVariants(line, ["orderType", "order_type", "Order Type", "tipoOrden", "tipo orden"])
    );

    const sku = pickFirst(
      line.sku,
      line.SKU,
      line.item,
      line.itemId,
      line.ItemId,
      line.productCode,
      line.codigo,
      getByKeyVariants(line, ["sku", "SKU", "item", "itemId", "Item ID", "productCode", "código", "codigo"])
    );

    const description = pickFirst(
      line.description,
      line.descripcion,
      line.productDescription,
      line.itemDescription,
      line.desc,
      getByKeyVariants(line, ["description", "descripción", "descripcion", "productDescription", "itemDescription"])
    );

    const requiredQty = toNumber(pickFirst(
      line.requiredQty,
      line.requestedQty,
      line.requiredQuantity,
      line.cantidadSolicitada,
      line.qtySolicitada,
      line.demanda,
      getByKeyVariants(line, ["requiredQty", "requestedQty", "required quantity", "cantidad solicitada", "qty solicitada"])
    ));

    const availableQty = toNumber(pickFirst(
      line.availableQty,
      line.availableQuantity,
      line.stockDisponible,
      line.availableUnits,
      line.stock,
      getByKeyVariants(line, ["availableQty", "available quantity", "stock disponible", "available units", "stock"])
    ));

    const explicitMissing = pickFirst(
      line.missingQty,
      line.missingQuantity,
      line.faltante,
      line.shortageQty,
      line.shortageUnits,
      line.unidadesFaltantes,
      getByKeyVariants(line, ["missingQty", "missing quantity", "faltante", "shortage", "unidades faltantes"])
    );
    const missingQty = explicitMissing !== "" ? toNumber(explicitMissing) : Math.max(requiredQty - availableQty, 0);
    const normalizedType = normalizeSearchText(orderType);
    const segment = !normalizedType ? "Sin tipo" : normalizedType.includes("b2c") ? "B2C" : "B2B";

    return {
      id: `${order || "order"}-${sku || "sku"}-${index}`,
      order: safeText(order),
      client: safeText(client),
      orderType: orderType || segment,
      segment,
      sku: safeText(sku),
      description: safeText(description),
      requiredQty,
      availableQty,
      missingQty
    };
  }).filter(line => Number(line.missingQty || 0) > 0);

  const deduped = new Map();

  normalizedLines.forEach(line => {
    const key = [
      normalizeSearchText(line.order),
      normalizeSearchText(line.sku),
      normalizeSearchText(line.orderType),
      Number(line.requiredQty || 0),
      Number(line.availableQty || 0),
      Number(line.missingQty || 0)
    ].join("|");

    if (!deduped.has(key)) {
      deduped.set(key, line);
    }
  });

  return [...deduped.values()]
    .sort((a, b) => b.missingQty - a.missingQty || a.order.localeCompare(b.order, "es", { numeric: true }));
}

function getStockBreakScope() {
  const segment = el.stockBreakTypeFilter?.value || "";
  const search = normalizeSearchText(el.stockBreakSearch?.value || "");

  return state.stockBreakLines.filter(line => {
    const matchesSegment = !segment || line.segment === segment;
    const matchesSearch = !search || [line.order, line.orderType, line.segment, line.sku, line.description]
      .some(value => normalizeSearchText(value).includes(search));

    return matchesSegment && matchesSearch;
  });
}

function renderStockBreaks() {
  if (!el.stockBreaksTable) return;

  const available = state.raw?.supplyAudit?.available !== false;
  state.stockBreakFiltered = available ? getStockBreakScope() : [];

  const lines = state.stockBreakFiltered;
  const affectedOrders = new Set(lines.map(line => line.order).filter(order => order && order !== "Sin información"));
  const missingUnits = lines.reduce((sum, line) => sum + Number(line.missingQty || 0), 0);
  const byType = lines.reduce((acc, line) => {
    acc[line.segment] = (acc[line.segment] || 0) + 1;
    return acc;
  }, {});
  const dominantType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  if (el.stockBreakLinesKpi) el.stockBreakLinesKpi.textContent = formatNumber(lines.length);
  if (el.stockBreakOrdersKpi) el.stockBreakOrdersKpi.textContent = formatNumber(affectedOrders.size);
  if (el.stockBreakMissingKpi) el.stockBreakMissingKpi.textContent = formatNumber(missingUnits);
  if (el.stockBreakDominantTypeKpi) el.stockBreakDominantTypeKpi.textContent = dominantType;
  if (el.stockBreaksCounter) el.stockBreaksCounter.textContent = `${formatNumber(lines.length)} líneas · ${formatNumber(affectedOrders.size)} órdenes`;
  if (el.stockBreaksMeta) {
    if (state.raw?.supplyAudit?.available === false) {
      el.stockBreaksMeta.textContent = "Auditoría de abastecimiento no disponible en la fuente operativa.";
    } else if (state.stockBreakSourceMode === "lines") {
      el.stockBreaksMeta.textContent = "Detalle real por orden y SKU; solo se muestran líneas con faltante mayor a cero.";
    } else if (state.stockBreakSourceMode === "thermometer") {
      el.stockBreaksMeta.textContent = "La fuente actual no trae líneas por orden; se muestra resumen agregado por SKU desde el termómetro operativo.";
    } else {
      el.stockBreaksMeta.textContent = "La fuente actual no trae detalle de quiebres por orden.";
    }
  }

  if (!lines.length) {
    el.stockBreaksTable.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">Sin quiebres de stock para mostrar</td>
      </tr>
    `;
    return;
  }

  el.stockBreaksTable.innerHTML = lines.map(line => `
    <tr>
      <td>${escapeHtml(line.order)}</td>
      <td><span class="segment-pill ${getSegmentClass(line.segment)}">${escapeHtml(line.segment)}</span></td>
      <td><strong>${escapeHtml(line.sku)}</strong></td>
      <td class="stock-break-description" title="${escapeHtml(line.description)}">${escapeHtml(line.description)}</td>
      <td>${formatNumber(line.requiredQty)}</td>
      <td>${formatNumber(line.availableQty)}</td>
      <td><span class="missing-pill">${formatNumber(line.missingQty)}</span></td>
    </tr>
  `).join("");
}

function exportStockBreaks() {
  const lines = state.stockBreakFiltered.length ? state.stockBreakFiltered : getStockBreakScope();

  if (!lines.length) {
    showToast("No hay quiebres para exportar.");
    return;
  }

  const headers = ["order", "orderType", "segment", "sku", "description", "requiredQty", "availableQty", "missingQty"];
  const rows = lines.map(line => headers.map(header => `"${String(line[header] ?? "").replaceAll('"', '""')}"`).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `lazarus_quiebres_stock_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function renderAnalytics() {
  renderCompliance();
  renderStockoutThermometer();
  renderStatusDistribution();
  renderStockBreaks();
}

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

    const matchesSearch = !search || [
      item.order,
      item.waybill,
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
      && (!date || item.lastEventDate === date);
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
    if (el.pageInfo) el.pageInfo.textContent = "Mostrando 0 envíos";
    el.ordersTable.innerHTML = '<tr><td colspan="6" class="table-empty">No hay registros que coincidan con los filtros</td></tr>';
    return;
  }

  const visibleRows = state.filtered;

  if (el.pageInfo) {
    el.pageInfo.textContent = `Mostrando ${formatNumber(visibleRows.length)} de ${formatNumber(state.shipments.length)} envíos · Scroll operativo`;
  }

  el.ordersTable.innerHTML = visibleRows.map(item => {
    const shipmentId = getShipmentId(item);
    const selected = state.selectedShipmentId === shipmentId ? "selected" : "";
    const rawStatus = getRawStatus(item);
    const rawCategory = getRawCategory(item);
    const orderSegment = getOrderSegment(item);
    const statusClass = getStatusClass(rawStatus);

    return `
      <tr class="${selected}" data-shipment-id="${escapeHtml(shipmentId)}">
        <td>${escapeHtml(item.order)}</td>
        <td>${escapeHtml(item.waybill)}</td>
        <td>${escapeHtml(item.lastEventDate)}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(rawStatus)}</span></td>
        <td><span class="segment-pill ${getSegmentClass(orderSegment)}">${escapeHtml(orderSegment)}</span></td>
        <td>${escapeHtml(rawCategory)}</td>
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

  const rawStatus = getRawStatus(item);
  const rawCategory = getRawCategory(item);
  const orderSegment = getOrderSegment(item);
  const statusClass = getStatusClass(rawStatus);
  const destination = pickFirst(item.destination, item.destino, item.city, item.comuna, item.region, item.address);
  const customer = pickFirst(item.customer, item.client, item.cliente, state.raw?.source?.company);
  const signedBy = getSignedByValue(item);
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
        <strong><em class="status-pill ${statusClass}">${escapeHtml(rawStatus)}</em></strong>
      </div>

      <div class="detail-row">
        <span>Categoría</span>
        <strong>${escapeHtml(rawCategory)}</strong>
      </div>

      <div class="detail-row">
        <span>Tipo orden</span>
        <strong><em class="segment-pill ${getSegmentClass(orderSegment)}">${escapeHtml(orderSegment)}</em></strong>
      </div>

      <div class="detail-row">
        <span>Último evento</span>
        <strong>${escapeHtml(pickFirst(item.lastEventLabel, rawStatus))}</strong>
      </div>

      <div class="detail-row">
        <span>Fecha evento</span>
        <strong>${escapeHtml(item.lastEventDate)}</strong>
      </div>

      <div class="detail-row">
        <span>Recibido por</span>
        <strong>${signedBy ? escapeHtml(signedBy) : ""}</strong>
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
  if (el.channelFilter) el.channelFilter.value = "";
  el.dateFilter.value = "";
  if (el.stockBreakSearch) el.stockBreakSearch.value = "";
  if (el.stockBreakTypeFilter) el.stockBreakTypeFilter.value = "";
  state.selectedShipmentId = null;

  applyFilters();
  renderStockBreaks();
  renderEmptyDetail();
}

function exportCsv() {
  if (!state.filtered.length) {
    showToast("No hay registros para exportar.");
    return;
  }

  const headers = ["order", "waybill", "lastEventDate", "status", "orderType", "segment", "category", "signedBy", "lastEventLabel", "lastEventDescription"];
  const rows = state.filtered.map(item => {
    const values = {
      order: item.order,
      waybill: item.waybill,
      lastEventDate: item.lastEventDate,
      status: getRawStatus(item),
      orderType: getOrderType(item),
      segment: getOrderSegment(item),
      category: getRawCategory(item),
      signedBy: getSignedByValue(item),
      lastEventLabel: item.lastEventLabel,
      lastEventDescription: item.lastEventDescription
    };

    return headers.map(header => `"${String(values[header] ?? "").replaceAll('"', '""')}"`).join(",");
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
  if (el.channelFilter) el.channelFilter.addEventListener("change", applyFilters);
  el.dateFilter.addEventListener("change", applyFilters);

  if (el.stockBreakSearch) el.stockBreakSearch.addEventListener("input", renderStockBreaks);
  if (el.stockBreakTypeFilter) el.stockBreakTypeFilter.addEventListener("change", renderStockBreaks);
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
