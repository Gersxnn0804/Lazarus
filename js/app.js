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
  shipments: [],
  filtered: [],
  selectedOrder: null,
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
  statusBars: $("statusBars"),
  categoryList: $("categoryList"),
  dateBars: $("dateBars"),
  donutChart: $("donutChart"),
  kpiTotal: $("kpiTotal"),
  kpiDelivered: $("kpiDelivered"),
  kpiDeliveredRate: $("kpiDeliveredRate"),
  kpiTransit: $("kpiTransit"),
  kpiPending: $("kpiPending"),
  kpiCritical: $("kpiCritical"),
  kpiReturns: $("kpiReturns"),
  kpiGenerated: $("kpiGenerated"),
  lastGenerated: $("lastGenerated"),
  lastRead: $("lastRead"),
  autoRefreshStatus: $("autoRefreshStatus"),
  toast: $("toast")
};

function formatNumber(value) {
  return new Intl.NumberFormat("es-CL").format(Number(value || 0));
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
  showToast.timer = window.setTimeout(() => el.toast.classList.add("hidden"), 3200);
}

function setAuthenticatedView(isAuthenticated) {
  el.loginScreen.classList.toggle("hidden", isAuthenticated);
  el.appShell.classList.toggle("hidden", !isAuthenticated);
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

function resetDashboard(message = "No se encontró información disponible.") {
  state.raw = null;
  state.shipments = [];
  state.filtered = [];
  state.selectedOrder = null;
  state.page = 1;

  el.sourceStatus.textContent = "Sin datos";
  el.sourceMeta.textContent = message;
  el.emptyState.classList.remove("hidden");

  el.kpiTotal.textContent = "0";
  el.kpiDelivered.textContent = "0";
  el.kpiDeliveredRate.textContent = "0%";
  el.kpiTransit.textContent = "0";
  el.kpiPending.textContent = "0";
  el.kpiCritical.textContent = "0";
  el.kpiReturns.textContent = "0";
  el.kpiGenerated.textContent = "Sin fecha";
  el.lastGenerated.textContent = "Sin fecha";
  el.lastRead.textContent = "Sin lectura";

  el.statusBars.className = "bar-chart empty-chart";
  el.statusBars.innerHTML = "";
  el.categoryList.className = "category-list empty-chart";
  el.categoryList.innerHTML = "";
  el.dateBars.className = "bar-chart empty-chart";
  el.dateBars.innerHTML = "";

  el.donutChart.className = "donut empty-donut";
  el.donutChart.style.setProperty("--value", 0);
  el.donutChart.innerHTML = "<span>0%</span>";

  clearFilterOptions();
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
        return { data: await response.json(), path };
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
    state.selectedOrder = null;
    state.page = 1;

    el.emptyState.classList.add("hidden");
    el.sourceStatus.textContent = "Datos cargados";
    el.sourceMeta.textContent = `${formatNumber(state.shipments.length)} registros · ${result.path.split("?")[0]}`;
    el.lastGenerated.textContent = formatDateTime(data.generatedAt);
    el.lastRead.textContent = formatDateTime(new Date().toISOString());

    renderFilters();
    applyFilters();
    renderSummary();
    renderCharts();
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

function renderSummary() {
  const total = getSummaryValue("totalShipments") || state.shipments.length;
  const delivered = getSummaryValue("delivered") || state.shipments.filter(x => String(x.status || "").toUpperCase().includes("ENTREGADO")).length;
  const inTransit = getSummaryValue("inTransit");
  const scheduled = getSummaryValue("scheduled");
  const retry = getSummaryValue("retry");
  const critical = getSummaryValue("critical");
  const returns = getSummaryValue("returns");
  const deliveredRate = percent(delivered, total);

  el.kpiTotal.textContent = formatNumber(total);
  el.kpiDelivered.textContent = formatNumber(delivered);
  el.kpiDeliveredRate.textContent = `${deliveredRate}% del total`;
  el.kpiTransit.textContent = formatNumber(inTransit);
  el.kpiPending.textContent = formatNumber(scheduled + retry);
  el.kpiCritical.textContent = formatNumber(critical);
  el.kpiReturns.textContent = formatNumber(returns);
  el.kpiGenerated.textContent = state.raw?.generatedAt ? `Generado: ${formatDateTime(state.raw.generatedAt)}` : "Sin fecha";

  el.donutChart.className = "donut";
  el.donutChart.style.setProperty("--value", deliveredRate);
  el.donutChart.innerHTML = `<span>${deliveredRate}%</span>`;
}

function renderBars(container, items, total) {
  const filteredItems = items.filter(([, value]) => Number(value) > 0);

  container.className = "bar-chart";
  container.innerHTML = filteredItems.length
    ? filteredItems.map(([label, value]) => {
        const width = Math.max(percent(value, total), 1);
        return `
          <div class="bar-row">
            <div class="bar-label">${escapeHtml(label)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
            <div class="bar-value">${formatNumber(value)}</div>
          </div>
        `;
      }).join("")
    : "";

  if (!filteredItems.length) container.className = "bar-chart empty-chart";
}

function renderCharts() {
  const total = getSummaryValue("totalShipments") || state.shipments.length;

  renderBars(el.statusBars, [
    ["Entregados", getSummaryValue("delivered")],
    ["En tránsito", getSummaryValue("inTransit")],
    ["Programados", getSummaryValue("scheduled")],
    ["Reintentos", getSummaryValue("retry")],
    ["Dirección incorrecta", getSummaryValue("wrongAddress")],
    ["Devoluciones", getSummaryValue("returns")],
    ["Incidencias", getSummaryValue("incidents")],
    ["Críticos", getSummaryValue("critical")]
  ], total);

  const categoryCounts = Object.entries(countBy(state.shipments, "category")).sort((a, b) => b[1] - a[1]);
  el.categoryList.className = "category-list";
  el.categoryList.innerHTML = categoryCounts.length
    ? categoryCounts.map(([category, value]) => `
        <div class="category-item">
          <span>${escapeHtml(category)}</span>
          <strong>${formatNumber(value)}</strong>
        </div>
      `).join("")
    : "";
  if (!categoryCounts.length) el.categoryList.className = "category-list empty-chart";

  const dateCounts = Object.entries(countBy(state.shipments, "lastEventDate"))
    .filter(([date]) => date !== "Sin información")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxDateValue = Math.max(...dateCounts.map(([, value]) => value), 0);
  renderBars(el.dateBars, dateCounts, maxDateValue || 1);
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
      item.lastEventDescription
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

  el.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  el.prevPageBtn.disabled = state.page <= 1;
  el.nextPageBtn.disabled = state.page >= totalPages;

  el.ordersTable.innerHTML = visibleRows.map(item => {
    const selected = state.selectedOrder === item.order ? "selected" : "";
    return `
      <tr class="${selected}" data-order="${escapeHtml(item.order)}">
        <td>${escapeHtml(item.order)}</td>
        <td>${escapeHtml(item.waybill)}</td>
        <td>${escapeHtml(item.lastEventDate)}</td>
        <td><span class="status-pill">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.category)}</td>
      </tr>
    `;
  }).join("");
}

function renderDetail(orderId) {
  const item = state.shipments.find(row => String(row.order) === String(orderId));
  if (!item) {
    renderEmptyDetail();
    return;
  }

  state.selectedOrder = item.order;
  renderTable();

  el.orderDetail.className = "detail-card";
  el.orderDetail.innerHTML = `
    <div class="detail-title">
      <span>Orden seleccionada</span>
      <strong>${escapeHtml(item.order)}</strong>
    </div>

    <div class="detail-grid">
      <div class="detail-field"><span>Waybill</span><strong>${escapeHtml(item.waybill)}</strong></div>
      <div class="detail-field"><span>Fecha último evento</span><strong>${escapeHtml(item.lastEventDate)}</strong></div>
      <div class="detail-field"><span>Estado</span><strong>${escapeHtml(item.status)}</strong></div>
      <div class="detail-field"><span>Categoría</span><strong>${escapeHtml(item.category)}</strong></div>
      <div class="detail-field"><span>Etiqueta</span><strong>${escapeHtml(item.lastEventLabel)}</strong></div>
      <div class="detail-field"><span>Origen dato</span><strong>${escapeHtml(state.raw?.source?.company || "Lazarus")}</strong></div>
    </div>

    <div class="detail-description">
      <strong>Descripción:</strong><br />
      ${escapeHtml(item.lastEventDescription)}
    </div>
  `;
}

function clearFilters() {
  el.searchInput.value = "";
  el.statusFilter.value = "";
  el.categoryFilter.value = "";
  el.dateFilter.value = "";
  state.selectedOrder = null;
  applyFilters();
  renderEmptyDetail();
}

function exportCsv() {
  if (!state.filtered.length) {
    showToast("No hay registros para exportar.");
    return;
  }

  const headers = ["order", "waybill", "lastEventDate", "status", "category", "lastEventLabel", "lastEventDescription"];
  const rows = state.filtered.map(item => headers.map(header => `"${String(item[header] ?? "").replaceAll('"', '""')}"`).join(","));
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
    const row = event.target.closest("tr[data-order]");
    if (row) renderDetail(row.dataset.order);
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
  el.autoRefreshStatus.textContent = "Activo · 60s";
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
