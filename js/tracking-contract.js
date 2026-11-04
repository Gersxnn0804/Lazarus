(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LazarusTracking = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const VERSIONS = ["1.2.0", "2.0.0"];
  const WAREHOUSE = ["Cancelled", "Released", "Allocated", "Packed", "Manifested", "Shipped"];
  const TRANSPORT = ["Recolección", "En tránsito", "En reparto", "Entregada"];
  const CATALOG = {
    "shipment delivered ok": "ENTREGADA", "shipment data received": "PENDIENTE DE RECOLECCION",
    "returned to shipper": "DEVOLUCION", "delivery arranged, no details expected": "TERCERIZADA",
    "shipment on hold": "EN RUTA", "partial delivery": "ENTREGA PARCIAL", "clearance delay cd": "EN ADUANA",
    "processed at dhl location": "EN RUTA", "departed facility": "EN RUTA", "scheduled to move": "PROGRAMADO",
    "arrived at delivery facility": "EN SUCURSAL DE DESTINO", "shipment picked up": "RECOLECTADO",
    "scheduled for delivery as agreed": "PROGRAMADO"
  };
  const CANONICAL = new Set([...Object.values(CATALOG), "EN REPARTO", "REINTENTO", "DIRECCION ERRONEA", "POR RECOGER",
    "ESPERA DE DATOS", "SIN CLASIFICAR", "INFORMACIÓN INSUFICIENTE", "EN ESPERA"]);
  const ALIASES = { ENTREGADO: "ENTREGADA", "EN PROCESO": "EN RUTA", TERCERIZADO: "TERCERIZADA", "PENDIENTE RECOLECCION": "PENDIENTE DE RECOLECCION" };
  const STAGES = { RECOLECTADO: "Recolección", "EN RUTA": "En tránsito", "EN SUCURSAL DE DESTINO": "En tránsito", "EN REPARTO": "En reparto", ENTREGADA: "Entregada" };
  const STATES = new Set(["current", "complete", "pending", "disabled", "unknown", "conflict"]);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" ? value : "";
  const clean = value => text(value).normalize("NFKC").trim();
  const key = value => clean(value).toLowerCase();
  const OPERATIONAL_ZONE = "America/Santiago";
  const operationalFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const dateKey = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  function operationalDateKey(value) {
    const date = parseDate(value);
    if (!date) return null;
    if (/(Z|[+-]\d{2}:\d{2})$/.test(clean(value))) {
      const parts = Object.fromEntries(operationalFormatter.formatToParts(date.timestamp).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
    // Dates without an offset are operational civil dates, never browser-local instants.
    return dateKey(date.year, date.month, date.day);
  }
  function buildPeriod(mode, values = {}) {
    const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && parseDate(value);
    let from, to;
    if (mode === "day") from = to = values.day;
    else if (mode === "month") {
      if (!/^\d{4}-\d{2}$/.test(values.month || "")) throw new RangeError("Selecciona un mes y año válidos.");
      from = `${values.month}-01`;
      const date = parseDate(from);
      if (!date) throw new RangeError("Selecciona un mes y año válidos.");
      to = dateKey(date.year, date.month, new Date(Date.UTC(date.year, date.month, 0)).getUTCDate());
    } else if (mode === "year") {
      if (!/^\d{4}$/.test(String(values.year || ""))) throw new RangeError("Selecciona un año válido (1900–9999).");
      from = `${values.year}-01-01`; to = `${values.year}-12-31`;
    } else if (mode === "calendar") { from = values.from; to = values.to; }
    else throw new RangeError("Período no compatible.");
    if (!validDay(from) || !validDay(to)) throw new RangeError("Completa las fechas con valores válidos (1900–9999).");
    if (from > to) throw new RangeError("DESDE no puede ser posterior a HASTA.");
    return { from, to };
  }
  const searchKey = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  function selectDashboardRows(rows, { period = null, search = "", status = "", category = "", channel = "", date = "" } = {}) {
    const query = searchKey(search);
    // The publication adapter resolves conflicting sources before temporal selection.
    const unique = [...new Map(rows.map(row => [row.order, row])).values()];
    let undated = 0, matching = 0;
    const selected = unique.filter(row => {
      const reference = operationalDateKey(row.lastEventDate);
      const displayDate = reference ? reference.split("-").reverse().join("-") : "Sin fecha";
      if ((status && row.status !== status) || (category && row.category !== category)
        || (channel && row.orderSegment !== channel) || (date && displayDate !== date)
        || (query && ![row.order, row.waybill, displayDate, row.status, row.category, row.signedBy,
          row.lastEventLabel, row.lastEventDescription].some(value => searchKey(value).includes(query)))) return false;
      matching++;
      if (!reference) undated++;
      return !period || Boolean(reference && reference >= period.from && reference <= period.to);
    });
    return { rows: selected, undated, matching };
  }
  function buildDeliveryDistribution(rows) {
    const delivered = rows.filter(row => row.deliveryConfirmed).length;
    return [{ label: "Entrega confirmada", value: delivered, color: "#34d399" },
      { label: "Sin entrega confirmada", value: rows.length - delivered, color: "#94a3b8" }];
  }
  function family(value) {
    const normalized = clean(value).toUpperCase();
    return normalized === "B2C" ? "B2C" : /^B2B[A-Z0-9]*$/.test(normalized) ? "B2B" : "Sin tipo";
  }
  function parseDate(value) {
    const raw = clean(value);
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(raw);
    if (!match) {
      const legacy = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
      if (!legacy) return null;
      match = [raw, legacy[3], legacy[2], legacy[1], legacy[4], legacy[5], legacy[6], undefined];
    }
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(v => Number(v || 0));
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
      || hour > 23 || minute > 59 || second > 59) return null;
    const timestamp = match[7] ? Date.parse(raw) : date.getTime();
    if (!Number.isFinite(timestamp)) return null;
    return { year, month, day, hour, minute, second, hasTime: match[4] !== undefined, timestamp };
  }
  function unknownFlow(keys) {
    return keys.map(key => ({ key, label: key, state: "unknown", evidence: "none" }));
  }
  function legacyFlow(keys, current) {
    const index = keys.indexOf(current);
    if (index < 0) return unknownFlow(keys);
    if (current === "Cancelled") return keys.map(key => ({ key, label: key, state: key === current ? "current" : "disabled", evidence: key === current ? "observed" : "none" }));
    return keys.map((key, i) => ({ key, label: key,
      state: key === "Cancelled" ? "disabled" : i === index ? "current" : i < index ? "complete" : "pending",
      evidence: i === index ? "observed" : i < index && key !== "Cancelled" ? "inferred" : "none" }));
  }
  function validFlow(flow, keys, current, own) {
    if (!Array.isArray(flow) || flow.length !== keys.length) return false;
    if (!flow.every((step, i) => record(step) && step.key === keys[i] && STATES.has(step.state)
      && (["none", "observed", "inferred"].includes(step.evidence)
        || (own && step.key === "Entregada" && step.state === "current" && step.evidence === "warehouse")))) return false;
    const active = flow.filter(step => step.state === "current");
    if (active.length > 1 || (active.length && active[0].key !== current)) return false;
    if (current && keys.includes(current) && !active.length && !flow.some(step => step.state === "conflict")) return false;
    return current !== "Cancelled" || (active[0]?.key === "Cancelled" && flow.slice(1).every(step => step.state === "disabled"));
  }
  function getFlow(raw, keys, current, legacy, own, warnings) {
    if (validFlow(raw, keys, current, own)) return raw.map(step => ({ key: step.key, label: step.key, state: step.state, evidence: step.evidence }));
    if (raw !== undefined) warnings.push("PROGRESS_INVALID");
    return legacy && raw === undefined ? legacyFlow(keys, current) : unknownFlow(keys);
  }
  function publicEvent(raw, policy) {
    if (!record(raw)) return null;
    const date = text(raw.date);
    if (date && !parseDate(date)) return null;
    return { date, status: CANONICAL.has(clean(raw.status)) ? clean(raw.status) : "SIN CLASIFICAR",
      stage: TRANSPORT.includes(raw.stage) ? raw.stage : "", description: text(raw.description),
      ...(policy.comments ? { originalStatus: text(raw.originalStatus), originalComment: text(raw.originalComment) } : {}) };
  }
  function normalizeRow(raw, legacy, policy, now) {
    if (!record(raw) || typeof raw.order !== "string" || !clean(raw.order)
      || (raw.waybill !== undefined && raw.waybill !== null && typeof raw.waybill !== "string")) return null;
    const warnings = [];
    if (raw.lastEventDate && !parseDate(raw.lastEventDate)) warnings.push("INVALID_EVENT_DATE");
    const order = clean(raw.order).toUpperCase();
    if (order.length > 128 || (!legacy && !/^LT\d+$/.test(order))) return null;
    const originalStatus = clean(raw.status);
    const sourceStatus = CATALOG[key(raw.shipmentState)] || "";
    // Canonical status is authoritative. Only legacy aliases use the catalog as fallback.
    let status = CANONICAL.has(originalStatus) || WAREHOUSE.includes(originalStatus) ? originalStatus : legacy ? sourceStatus || ALIASES[originalStatus] || originalStatus : "SIN CLASIFICAR";
    const warehouseStatus = WAREHOUSE.includes(raw.warehouseStatus) ? raw.warehouseStatus : WAREHOUSE.includes(status) ? status : "";
    if (!CANONICAL.has(status) && !WAREHOUSE.includes(status)) status = "SIN CLASIFICAR";
    const deliveryDateRaw = text(raw.deliveryDate) || (legacy && raw.deliveryConfirmed === undefined && sourceStatus === "ENTREGADA" ? text(raw.lastEventDate) : "");
    const deliveryDate = parseDate(deliveryDateRaw);
    let deliveryConfirmed = status === "ENTREGADA" && (raw.deliveryConfirmed === true || (legacy && raw.deliveryConfirmed === undefined && sourceStatus === "ENTREGADA"))
      && deliveryDate !== null && deliveryDate.timestamp <= now;
    const orderType = text(raw.orderType) || text(raw.order_type);
    const own = record(raw.transportHandover) && raw.transportHandover.confirmed === true && raw.transportHandover.mode === "own"
      && raw.transportHandover.source === "Warehouse" && clean(orderType) !== "" && clean(orderType).toUpperCase() !== "B2C" && warehouseStatus === "Shipped" && status === "ENTREGADA";
    if (status === "ENTREGADA" && !deliveryConfirmed && !own) {
      status = "INFORMACIÓN INSUFICIENTE";
      warnings.push("DELIVERY_NOT_CONFIRMED");
    }
    let transportStatus = TRANSPORT.includes(raw.transportStatus) ? raw.transportStatus : "";
    if (!transportStatus && legacy && key(raw.shipmentState) !== "shipment on hold") transportStatus = STAGES[status] || "";
    if (transportStatus === "Entregada" && !deliveryConfirmed && !own) transportStatus = "";
    if (deliveryConfirmed && (transportStatus !== "Entregada" || warehouseStatus === "Cancelled")) {
      deliveryConfirmed = false; status = "INFORMACIÓN INSUFICIENTE"; warnings.push("STATUS_PROGRESS_CONFLICT");
    }
    const warehouseFlow = getFlow(raw.warehouseFlow, WAREHOUSE, warehouseStatus, legacy, false, warnings);
    let transportFlow = getFlow(raw.transportFlow, TRANSPORT, transportStatus, legacy, own, warnings);
    if (!deliveryConfirmed && !own && transportFlow.some(step => step.key === "Entregada" && ["current", "complete"].includes(step.state))) {
      transportFlow = unknownFlow(TRANSPORT); warnings.push("DELIVERY_PROGRESS_CONFLICT");
    }
    if (own && legacy && raw.transportFlow === undefined) transportFlow = TRANSPORT.map(key => ({ key, label: key,
      state: key === "Entregada" ? "current" : "unknown", evidence: key === "Entregada" ? "warehouse" : "none" }));
    const events = Array.isArray(raw.events) ? raw.events.map(event => publicEvent(event, policy)).filter(Boolean) : [];
    const row = { order, waybill: clean(raw.waybill), orderType, orderSegment: family(orderType), status,
      category: (CANONICAL.has(originalStatus) || WAREHOUSE.includes(originalStatus) ? text(raw.category) : "") || (deliveryConfirmed ? "Finalizado" : "Sin categoría"), warehouseStatus, transportStatus,
      warehouseFlow, transportFlow, deliveryConfirmed, deliveryDate: deliveryConfirmed ? deliveryDateRaw : "",
      transportHandover: { confirmed: own, mode: own ? "own" : "", message: own ? "Entregada a transporte propio." : "" },
      lastEventDate: text(raw.lastEventDate), lastUpdatedAt: text(raw.lastUpdatedAt), shipmentState: text(raw.shipmentState),
      lastEventLabel: text(raw.lastEventLabel), lastEventDescription: text(raw.lastEventDescription),
      incidents: Array.isArray(raw.incidents) ? [...new Set(raw.incidents.filter(value => typeof value === "string"))] : [],
      events, warnings, signedByAvailable: policy.signedBy, commentsAvailable: policy.comments,
      signedBy: policy.signedBy ? (typeof raw.signedByRaw === "string" ? raw.signedByRaw : text(raw.signedBy)) : "",
      originalStatus: policy.comments ? text(raw.originalStatus) : "", originalComment: policy.comments ? text(raw.originalComment) : "" };
    if (legacy && typeof raw.signedByRaw !== "string" && ["entregado", "no firma", "sin información", "n/a"].includes(key(row.signedBy))) row.signedBy = "";
    // A legacy publication contains only its last reported event, never a reconstructed timeline.
    if (legacy && !events.length && (row.shipmentState || row.lastEventDescription)) {
      row.events = [{ date: parseDate(row.lastEventDate) ? row.lastEventDate : "", status, stage: transportStatus,
        description: row.shipmentState || row.lastEventDescription, ...(policy.comments ? { originalStatus: row.originalStatus, originalComment: row.originalComment } : {}) }];
    }
    return row;
  }
  function mergeDuplicates(rows) {
    const unique = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
    if (unique.length === 1) return unique[0];
    const values = field => [...new Set(unique.map(row => row[field]).filter(Boolean))];
    const waybills = values("waybill"), warehouse = values("warehouseStatus");
    const transports = unique.filter(row => row.shipmentState || row.transportStatus || row.events.length);
    const transportVariants = new Set(transports.map(row => JSON.stringify([row.status, row.transportStatus, row.lastEventDate, row.deliveryDate, row.shipmentState])));
    if (waybills.length <= 1 && warehouse.length <= 1 && transportVariants.size <= 1 && values("orderType").length <= 1) {
      const base = transports[0] || unique[0];
      const wh = unique.find(row => row.warehouseStatus) || base;
      return { ...base, waybill: waybills[0] || "", orderType: values("orderType")[0] || "", orderSegment: family(values("orderType")[0]),
        warehouseStatus: wh.warehouseStatus, warehouseFlow: wh.warehouseFlow };
    }
    const base = unique[0];
    return { ...base, waybill: waybills.length === 1 ? waybills[0] : "", status: "INFORMACIÓN INSUFICIENTE",
      deliveryConfirmed: false, deliveryDate: "", warehouseStatus: "", transportStatus: "",
      warehouseFlow: unknownFlow(WAREHOUSE), transportFlow: unknownFlow(TRANSPORT),
      transportHandover: { confirmed: false, mode: "", message: "" }, events: [],
      signedBy: "", originalStatus: "", originalComment: "",
      warnings: [...new Set([...unique.flatMap(row => row.warnings), "DUPLICATE_ORDER_CONFLICT"])] };
  }
  function normalizePayload(input, options = {}) {
    if (!record(input) || !VERSIONS.includes(input.schemaVersion) || !Array.isArray(input.shipments)) {
      throw new Error("Contrato de Tracking no compatible o estructura JSON inválida.");
    }
    const legacy = input.schemaVersion === "1.2.0";
    const policy = { signedBy: legacy ? input.publicationPolicy?.signedBy !== false : input.publicationPolicy?.signedBy === true,
      comments: legacy ? input.publicationPolicy?.comments !== false : input.publicationPolicy?.comments === true };
    const groups = new Map(), rejected = [];
    input.shipments.forEach((raw, index) => {
      const row = normalizeRow(raw, legacy, policy, options.now ?? Date.now());
      if (!row) { rejected.push({ index, reason: "INVALID_ORDER_OR_IDENTIFIER" }); return; }
      if (!groups.has(row.order)) groups.set(row.order, []);
      groups.get(row.order).push(row);
    });
    if (input.shipments.length && !groups.size) throw new Error("La publicación no contiene órdenes válidas.");
    const shipments = [...groups.values()].map(mergeDuplicates);
    const generated = parseDate(input.generatedAt);
    const now = options.now ?? Date.now();
    return { schemaVersion: input.schemaVersion, generatedAt: text(input.generatedAt), shipments,
      summary: buildSummary(shipments), diagnostics: { rejected, duplicates: input.shipments.length - rejected.length - shipments.length,
        warnings: shipments.filter(row => row.warnings.length).length },
      freshness: !generated || generated.timestamp > now + 300000 ? "unknown" : now - generated.timestamp > 6 * 3600000 ? "stale" : "current" };
  }
  function buildSummary(rows) {
    const count = predicate => rows.filter(predicate).length;
    const transportAvailable = rows.some(row => row.shipmentState || row.transportStatus || row.events.length);
    const warehouseAvailable = rows.some(row => row.warehouseStatus);
    const unknown = row => row.status === "SIN CLASIFICAR" || row.status === "INFORMACIÓN INSUFICIENTE" || row.warnings.length > 0;
    const delivered = count(row => row.deliveryConfirmed);
    const cancelled = count(row => row.warehouseStatus === "Cancelled");
    return { totalShipments: rows.length, delivered: transportAvailable || !rows.length ? delivered : null,
      active: count(row => !row.deliveryConfirmed && row.warehouseStatus !== "Cancelled" && !row.transportHandover.confirmed && row.status !== "DEVOLUCION"),
      warehouseOrders: warehouseAvailable || !rows.length ? count(row => Boolean(row.warehouseStatus)) : null,
      shipped: warehouseAvailable || !rows.length ? count(row => row.warehouseStatus === "Shipped") : null,
      pendingCollection: transportAvailable || !rows.length ? count(row => row.status === "PENDIENTE DE RECOLECCION") : null,
      inTransit: transportAvailable || !rows.length ? count(row => row.transportStatus === "En tránsito") : null,
      outForDelivery: transportAvailable || !rows.length ? count(row => row.transportStatus === "En reparto") : null,
      incidents: count(row => row.incidents.length > 0 || row.warnings.length > 0), returns: transportAvailable || !rows.length ? count(row => row.status === "DEVOLUCION") : null,
      insufficient: count(unknown), ownTransport: count(row => row.transportHandover.confirmed),
      cancelled, thirdParty: transportAvailable || !rows.length ? count(row => row.status === "TERCERIZADA") : null };
  }
  function buildTemporalSeries(rows, granularity = "day") {
    if (!Array.isArray(rows)) throw new TypeError("La serie temporal requiere una lista de órdenes.");
    if (!["day", "month", "year"].includes(granularity)) throw new RangeError("Granularidad temporal no compatible.");

    const groups = new Map();
    let undated = 0;

    rows.forEach(row => {
      const reference = operationalDateKey(row?.lastEventDate);
      if (!reference) { undated++; return; }
      const date = parseDate(reference);

      const month = String(date.month).padStart(2, "0");
      const day = String(date.day).padStart(2, "0");
      const key = granularity === "day" ? `${date.year}-${month}-${day}`
        : granularity === "month" ? `${date.year}-${month}` : String(date.year);
      const label = granularity === "day" ? `${day}-${month}-${date.year}`
        : granularity === "month" ? `${month}-${date.year}` : String(date.year);
      const current = groups.get(key) || { key, label, total: 0, delivered: 0 };
      current.total++;
      if (row.deliveryConfirmed === true) current.delivered++;
      groups.set(key, current);
    });

    const points = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
    return { granularity, points, dated: points.reduce((total, point) => total + point.total, 0), undated };
  }
  function csv(rows) {
    const columns = ["order", "waybill", "orderType", "status", "warehouseStatus", "transportStatus", "lastEventDate", "deliveryDate", "signedBy", "originalStatus", "originalComment"];
    const cell = value => {
      let raw = text(value);
      if (/^[\s]*[=+@-]/.test(raw) || /^[\s]*\d{10,}$/.test(raw) || /^0\d+$/.test(raw)) raw = "'" + raw;
      return '"' + raw.replaceAll('"', '""') + '"';
    };
    return "\ufeff" + [columns.join(","), ...rows.map(row => columns.map(column => cell(row[column])).join(","))].join("\r\n");
  }
  return { VERSIONS, WAREHOUSE, TRANSPORT, CATALOG, OPERATIONAL_ZONE, operationalDateKey, buildPeriod,
    selectDashboardRows, buildDeliveryDistribution, parseDate, family, normalizePayload, buildSummary, buildTemporalSeries, csv };
});
