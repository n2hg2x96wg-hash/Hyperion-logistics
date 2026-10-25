// Admin Control Center. All shipment data flows through the authenticated /api/admin endpoint; the browser never
// writes shipments, events, locations or audit entries to the database directly.
import { STATUS_META, STATUS_CODES, EXCEPTION_TYPES, VISIBILITY_KEYS, DEFAULT_VISIBILITY, statusTone, timeAgo, locationFreshness, LOCATION_STATE_LABELS } from "../shared/status.js";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso) => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(+d) ? "—" : d.toLocaleString(); };
const VIEWS = ["dashboard", "create", "shipments", "globe", "tracking", "events", "preview", "audit", "couriers", "clients", "settings"];
const TITLES = { dashboard: "Overview", create: "Create Shipment", shipments: "Shipments", globe: "Global Tracking", tracking: "Live Tracking", events: "Tracking Events", preview: "Client View", audit: "Activity Logs", couriers: "Carriers", clients: "Clients", settings: "Settings & Backup" };
const WORKSPACE_VIEWS = ["tracking", "events", "preview"];
const VIS_LABELS = {
  map: ["Show live map", "Interactive map with route"], location: ["Show current location", "Location name, marker and position source"],
  timeline: ["Show timeline", "Automatic status milestones"], eta: ["Show ETA", "Estimated delivery date / window"],
  carrier: ["Show carrier", "Courier name and contact details"], package: ["Show package information", "Description, weight, dimensions"],
  progress: ["Show delivery progress", "Progress bar based on status"], notes: ["Show shipment notes", "Client-facing notes only"],
  events: ["Show tracking events", "Events added manually by operations"], fee: ["Show shipping fee", "Fee as entered on the shipment"]
};

const pill = (code, label) => `<span class="pill ${statusTone(code)}">${esc(label || STATUS_META[code]?.label || "Unknown")}</span>`;
const statusOptions = (selected, { blank } = {}) => (blank ? `<option value="">${esc(blank)}</option>` : "") +
  STATUS_CODES.map((c) => `<option value="${c}" ${c === selected ? "selected" : ""}>${esc(STATUS_META[c].label)}</option>`).join("");
const nv = (id) => $(id).value.trim();
const numOrUndef = (id) => { const v = nv(id); return v === "" ? undefined : v; };

/**
 * Client-side coordinate check (the server re-validates everything). Marks fields invalid and writes the message
 * into `errId`. Returns { ok, lat, lng } with lat/lng = null when both are blank.
 */
function checkCoords(latId, lngId, errId, { required = false } = {}) {
  const la = $(latId); const lo = $(lngId); const err = $(errId);
  const raw = [la.value.trim(), lo.value.trim()];
  let msg = "";
  const n = raw.map((v) => (v === "" ? null : Number(v.replace(",", "."))));
  if (raw[0] === "" && raw[1] === "") { if (required) msg = "Enter latitude and longitude."; }
  else if (raw[0] === "" || raw[1] === "") msg = "Enter both latitude and longitude, or leave both empty.";
  else if (!Number.isFinite(n[0]) || Math.abs(n[0]) > 90) msg = "Latitude must be a number between -90 and 90.";
  else if (!Number.isFinite(n[1]) || Math.abs(n[1]) > 180) msg = "Longitude must be a number between -180 and 180.";
  else if (n[0] === 0 && n[1] === 0) msg = "0, 0 is not a real shipment position — check the coordinates.";
  la.setAttribute("aria-invalid", msg ? "true" : "false"); lo.setAttribute("aria-invalid", msg ? "true" : "false");
  if (err) err.textContent = msg;
  return msg ? { ok: false } : { ok: true, lat: raw[0] === "" ? null : n[0], lng: raw[1] === "" ? null : n[1] };
}

/** Pasting "25.2048, 55.2708" (or "25.2048 55.2708") into a latitude field fills both fields. */
function enablePairPaste(latId, lngId) {
  $(latId)?.addEventListener("paste", (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
    const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return;
    e.preventDefault(); $(latId).value = m[1]; $(lngId).value = m[2];
    $(lngId).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const pad2 = (n) => String(n).padStart(2, "0");
const nowLocalInput = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export function initControlCenter(host) {
  const state = { view: "dashboard", perms: [], role: null, sel: null, list: { cursor: null, rows: [] }, previewTracker: null, adminMap: null, busy: new Set(), settings: null };

  // ---------- API ----------
  async function api(action, body = {}) {
    let res;
    try {
      res = await fetch("/api/admin", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
    } catch { throw Object.assign(new Error("Network error. Check your connection."), { code: "network" }); }
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && action !== "login") { showLogin("Your session expired. Please sign in again."); throw Object.assign(new Error("unauthenticated"), { code: "unauthenticated", silent: true }); }
    if (!res.ok) throw Object.assign(new Error(json.message || "The request failed."), { code: json.error, status: res.status, field: json.field });
    return json;
  }
  const fail = (err) => { if (!err.silent) host.showToast(err.message || "Something went wrong", "error"); };
  /** Runs fn once at a time per key (prevents double submits) and toggles a button. */
  async function guarded(key, btn, fn) {
    if (state.busy.has(key)) return;
    state.busy.add(key); if (btn) btn.disabled = true;
    try { return await fn(); } catch (err) { fail(err); } finally { state.busy.delete(key); if (btn) btn.disabled = false; }
  }

  // ---------- auth ----------
  function showLogin(message = "") {
    $("loginOverlay").classList.remove("hidden"); $("appRoot").classList.add("hidden");
    $("loginErr").textContent = message; $("loginPassword").value = ""; setTimeout(() => $("loginPassword").focus(), 50);
  }
  async function enterApp(me) {
    state.perms = me.permissions || []; state.role = me.role;
    $("whoami").textContent = `${me.sub} (${me.role})`;
    $("loginOverlay").classList.add("hidden"); $("appRoot").classList.remove("hidden");
    await host.afterLogin?.();
    populateStaticSelects();
    document.querySelectorAll('[data-needs="clients"]').forEach((el) => { el.hidden = !can("clients"); });
    fillCustomerSelect("customerId", "").catch(() => {});
    switchView(state.view);
    startKeepAlive();
  }
  let keepAlive = null;
  function startKeepAlive() {
    clearInterval(keepAlive);
    let lastActive = Date.now();
    ["click", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, () => { lastActive = Date.now(); }, { passive: true }));
    keepAlive = setInterval(() => { if (Date.now() - lastActive < 10 * 60 * 1000) api("me").catch(() => {}); }, 5 * 60 * 1000);
  }
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await guarded("login", $("loginBtn"), async () => {
      $("loginErr").textContent = "";
      try { await api("login", { password: $("loginPassword").value }); }
      catch (err) { $("loginErr").textContent = err.code === "network" ? err.message : (err.message || "Access denied."); return; }
      await enterApp(await api("me"));
    });
  });
  window.logout = async () => { try { await api("logout"); } catch { /* ignore */ } clearInterval(keepAlive); state.sel = null; showLogin(""); };
  window.goHome = () => { window.location.href = "index.html"; };
  const can = (p) => state.perms.includes(p);

  // ---------- navigation ----------
  function switchView(view) {
    if (!VIEWS.includes(view)) view = "dashboard";
    state.view = view;
    for (const v of VIEWS) { $(`view-${v}`)?.classList.toggle("active", v === view); $(`btn-${v}`)?.classList.toggle("active", v === view); }
    $("breadcrumb-view").textContent = TITLES[view];
    $("workspaceBar").classList.toggle("hidden", !WORKSPACE_VIEWS.includes(view));
    host.onViewShown?.(view);
    if (view === "dashboard") loadDashboard();
    if (view === "shipments" && !state.list.rows.length) runSearch(true);
    if (view === "audit") loadAudit();
    if (view === "settings") loadSettings();
    if (view === "globe") loadGlobal();
    if (WORKSPACE_VIEWS.includes(view)) renderWorkspace();
    $("consoleNav")?.classList.remove("open"); $("consoleMenu")?.setAttribute("aria-expanded", "false");
    document.querySelectorAll("#tabBar [data-tab]").forEach((b) => {
      const on = b.dataset.tab === view || (b.dataset.tab === "tracking" && WORKSPACE_VIEWS.includes(view));
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
      if (b.dataset.tab === "more") b.setAttribute("aria-expanded", "false");
    });
  }
  $("tabBar")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    if (b.dataset.tab !== "more") { switchView(b.dataset.tab); window.scrollTo({ top: 0 }); return; }
    const open = $("consoleNav").classList.toggle("open");
    b.setAttribute("aria-expanded", String(open)); $("consoleMenu")?.setAttribute("aria-expanded", String(open));
    if (open) window.scrollTo({ top: 0 });
  });

  // ---------- in-page confirmation (replaces window.confirm for archive / delete) ----------
  function confirmDialog({ title, body, ok, typed }) {
    const m = $("confirmModal");
    $("confirmTitle").textContent = title; $("confirmBody").textContent = body; $("confirmOk").textContent = ok;
    $("confirmTypeWrap").classList.toggle("hidden", !typed); $("confirmType").value = "";
    if (typed) $("confirmTypeLabel").textContent = `Type ${typed} to confirm`;
    $("confirmOk").disabled = !!typed;
    m.classList.add("show");
    (typed ? $("confirmType") : $("confirmCancel")).focus();
    return new Promise((resolve) => {
      const done = (v) => { m.classList.remove("show"); $("confirmOk").onclick = $("confirmCancel").onclick = $("confirmType").oninput = m.onkeydown = null; resolve(v); };
      $("confirmType").oninput = () => { $("confirmOk").disabled = $("confirmType").value.trim().toUpperCase() !== typed; };
      $("confirmOk").onclick = () => done(true); $("confirmCancel").onclick = () => done(false);
      m.onkeydown = (e) => { if (e.key === "Escape") done(false); };
    });
  }
  $("consoleMenu")?.addEventListener("click", () => {
    const open = $("consoleNav").classList.toggle("open"); $("consoleMenu").setAttribute("aria-expanded", String(open));
  });

  // ---------- global tracking workspace: list · map · details (admin data, unmasked) ----------
  // The map is the same globe/flat-map component as the homepage. Filtering happens on the loaded data, so
  // changing a filter never re-queries the database; Refresh and the 60s poll fetch fresh data.
  const SOURCE_LABEL = { admin: "Manual entry by Hyperion operations", system: "System", carrier_api: "Carrier API (signed update)", gps: "GPS telemetry" };
  const ops = { data: null, useCache: false, selected: null, detailToken: 0 };
  let globalCenter = null;
  const countryName = (iso) => { try { return iso ? new Intl.DisplayNames(["en"], { type: "region" }).of(iso) : ""; } catch { return iso || ""; } };
  function opsFiltered() {
    const rows = ops.data?.routes || [];
    const q = $("opsSearch").value.trim().toLowerCase();
    const status = $("globeFilter").value; const carrier = $("opsCarrier").value; const country = $("opsCountry").value;
    const pub = $("globePublicOnly").checked; const pos = $("opsHasPosition").checked;
    return rows.filter((r) => (!status || r.status.code === status) && (!carrier || r.courier === carrier) && (!pub || r.publicMap) && (!pos || r.current) &&
      (!country || [r.originCountry, r.destinationCountry, r.currentCountry].includes(country)) &&
      (!q || [r.ref, r.originLabel, r.destinationLabel, r.current?.place, r.courier].some((v) => String(v || "").toLowerCase().includes(q))));
  }
  function fillOpsSelects() {
    const rows = ops.data?.routes || [];
    const keep = (id, opts, blank) => { const el = $(id); const v = el.value; el.innerHTML = `<option value="">${blank}</option>` + opts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join(""); if ([...el.options].some((o) => o.value === v)) el.value = v; };
    keep("opsCarrier", [...new Set(rows.map((r) => r.courier).filter(Boolean))].sort().map((c) => [c, c]), "All carriers");
    keep("opsCountry", [...new Set(rows.flatMap((r) => [r.originCountry, r.destinationCountry, r.currentCountry]).filter(Boolean))]
      .map((c) => [c, countryName(c)]).sort((x, y) => x[1].localeCompare(y[1])), "All countries");
  }
  function renderOpsList(routes) {
    $("opsCount").textContent = `${routes.length} of ${ops.data?.routes?.length || 0} shipments`;
    $("opsList").innerHTML = routes.length ? routes.map((r) => `<li><button type="button" class="ops-row ${r.key === ops.selected ? "is-selected" : ""}" data-ops="${esc(r.key)}">
        <span class="ops-row-top"><strong>${esc(r.ref)}</strong>${pill(r.status.code, r.status.label)}</span>
        <span class="ops-row-route">${esc(r.originLabel || "Origin not set")} → ${esc(r.destinationLabel || "Destination not set")}</span>
        <span class="ops-row-meta">${esc(r.courier || "No carrier")}${r.publicMap ? " · on homepage" : ""} · ${r.current ? `position ${esc(timeAgo(r.current.recordedAt) || "time not recorded")}` : "no recorded position"}</span>
      </button></li>`).join("") : `<li class="ops-none">No shipments match these filters.</li>`;
  }
  async function renderOpsDetail(key) {
    const el = $("opsDetail"); const token = ++ops.detailToken;
    $("view-globe").querySelector(".ops-grid").dataset.pane = key ? "detail" : "list";
    if (!key) { el.innerHTML = `<div class="ops-empty"><strong>Select a shipment</strong><span>Pick a row or a route on the map to see its status, last recorded position and timeline.</span></div>`; return; }
    el.innerHTML = `<div class="ops-empty"><span>Loading ${esc(key)}…</span></div>`;
    let full;
    try { full = await api("get", { code: key }); } catch (err) { if (token === ops.detailToken) el.innerHTML = `<div class="ops-empty"><strong>Could not load ${esc(key)}</strong><span>${esc(err.message)}</span></div>`; return; }
    if (token !== ops.detailToken) return;
    const s = full.shipment; const r = ops.data?.routes?.find((x) => x.key === key);
    const hasPos = typeof s.latitude === "number" && typeof s.longitude === "number" && !(s.latitude === 0 && s.longitude === 0);
    const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const events = (full.events || []).slice().sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))).slice(0, 30);
    el.innerHTML = `
      <div class="ops-detail-head">
        <button type="button" class="ops-back" data-ops-back aria-label="Back to the list">←</button>
        <div><div class="ops-code">${esc(s.id)}</div>${pill(s.statusCode)}</div>
      </div>
      <dl class="ops-facts">
        ${row("Route", `${esc(s.origin || "—")} → ${esc(s.destination || "—")}`)}
        ${row("Carrier", esc(s.courier || "—"))}
        ${row("Last recorded position", hasPos ? `${esc(s.location || `${s.latitude}, ${s.longitude}`)}<small>${s.locationUpdatedAt ? esc(fmt(s.locationUpdatedAt)) : "Time not recorded"} · ${esc(SOURCE_LABEL[s.locationSource || "admin"] || s.locationSource)}</small>` : `<span class="muted">No position recorded yet</span>`)}
        ${row("Homepage", r?.publicMap ? "Shown (masked, city level)" : "Not shown")}
        ${row("Last change", esc(fmt(s.updatedAt || s.createdAt)))}
      </dl>
      <div class="ops-actions">
        <button type="button" class="ops-btn primary" data-ops-open="tracking">Update location</button>
        <button type="button" class="ops-btn" data-ops-open="events">Add event</button>
        <button type="button" class="ops-btn" data-ops-open="preview">Client view</button>
      </div>
      <h4 class="ops-sub">Timeline <span>${events.length ? `${events.length} event(s)` : ""}</span></h4>
      ${events.length ? `<ol class="ops-timeline">${events.map((e) => `<li class="${e.clientVisible === false ? "is-hidden" : ""}">
          <i class="tone-${esc(e.statusCode ? statusTone(e.statusCode) : "info")}"></i>
          <div><strong>${esc(e.title || (e.statusCode ? STATUS_META[e.statusCode]?.label : "Update"))}</strong>
            <span>${e.location ? `${esc(e.location)} · ` : ""}${esc(fmt(e.timestamp))}</span>
            <small>${esc(SOURCE_LABEL[e.source] || e.source || "")}${e.clientVisible === false ? " · hidden from client" : ""}</small></div></li>`).join("")}</ol>`
        : `<p class="ops-none">No tracking events recorded yet.</p>`}`;
  }
  async function loadGlobal() {
    if (globalCenter) { ops.useCache = false; globalCenter.refresh(); return; }
    $("globeFilter").innerHTML = `<option value="">All active statuses</option>` + STATUS_CODES.filter((c) => c !== "DELIVERED" && c !== "CANCELLED")
      .map((c) => `<option value="${c}">${esc(STATUS_META[c].label)}</option>`).join("");
    try {
      const { mountCommandCenter } = await import("../ui/globe/command-center.js");
      globalCenter = mountCommandCenter({
        mapEl: $("globeMap"), feedEl: $("globeFeed"), cardEl: $("globeCard"), statusEl: $("globeStatus"), mode: "admin", pollMs: 60000,
        load: async () => {
          if (!ops.useCache || !ops.data) { ops.data = await api("globalMap"); fillOpsSelects(); }
          ops.useCache = false;
          const routes = opsFiltered();
          return { routes, stats: { lastUpdated: routes[0]?.updatedAt || null } };
        },
        onData: (d) => renderOpsList(d.routes || []),
        onSelect: (key) => { ops.selected = key; $("opsList").querySelectorAll("[data-ops]").forEach((b) => b.classList.toggle("is-selected", b.dataset.ops === key)); renderOpsDetail(key); },
        onOpen: (r) => openShipment(r.ref, "tracking")
      });
    } catch { $("globeStatus").textContent = "The map component could not load."; }
  }
  const reFilter = () => { ops.useCache = true; globalCenter?.refresh(); };
  ["globeFilter", "globePublicOnly", "opsCarrier", "opsCountry", "opsHasPosition"].forEach((id) => $(id).addEventListener("change", reFilter));
  let searchTimer = null;
  $("opsSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(reFilter, 160); });
  $("globeRefresh").addEventListener("click", () => { ops.useCache = false; globalCenter?.refresh(); });
  $("opsList").addEventListener("click", (e) => { const b = e.target.closest("[data-ops]"); if (b) globalCenter?.select(b.dataset.ops); });
  $("opsDetail").addEventListener("click", (e) => {
    if (e.target.closest("[data-ops-back]")) { globalCenter?.select(null); return; }
    const v = e.target.closest("[data-ops-open]")?.dataset.opsOpen; if (v && ops.selected) openShipment(ops.selected, v);
  });
  window.switchView = switchView;

  // ---------- dashboard ----------
  async function loadDashboard() {
    await guarded("dash", null, async () => {
      const [d, settings] = await Promise.all([api("stats"), state.settings ? Promise.resolve(state.settings) : api("settings")]);
      state.settings = settings;
      const t = d.totals;
      const first = !$("kpiGrid").childElementCount;
      const ico = (path) => `<span class="kpi-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
      const I = {
        total: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>', active: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        transit: '<path d="M3 7h11v9H3Z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>', delivered: '<path d="M20 6 9 17l-5-5"/>',
        delayed: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', exceptions: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
        cancelled: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>', archived: '<path d="M3 5h18v4H3Z"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/>',
        clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2 .7 3.2 2.6 3.5 5.3"/>',
        unclassified: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>'
      };
      const tile = (key, label, value, { tone = "", sub = "", id = "" } = {}) => `<div class="kpi kpi-${key} ${tone}" ${id ? `id="${id}"` : ""} ${first ? "data-reveal" : ""}>${ico(I[key])}<div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
      const attention = (t.delayed || 0) + (t.exceptions || 0);
      // "needs attention" as a strip across the grid: calm when nothing is delayed or flagged, a direct link otherwise
      const alert = attention
        ? `<div class="kpi-alert bad attention" role="status"><strong>${attention} need${attention === 1 ? "s" : ""} attention</strong><span>${[t.delayed ? `${t.delayed} delayed` : "", t.exceptions ? `${t.exceptions} exception${t.exceptions === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span><button type="button" class="kpi-alert-btn" data-status="${t.delayed ? "DELAYED" : "EXCEPTION"}">Review</button></div>`
        : '<div class="kpi-alert good attention" role="status"><strong>Needs attention: 0</strong><span>No delayed shipments or exceptions</span></div>';
      const clientsTile = can("clients") ? tile("clients", "Registered clients", '<span class="kpi-loading">…</span>', { id: "kpiClients" }) : "";
      $("kpiGrid").innerHTML = alert +
        tile("total", "Total shipments", t.total, { sub: t.archived ? `incl. ${t.archived} archived` : "none archived" }) +
        tile("active", "Active", t.active, { sub: "not delivered or cancelled" }) + tile("transit", "In transit", t.inTransit, { tone: "info", sub: "picked up → out for delivery" }) +
        tile("delivered", "Delivered", t.delivered, { tone: "good" }) + tile("delayed", "Delayed", t.delayed, { tone: t.delayed ? "warn" : "" }) +
        tile("exceptions", "Exceptions", t.exceptions, { tone: t.exceptions ? "bad" : "" }) + tile("cancelled", "Cancelled", t.cancelled) + tile("archived", "Archived", t.archived) +
        clientsTile + (t.unclassified ? tile("unclassified", "Not yet classified", t.unclassified, { tone: "warn" }) : "");
      $("lastUpdated").textContent = `refreshed ${fmt(d.generatedAt)}`;
      // shipments by status: straight from the counts the server already computed (archived shipments excluded)
      const by = d.byStatus || {}; const max = Math.max(1, ...Object.values(by));
      const sum = STATUS_CODES.reduce((a, c) => a + (by[c] || 0), 0);
      $("dashStack").innerHTML = sum ? STATUS_CODES.filter((c) => by[c]).map((c) => `<i class="tone-${statusTone(c)}" style="flex:${by[c]}" title="${esc(STATUS_META[c].label)}: ${by[c]}"></i>`).join("") : "";
      $("dashStack").setAttribute("aria-label", sum ? STATUS_CODES.filter((c) => by[c]).map((c) => `${STATUS_META[c].label} ${by[c]}`).join(", ") : "No shipments");
      $("dashStatusTotal").textContent = sum ? `${sum} not archived` : "";
      $("dashStatus").innerHTML = STATUS_CODES.filter((c) => by[c]).map((c) => `<li><button type="button" class="status-bar" data-status="${c}">${pill(c)}<span class="sb-track"><i class="tone-${statusTone(c)}" style="width:${Math.max(4, (by[c] / max) * 100).toFixed(1)}%"></i></span><strong>${by[c]}</strong></button></li>`).join("")
        || "<li><small>No shipments yet.</small></li>";
      // registered clients: client profiles in the database; never estimated. Sign-in accounts without a profile
      // (they can't sign in and aren't clients yet) are reported separately.
      if (can("clients")) api("listClients").then((r) => {
        const el = $("kpiClients"); if (!el) return;
        const n = Array.isArray(r?.clients) ? r.clients.length : Array.isArray(r?.items) ? r.items.length : null;
        el.querySelector(".kpi-value").textContent = n == null ? "—" : String(n);
        const orphans = Number(r?.accountsWithoutProfile) || 0;
        if (orphans) { el.classList.add("warn"); el.insertAdjacentHTML("beforeend", `<button type="button" class="kpi-sub kpi-link" data-view="clients">${orphans} sign-in account${orphans === 1 ? "" : "s"} without a client profile · Review</button>`); }
        else if (n == null) el.insertAdjacentHTML("beforeend", '<div class="kpi-sub">Count unavailable</div>');
      }).catch(() => { const el = $("kpiClients"); if (el) { el.querySelector(".kpi-value").textContent = "—"; el.insertAdjacentHTML("beforeend", '<div class="kpi-sub">Could not load clients</div>'); } });
      loadLocationCheck();
      const banner = $("migrationBanner");
      banner.classList.toggle("hidden", !d.needsMigration);
      if (d.needsMigration) $("migrationText").textContent = `${d.unmigrated} existing shipment(s) were created before the control center upgrade. Run the additive data migration so they are counted, searchable and filterable. No data is removed.`;
      const li = (html) => `<li>${html}</li>`;
      const codeBtn = (c) => (c ? `<button class="code" data-open="${esc(c)}" type="button">${esc(c)}</button>` : "");
      $("dashRecent").innerHTML = d.recentShipments.length ? d.recentShipments.map((s) => li(`<span>${codeBtn(s.id)} ${s.status ? pill(s.status) : ""}<br><small>${esc(s.origin || "")} → ${esc(s.destination || "")}</small></span><small>${esc(timeAgo(s.updatedAt) || "")}</small>`)).join("") : li("<small>No shipments yet.</small>");
      const act = (a) => li(`<span>${a.shipment ? codeBtn(a.shipment) : a.courier ? `<code>${esc(a.courier)}</code>` : a.client ? `<code>${esc(a.email || a.client)}</code>` : ""} <strong>${esc(a.action)}</strong><br><small>by ${esc(a.actor)}</small></span><small>${esc(timeAgo(a.at) || "")}</small>`);
      $("dashActivity").innerHTML = d.recentActivity.length ? d.recentActivity.map(act).join("") : li("<small>No activity recorded yet.</small>");
      $("dashLocations").innerHTML = d.recentLocationUpdates.length ? d.recentLocationUpdates.map((a) => li(`<span>${codeBtn(a.shipment)} → ${esc(a.next?.location || "coordinates")}<br><small>${esc(a.next?.source || "admin")}</small></span><small>${esc(timeAgo(a.at) || "")}</small>`)).join("") : li("<small>No recent location updates.</small>");
      $("dashEvents").innerHTML = d.recentTrackingEvents.length ? d.recentTrackingEvents.map((a) => li(`<span>${codeBtn(a.shipment)} ${esc(a.action === "event.added" ? `event: ${a.next?.status || ""}` : `status → ${a.next?.status || ""}`)}</span><small>${esc(timeAgo(a.at) || "")}</small>`)).join("") : li("<small>No recent events.</small>");
      const chip = (label, on, bad) => `<span class="sys-chip ${bad ? "bad" : on ? "" : "off"}"><i></i>${esc(label)}</span>`;
      $("sysStatus").innerHTML = chip("API operational", true) + chip(`Database: ${settings.store}`, settings.store === "firestore", settings.store !== "firestore") +
        chip(settings.realtime.sse ? "Realtime: live stream + polling fallback" : "Realtime: polling", true) + chip(settings.notifications.configured ? "Notifications: configured" : "Notifications: not configured", settings.notifications.configured) +
        chip(`Map: ${settings.map.provider.replace(" (Leaflet)", "")}`, !settings.map.issues?.length, !!settings.map.issues?.length) + chip(`Courier API providers: ${settings.providers.filter((p) => p.configured).length}/${settings.providers.length} configured`, settings.providers.some((p) => p.configured));
    });
  }
  document.addEventListener("click", (e) => { const c = e.target.closest("[data-open]")?.dataset.open; if (c) openShipment(c, "tracking"); });
  $("kpiGrid").addEventListener("click", (e) => {
    const st = e.target.closest("[data-status]")?.dataset.status; if (st) { $("fStatus").value = st; switchView("shipments"); runSearch(true); return; }
    if (e.target.closest('[data-view="clients"]')) switchView("clients");
  });
  $("dashStatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    $("fStatus").value = b.dataset.status; switchView("shipments"); runSearch(true);
  });

  // ---------- location data check (read-only report; fixes only on explicit confirmation) ----------
  const POINT_LABEL = { origin: "Origin", destination: "Destination", current: "Current position" };
  const ISSUE_LABEL = { swapped: "Lat/lng look swapped", zero: "Stored as 0,0", invalid: "Not a valid coordinate", mismatch: "Wrong country" };
  const ignoredIssues = new Set();
  let locIssues = [];
  async function loadLocationCheck() {
    try {
      const r = await api("locationHealth");
      locIssues = r.issues.filter((i) => !ignoredIssues.has(`${i.code}:${i.field}`));
      const parts = [`${r.checked} shipment(s) checked`];
      parts.push(locIssues.length ? `${locIssues.length} coordinate problem(s) to review` : "no coordinate problems found");
      if (r.missingCoordinates) parts.push(`${r.missingCoordinates} active shipment(s) without any coordinates`);
      $("locCheckSummary").textContent = parts.join(" · ");
      $("locCheck").classList.toggle("has-issues", locIssues.length > 0);
      $("locCheckWrap").classList.toggle("hidden", !locIssues.length);
      const cc = (iso) => { try { return iso ? new Intl.DisplayNames(["en"], { type: "region" }).of(iso) : ""; } catch { return iso; } };
      $("locCheckRows").innerHTML = locIssues.map((i, n) => `<tr>
        <td data-label="Shipment"><button class="code" data-open="${esc(i.code)}" type="button">${esc(i.code)}</button></td>
        <td data-label="Point">${esc(POINT_LABEL[i.field])}<br><small>${esc(i.place || "no place name")}</small></td>
        <td data-label="Stored value"><code>${esc(i.lat)}, ${esc(i.lng)}</code></td>
        <td data-label="Problem"><strong class="issue-${esc(i.issue)}">${esc(ISSUE_LABEL[i.issue])}</strong><br><small>${esc(i.message)}${i.expectedCountry ? ` Text says ${esc(cc(i.expectedCountry))}` : ""}${i.foundCountry ? `, point is in ${esc(cc(i.foundCountry))}.` : ""}</small></td>
        <td data-label="Actions" class="row-actions">${i.canSwap ? `<button type="button" class="btn-action" data-loc-swap="${n}">Swap</button>` : ""}<button type="button" class="btn-action" data-loc-edit="${n}">Edit</button><button type="button" class="btn-action subtle" data-loc-ignore="${n}">Ignore</button></td></tr>`).join("");
    } catch (err) { if (!err.silent) $("locCheckSummary").textContent = "The location check could not run."; }
  }
  $("locCheckRun").addEventListener("click", () => loadLocationCheck());
  $("locCheckRows").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-loc-swap],[data-loc-edit],[data-loc-ignore]"); if (!b) return;
    const i = locIssues[Number(b.dataset.locSwap ?? b.dataset.locEdit ?? b.dataset.locIgnore)]; if (!i) return;
    if (b.dataset.locIgnore !== undefined) { ignoredIssues.add(`${i.code}:${i.field}`); loadLocationCheck(); return; }
    if (b.dataset.locEdit !== undefined) { openShipment(i.code, "tracking"); return; }
    if (!window.confirm(`Swap the ${POINT_LABEL[i.field].toLowerCase()} coordinates of ${i.code}?\n\nNow: ${i.lat}, ${i.lng}\nAfter: ${i.lng}, ${i.lat}\n\nThe change is recorded in the activity log.`)) return;
    await guarded(`swap:${i.code}`, b, async () => {
      await api("update", { code: i.code, changes: { [i.latField]: i.lng, [i.lngField]: i.lat } });
      host.showToast(`${i.code}: ${POINT_LABEL[i.field].toLowerCase()} coordinates corrected`, "success");
      loadLocationCheck();
    });
  });
  // ---------- backup (required before migration) ----------
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function runBackup(btn) {
    return guarded("backup", btn, async () => {
      const statusEl = $("backupStatus"); let cursor = null; const items = []; let first = null;
      do {
        const page = await api("backup", { cursor });
        if (!cursor) first = page;
        items.push(...page.items); cursor = page.nextCursor;
        if (statusEl) statusEl.textContent = `Reading… ${items.length} shipment(s)`;
      } while (cursor);
      const counts = { shipments: items.length, events: items.reduce((a, i) => a + i.events.length, 0), locations: items.reduce((a, i) => a + i.locations.length, 0) };
      const checksum = await sha256Hex(JSON.stringify(items));
      const file = { format: "hyperion-backup-v1", createdAt: new Date().toISOString(), startedAt: first.startedAt, counts, checksum,
        checksumOf: "SHA-256 of JSON.stringify(shipments)", couriers: first.couriers, shipments: items };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `hyperion-backup-${file.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await api("backupDone", { ...counts, checksum });
      state.backupAt = Date.now();
      const msg = `Backup saved: ${counts.shipments} shipments, ${counts.events} events, ${counts.locations} locations · SHA-256 ${checksum.slice(0, 12)}…`;
      if (statusEl) statusEl.textContent = msg;
      $("migrateBtn").disabled = false; $("migrateBtn").title = "";
      host.showToast("Full backup downloaded. Keep the file somewhere safe.", "success");
    });
  }
  $("backupBtn").addEventListener("click", () => runBackup($("backupBtn")));
  $("bannerBackupBtn").addEventListener("click", () => runBackup($("bannerBackupBtn")));

  $("migrateBtn").addEventListener("click", () => guarded("migrate", $("migrateBtn"), async () => {
    if (!state.backupAt) { host.showToast("Download a full backup first.", "error"); return; }
    let cursor = null; let changed = 0; let scanned = 0;
    do { const r = await api("migrate", { cursor }); cursor = r.nextCursor; changed += r.changed; scanned += r.scanned; $("migrationText").textContent = `Migrating… scanned ${scanned}, updated ${changed}`; } while (cursor);
    host.showToast(`Migration complete: ${changed} shipment(s) updated`, "success"); loadDashboard();
  }));

  // ---------- static selects ----------
  function populateStaticSelects() {
    $("status").innerHTML = statusOptions("CREATED");
    $("shipmentStatusInput").innerHTML = statusOptions("CREATED");
    $("fStatus").innerHTML = statusOptions("", { blank: "All statuses" });
    $("locStatus").innerHTML = statusOptions("CREATED");
    $("stStatus").innerHTML = statusOptions("CREATED");
    $("evStatus").innerHTML = statusOptions("IN_TRANSIT");
    $("exType").innerHTML = `<option value="">No exception</option>` + Object.entries(EXCEPTION_TYPES).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join("");
    $("visGrid").innerHTML = VISIBILITY_KEYS.map((k) => `<label><input type="checkbox" data-vis="${k}" checked><span>${esc(VIS_LABELS[k][0])}<small>${esc(VIS_LABELS[k][1])}</small></span></label>`).join("");
  }

  // ---------- create ----------
  function packageFrom(prefix) {
    return { description: nv(`${prefix}Description`), weight: nv(`${prefix}Weight`), dimensions: nv(`${prefix}Dimensions`), pieces: nv(`${prefix}Pieces`) };
  }
  $("createForm").addEventListener("submit", (e) => {
    e.preventDefault();
    guarded("create", e.submitter || $("createForm").querySelector('[type="submit"]'), async () => {
      if (!nv("courier")) { host.showToast("Please select a courier", "error"); return; }
      const coords = checkCoords("latitude", "longitude", "createCoordErr");
      if (!coords.ok) { $("latitude").focus(); return; }
      const lat = numOrUndef("latitude"); const lng = numOrUndef("longitude");
      const shipment = {
        trackingCode: nv("id") || undefined, statusCode: $("status").value, courier: nv("courier"), courierTrackingNumber: nv("courierTrackingNumber"),
        serviceType: nv("serviceType"), clientRef: nv("clientRef"), notifyEmail: nv("notifyEmail") || undefined, customerId: can("clients") ? nv("customerId") || undefined : undefined, origin: nv("origin"), destination: nv("destination"), location: nv("location"),
        distance: nv("distance"), fee: nv("fee"), etaDate: nv("etaDate") || undefined, notes: nv("notes"), internalNotes: nv("internalNotes"),
        package: packageFrom("pkg")
      };
      if (lat !== undefined || lng !== undefined) { shipment.latitude = lat; shipment.longitude = lng; }
      const { shipment: created } = await api("create", { shipment });
      host.showToast(`Shipment ${created.id} created`, "success");
      $("createForm").reset(); $("courierPrefixHint").textContent = "Tracking prefix: --";
      fillCustomerSelect("customerId", "").catch(() => {});
      state.list = { cursor: null, rows: [] };
      openShipment(created.id, "tracking");
    });
  });

  // ---------- shipments list ----------
  function filters() {
    return { q: nv("fCode"), status: $("fStatus").value, destination: nv("fDestination"), location: nv("fLocation"), clientRef: nv("fClient"), includeArchived: $("fArchived").checked };
  }
  async function runSearch(reset) {
    await guarded("list", $("fSearch"), async () => {
      if (reset) state.list = { cursor: null, rows: [] };
      const r = await api("list", { ...filters(), limit: 25, cursor: state.list.cursor });
      state.list.rows = state.list.rows.concat(r.items); state.list.cursor = r.nextCursor;
      renderList();
    });
  }
  function renderList() {
    const rows = state.list.rows;
    $("loadMore").classList.toggle("hidden", !state.list.cursor);
    $("listInfo").textContent = rows.length ? `${rows.length} shown${state.list.cursor ? " (more available)" : ""}` : "";
    if (!rows.length) { $("shipmentsContainer").innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><h3>No shipments found</h3><p>Try different filters, or run the data migration from the Dashboard if you expect legacy shipments here.</p></div>`; return; }
    $("shipmentsContainer").innerHTML = `<div class="table-wrap"><table class="shipments-table responsive"><thead><tr><th>Tracking ID</th><th>Courier</th><th>Status</th><th>Route</th><th>Current location</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${rows.map((s) => {
      const cr = host.findCourier(s.courier);
      return `<tr>
        <td data-label="Tracking ID" class="td-code"><strong>${esc(s.id)}</strong> <button class="btn-action subtle btn-copy" data-act="copy" data-code="${esc(s.id)}" aria-label="Copy tracking number ${esc(s.id)}">Copy</button>${s.archived ? ' <span class="pill neutral">archived</span>' : ""}${s.publicMap ? ' <span class="pill public" title="Shown on the public homepage (masked)">homepage</span>' : ""}</td>
        <td data-label="Courier">${esc(cr?.name || s.courier || "—")}</td>
        <td data-label="Status">${s.statusCode ? pill(s.statusCode) : `<span class="pill neutral">${esc(s.status || "Unknown")}</span>`}</td>
        <td data-label="Route">${esc(s.origin || "—")} → ${esc(s.destination || "—")}</td>
        <td data-label="Location">${esc(s.location || "—")}${s.hasCoordinates ? "" : ' <small class="muted">(no coords)</small>'}</td>
        <td data-label="Updated">${esc(timeAgo(s.updatedAt) || "—")}</td>
        <td data-label="Actions" class="td-actions"><div class="row-actions">
          <button class="btn-action" data-act="track" data-code="${esc(s.id)}">Open</button>
          <button class="btn-action" data-act="edit" data-code="${esc(s.id)}">Edit</button>
          <button class="btn-action" data-act="preview" data-code="${esc(s.id)}">Preview</button>
          ${can("archive") || can("delete") ? `<span class="row-actions-risky">${can("archive") ? `<button class="btn-action" data-act="${s.archived ? "unarchive" : "archive"}" data-code="${esc(s.id)}">${s.archived ? "Restore" : "Archive"}</button>` : ""}
          ${can("delete") ? `<button class="btn-action btn-danger" data-act="delete" data-code="${esc(s.id)}">Delete</button>` : ""}</span>` : ""}
        </div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  $("fSearch").addEventListener("click", () => runSearch(true));
  $("shipmentFilters").addEventListener("submit", (e) => { e.preventDefault(); runSearch(true); });
  $("shipmentFilters").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(true); } });
  $("fReset").addEventListener("click", () => { $("shipmentFilters").reset(); runSearch(true); });
  $("loadMore").addEventListener("click", () => runSearch(false));
  $("shipmentsContainer").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return; const code = b.dataset.code;
    ({ track: () => openShipment(code, "tracking"), preview: () => openShipment(code, "preview"), edit: () => openEdit(code),
      archive: () => setArchived(code, true), unarchive: () => setArchived(code, false), delete: () => deleteShipment(code), copy: () => copyCode(code) })[b.dataset.act]?.();
  });
  async function copyCode(code) {
    try { await navigator.clipboard.writeText(code); host.showToast(`Copied ${code}`, "success"); }
    catch { host.showToast("Copy is not available in this browser — select the tracking number instead", "error"); }
  }
  async function setArchived(code, archived) {
    if (archived && !(await confirmDialog({ title: `Archive ${code}?`, body: "It disappears from public tracking and the homepage. All data, events and history are kept, and you can restore it at any time.", ok: "Archive shipment" }))) return;
    await guarded(`arch:${code}`, null, async () => { await api(archived ? "archive" : "unarchive", { code }); host.showToast(archived ? "Shipment archived" : "Shipment restored", "success"); runSearch(true); });
  }
  async function deleteShipment(code) {
    if (!(await confirmDialog({ title: `Permanently delete ${code}?`, body: "This removes the shipment with its events and location history and cannot be undone. Archiving keeps everything instead.", ok: "Delete permanently", typed: code }))) return;
    await guarded(`del:${code}`, null, async () => { await api("delete", { code }); host.showToast("Shipment deleted", "success"); if (state.sel?.shipment.id === code) state.sel = null; runSearch(true); });
  }

  // ---------- customer account picker (shipment forms) ----------
  // Lists the registered client accounts, so a shipment can be linked to the customer who should see it and receive its
  // status notifications. Admins without client access never see the picker (the server ignores the field for them too).
  async function fillCustomerSelect(id, selected) {
    const sel = $(id); if (!sel || !can("clients")) return;
    const { clients } = await api("listClients");
    const opts = [new Option("No customer account", "")];
    for (const c of clients.slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))) {
      opts.push(new Option(`${c.name || c.email} · ${c.email}${c.status !== "active" ? " (inactive)" : ""}`, c.id));
    }
    if (selected && !clients.some((c) => c.id === selected)) opts.push(new Option("Unknown account (no longer exists)", selected));
    sel.replaceChildren(...opts); sel.value = selected || "";
  }

  // ---------- edit modal ----------
  let editing = null;
  async function openEdit(code) {
    await guarded("edit-open", null, async () => {
      const full = await api("get", { code }); const s = full.shipment; editing = s;
      const set = (id, v) => { $(id).value = v ?? ""; };
      set("shipmentIdInput", s.id); $("shipmentStatusInput").innerHTML = statusOptions(s.statusCode); set("shipmentServiceInput", s.serviceType); set("shipmentClientRefInput", s.clientRef); set("shipmentNotifyEmailInput", s.notifyEmail);
      // Keep the shipment's courier selectable even if it is now inactive/archived (or a legacy id), so saving never clears it.
      const cSel = $("shipmentCourierInput");
      if (s.courier && cSel && ![...cSel.options].some((o) => o.value === s.courier)) cSel.add(new Option(`${host.findCourier?.(s.courier)?.name || s.courier} (inactive)`, s.courier));
      set("shipmentCourierInput", s.courier); set("shipmentCourierTrackingNumberInput", s.courierTrackingNumber); set("shipmentOriginInput", s.origin);
      set("shipmentDestinationInput", s.destination); set("shipmentLocationInput", s.location); set("shipmentDistanceInput", s.distance);
      set("shipmentLatitudeInput", s.latitude); set("shipmentLongitudeInput", s.longitude); set("shipmentFeeInput", s.fee);
      const p = s.package || {}; set("shipmentPkgDescription", p.description); set("shipmentPkgWeight", p.weight); set("shipmentPkgDimensions", p.dimensions); set("shipmentPkgPieces", p.pieces);
      set("shipmentNotesInput", s.notes); set("shipmentInternalNotesInput", s.internalNotes);
      if (can("clients")) await fillCustomerSelect("shipmentCustomerInput", s.customerId || "").catch(() => {});
      $("shipmentModal").classList.add("show");
    });
  }
  window.editShipment = openEdit;
  window.closeShipmentModal = () => { $("shipmentModal").classList.remove("show"); editing = null; };
  $("shipmentForm").addEventListener("submit", (e) => {
    e.preventDefault();
    guarded("edit-save", e.submitter, async () => {
      if (!editing) return;
      const s = editing; const changes = {};
      const cmp = (key, value, prev = s[key]) => { if ((value ?? "") !== (prev ?? "")) changes[key] = value; };
      cmp("statusCode", $("shipmentStatusInput").value, s.statusCode);
      cmp("serviceType", nv("shipmentServiceInput")); cmp("clientRef", nv("shipmentClientRefInput")); cmp("notifyEmail", nv("shipmentNotifyEmailInput")); cmp("courier", nv("shipmentCourierInput"));
      cmp("courierTrackingNumber", nv("shipmentCourierTrackingNumberInput")); cmp("origin", nv("shipmentOriginInput")); cmp("destination", nv("shipmentDestinationInput"));
      cmp("location", nv("shipmentLocationInput")); cmp("distance", nv("shipmentDistanceInput")); cmp("fee", nv("shipmentFeeInput"));
      cmp("notes", nv("shipmentNotesInput")); cmp("internalNotes", nv("shipmentInternalNotesInput"));
      if (can("clients")) cmp("customerId", $("shipmentCustomerInput").value, s.customerId);
      const lat = nv("shipmentLatitudeInput"); const lng = nv("shipmentLongitudeInput");
      if (String(s.latitude ?? "") !== lat || String(s.longitude ?? "") !== lng) { changes.latitude = lat; changes.longitude = lng; }
      const pkg = { description: nv("shipmentPkgDescription"), weight: nv("shipmentPkgWeight"), dimensions: nv("shipmentPkgDimensions"), pieces: nv("shipmentPkgPieces") };
      const prevPkg = s.package || {};
      if (Object.keys(pkg).some((k) => (pkg[k] || "") !== (prevPkg[k] || ""))) changes.package = pkg;
      if (!Object.keys(changes).length) { host.showToast("No changes to save", "success"); closeShipmentModal(); return; }
      const r = await api("update", { code: s.id, changes });
      host.showToast(r.unchanged ? "No changes to save" : "Shipment updated", "success");
      closeShipmentModal(); state.list = { cursor: null, rows: [] }; if (state.view === "shipments") runSearch(true);
      if (state.sel?.shipment.id === s.id) selectShipment(s.id);
    });
  });

  // ---------- workspace (selected shipment) ----------
  async function openShipment(code, view) {
    $("wsCode").value = code;
    await selectShipment(code);
    switchView(view);
  }
  async function selectShipment(codeInput) {
    const code = String(codeInput || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!code) { host.showToast("Enter a tracking code", "error"); return false; }
    return guarded("select", $("wsLoad"), async () => {
      const full = await api("get", { code });
      state.sel = full; $("wsCode").value = full.shipment.id;
      $("wsCurrent").innerHTML = `${pill(full.shipment.statusCode)} ${esc(full.shipment.origin || "")} → ${esc(full.shipment.destination || "")}`;
      if (WORKSPACE_VIEWS.includes(state.view)) renderWorkspace();
      return true;
    }).catch(() => false);
  }
  $("wsLoad").addEventListener("click", () => selectShipment($("wsCode").value));
  $("wsCode").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); selectShipment($("wsCode").value); } });
  let suggestTimer = null;
  $("wsCode").addEventListener("input", () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      const q = nv("wsCode"); if (q.length < 2) return;
      try { const r = await api("list", { q, limit: 8 }); $("wsCodes").innerHTML = r.items.map((i) => `<option value="${esc(i.id)}">`).join(""); } catch { /* ignore */ }
    }, 250);
  });

  function renderWorkspace() {
    const has = !!state.sel;
    $("trkEmpty").classList.toggle("hidden", has); $("trkBody").classList.toggle("hidden", !has);
    $("evEmpty").classList.toggle("hidden", has); $("evBody").classList.toggle("hidden", !has);
    $("pvEmpty").classList.toggle("hidden", has); $("pvBody").classList.toggle("hidden", !has);
    if (!has) return;
    if (state.view === "tracking") renderTracking();
    if (state.view === "events") renderEvents();
    if (state.view === "preview") renderPreview();
  }

  const pt = (lat, lng) => (typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null);
  function adminMapData() {
    const { shipment: s, locations } = state.sel;
    const current = pt(s.latitude, s.longitude);
    if (current) Object.assign(current, { name: s.location || null, updatedAt: s.locationUpdatedAt || null, sourceLabel: ({ admin: "Operations update", carrier_api: "Carrier API", gps: "GPS telemetry" })[s.locationSource || "admin"] });
    return {
      origin: pt(s.originLat, s.originLng), destination: pt(s.destinationLat, s.destinationLng), current, originLabel: s.origin, destinationLabel: s.destination,
      trail: [...locations].filter((l) => pt(l.lat, l.lng)).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-25).map((l) => ({ lat: l.lat, lng: l.lng, timestamp: l.timestamp, name: l.name }))
    };
  }
  async function renderTracking() {
    const { shipment: s } = state.sel;
    const src = ({ admin: "Operations update", carrier_api: "Carrier API", gps: "GPS telemetry" })[s.locationSource || "admin"];
    const eta = s.etaWindowStart && s.etaWindowEnd ? `${fmt(s.etaWindowStart)} – ${fmt(s.etaWindowEnd)}` : s.etaDate || s.eta || "Not set";
    const fresh = locationFreshness({ updatedAt: s.locationUpdatedAt, hasCoordinates: typeof s.latitude === "number", hasName: !!s.location, statusCode: s.statusCode });
    const cr = host.findCourier(s.courier);
    $("trkSummary").innerHTML = [
      ["Tracking number", `<strong>${esc(s.id)}</strong>`], ["Status", pill(s.statusCode)], ["Carrier", `${esc(cr?.name || s.courier || "—")}${cr?.type === "custom" ? '<span class="courier-badge custom">custom</span>' : ""}`],
      ["Current location", `${esc(s.location || "—")}<br><span class="pill ${({ live: "success", recent: "info", last: "warn", none: "neutral" })[fresh]}">${esc(LOCATION_STATE_LABELS[fresh])} (client view)</span>`],
      ["Coordinates", typeof s.latitude === "number" ? `${s.latitude}, ${s.longitude}` : "—"], ["Last location update", `${esc(fmt(s.locationUpdatedAt))}${s.locationUpdatedAt ? `<br><small style="text-transform:none;letter-spacing:0;font-weight:500">${esc(src)}</small>` : ""}`],
      ["ETA", esc(eta)], ["Exception", esc(s.exception ? `${EXCEPTION_TYPES[s.exception.type] || s.exception.type}` : "None recorded")],
      ["Latest event", (() => { const e = [...(state.sel.events || [])].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
        return e ? `${esc(e.title)}<br><small style="text-transform:none;letter-spacing:0;font-weight:500">event time ${esc(fmt(e.timestamp))}${e.clientVisible === false ? " · hidden from client" : ""}</small>` : "None recorded"; })()],
      ["Client sees", `${s.publicMap ? "Tracking page + homepage map" : "Tracking page only"}<br><span class="trk-actions"><button type="button" class="btn-action" data-ws="preview">Preview client view</button><a class="btn-action" href="track.html?code=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Open public page</a></span>`]
    ].map(([k, v]) => `<div><small>${k}</small>${v}</div>`).join("");
    $("locName").value = s.location || ""; $("locLat").value = s.latitude ?? ""; $("locLng").value = s.longitude ?? ""; $("locNote").value = "";
    $("locTime").value = nowLocalInput(); $("locCoordErr").textContent = ""; $("locMsg").textContent = ""; $("locMsg").className = "form-msg";
    $("locLat").setAttribute("aria-invalid", "false"); $("locLng").setAttribute("aria-invalid", "false");
    $("locStatus").innerHTML = statusOptions(s.statusCode); $("stStatus").innerHTML = statusOptions(s.statusCode);
    $("exType").value = s.exception?.type || ""; $("exNote").value = s.exception?.note || ""; $("exVisible").checked = s.exception ? s.exception.clientVisible !== false : true;
    $("etaDateInput").value = s.etaDate || ""; $("etaStart").value = toLocalInput(s.etaWindowStart); $("etaEnd").value = toLocalInput(s.etaWindowEnd);
    $("oLat").value = s.originLat ?? ""; $("oLng").value = s.originLng ?? ""; $("dLat").value = s.destinationLat ?? ""; $("dLng").value = s.destinationLng ?? "";
    $("routeHint").textContent = [s.originCoordsSource && `Origin point: ${s.originCoordsSource}`, s.destinationCoordsSource && `Destination point: ${s.destinationCoordsSource}`].filter(Boolean).join(" · ") || "No route points recorded yet.";
    const vis = { ...DEFAULT_VISIBILITY, ...(s.visibility || {}) };
    document.querySelectorAll("[data-vis]").forEach((c) => { c.checked = vis[c.dataset.vis] !== false; });
    $("publicMapInput").checked = s.publicMap === true;
    const writeOnly = ["locForm", "statusForm", "etaForm", "routeForm", "visForm"];
    writeOnly.forEach((f) => $(f).querySelectorAll("button, input, select").forEach((el) => { el.disabled = !can("write") && !can("location"); }));
    await ensureAdminMap();
  }
  const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); if (Number.isNaN(+d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  async function ensureAdminMap() {
    const el = $("adminMap"); const data = adminMapData();
    if (!data.current && !data.origin && !data.destination && !data.trail.length) {
      state.adminMap?.destroy(); state.adminMap = null;
      el.innerHTML = '<div class="hx-map-msg">No coordinates recorded yet. Enter latitude/longitude in the form (or set route points below) to see the shipment on the map.</div>'; return;
    }
    try {
      if (!state.adminMap) {
        el.innerHTML = ""; el.classList.remove("hx-map-empty");
        const { createMap } = await import("../tracker/map.js");
        state.adminMap = await createMap(el, { interactiveHint: false });
        // Click the map to fill the location form's coordinates (the admin still reviews and submits).
        state.adminMap.leaflet?.on("click", (e) => {
          if (state.view !== "tracking" || $("locLat").disabled) return;
          const ll = e.latlng.wrap();
          $("locLat").value = ll.lat.toFixed(6); $("locLng").value = ll.lng.toFixed(6);
          checkCoords("locLat", "locLng", "locCoordErr");
          $("locMsg").className = "form-msg"; $("locMsg").textContent = "Coordinates filled from the map — add the location name and press Update location.";
        });
      }
      const fresh = locationFreshness({ updatedAt: state.sel.shipment.locationUpdatedAt, hasCoordinates: !!data.current, hasName: !!state.sel.shipment.location, statusCode: state.sel.shipment.statusCode });
      if (data.current) data.current.state = fresh;
      state.adminMap.update(data);
    } catch { el.innerHTML = '<div class="hx-map-msg">Map temporarily unavailable.</div>'; state.adminMap = null; }
  }

  async function mutateSelected(key, btn, action, body, message) {
    return guarded(key, btn, async () => {
      const code = state.sel.shipment.id;
      const r = await api(action, { code, ...body });
      host.showToast(r.unchanged || r.duplicate ? (r.duplicate ? "That event already exists — nothing added" : "No changes — nothing to update") : message, "success");
      await selectShipment(code);
      return r;
    });
  }
  enablePairPaste("locLat", "locLng"); enablePairPaste("evLat", "evLng"); enablePairPaste("latitude", "longitude");
  enablePairPaste("oLat", "oLng"); enablePairPaste("dLat", "dLng");
  for (const [a, b, err] of [["locLat", "locLng", "locCoordErr"], ["evLat", "evLng", "evCoordErr"], ["latitude", "longitude", "createCoordErr"]]) {
    for (const id of [a, b]) {
      // Don't complain about the partner field while the admin is moving into it (that message used to appear
      // mid-entry and then vanish on the next click, shifting the form so the click missed the button).
      $(id)?.addEventListener("blur", (e) => {
        if (e.relatedTarget && (e.relatedTarget.id === a || e.relatedTarget.id === b)) return;
        if ($(a).value || $(b).value || $(err).textContent) checkCoords(a, b, err);
      });
      // An existing error is re-checked while typing, so it clears as soon as the pair is valid.
      $(id)?.addEventListener("input", () => { if ($(err)?.textContent) checkCoords(a, b, err); });
    }
  }
  $("locNow").addEventListener("click", () => { $("locTime").value = nowLocalInput(); });
  $("locForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = $("locMsg"); msg.className = "form-msg"; msg.textContent = "";
    if (!nv("locName")) { msg.className = "form-msg err"; msg.textContent = "Enter the current location name."; $("locName").focus(); return; }
    const coords = checkCoords("locLat", "locLng", "locCoordErr");
    if (!coords.ok) { $("locLat").focus(); return; }
    const s = state.sel.shipment;
    if (coords.lat == null && typeof s.latitude === "number" && nv("locName") !== (s.location || "")) {
      if (!confirm("You changed the location name but left the coordinates empty. The map will keep showing the previous recorded position on the route. Continue?")) return;
    }
    const body = { locationName: nv("locName"), statusCode: $("locStatus").value, statusNote: nv("locNote") };
    if (coords.lat != null) { body.latitude = coords.lat; body.longitude = coords.lng; }
    const when = $("locTime").value ? new Date($("locTime").value) : null;
    if (when && Number.isNaN(+when)) { msg.className = "form-msg err"; msg.textContent = "Enter a valid date and time."; return; }
    if (when && +when > Date.now() + 5 * 60 * 1000) { msg.className = "form-msg err"; msg.textContent = "The position time cannot be in the future."; return; }
    if (when) body.timestamp = when.toISOString();
    mutateSelected("loc", $("locBtn"), "updateLocation", body, "Location updated — clients will see it automatically").then((r) => {
      if (r) { msg.className = "form-msg ok"; msg.textContent = r.unchanged ? "No changes — nothing to update." : "✓ Saved and sent to the client page."; }
    });
  });
  $("statusForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = state.sel.shipment; const changes = { statusCode: $("stStatus").value };
    const type = $("exType").value;
    if (type) changes.exception = { type, note: nv("exNote"), clientVisible: $("exVisible").checked };
    else if (s.exception) changes.exception = null;
    mutateSelected("status", e.submitter, "update", { changes }, "Status saved");
  });
  $("etaForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const start = $("etaStart").value; const end = $("etaEnd").value;
    if (!!start !== !!end) { host.showToast("Provide both window start and end", "error"); return; }
    mutateSelected("eta", e.submitter, "update", { changes: { etaDate: $("etaDateInput").value, etaWindowStart: start ? new Date(start).toISOString() : "", etaWindowEnd: end ? new Date(end).toISOString() : "" } }, "ETA saved");
  });
  $("etaClear").addEventListener("click", () => mutateSelected("eta", $("etaClear"), "update", { changes: { etaDate: "", etaWindowStart: "", etaWindowEnd: "", eta: "" } }, "ETA cleared"));
  $("routeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const changes = {}; const o = [nv("oLat"), nv("oLng")]; const d = [nv("dLat"), nv("dLng")];
    const oc = checkCoords("oLat", "oLng", "routeErr"); if (!oc.ok) return;
    const dc = checkCoords("dLat", "dLng", "routeErr"); if (!dc.ok) return;
    if (o[0] !== "") { changes.originLat = o[0]; changes.originLng = o[1]; }
    if (d[0] !== "") { changes.destinationLat = d[0]; changes.destinationLng = d[1]; }
    if (!Object.keys(changes).length) { host.showToast("Nothing to save", "error"); return; }
    mutateSelected("route", e.submitter, "update", { changes }, "Route points saved");
  });
  $("visForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const visibility = {}; document.querySelectorAll("[data-vis]").forEach((c) => { visibility[c.dataset.vis] = c.checked; });
    const publicMap = $("publicMapInput").checked;
    if (publicMap && !state.sel.shipment.publicMap && !confirm("Show this shipment on the public homepage? Only a masked code, city-level route, status and event titles are shown.")) return;
    mutateSelected("vis", e.submitter, "update", { changes: { visibility, publicMap } }, publicMap ? "Visibility saved · shown on homepage" : "Visibility saved");
  });

  // ---------- events ----------
  $("evNow").addEventListener("click", () => { const d = new Date(); $("evDate").value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; $("evTime").value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; });
  function renderEvents() {
    const now = new Date(); const p = (n) => String(n).padStart(2, "0");
    if (!$("evDate").value) $("evDate").value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    if (!$("evTime").value) $("evTime").value = `${p(now.getHours())}:${p(now.getMinutes())}`;
    $("evStatus").innerHTML = statusOptions(state.sel.shipment.statusCode);
    $("evLocation").value ||= state.sel.shipment.location || "";
    const evs = state.sel.events;
    $("evList").innerHTML = evs.length ? evs.map((e) => `<li><div>${e.statusCode ? pill(e.statusCode) : ""} <strong>${esc(e.title)}</strong> ${e.clientVisible === false ? '<span class="pill warn">hidden from client</span>' : ""}</div>
      <div>${esc(e.location || "")}${e.location && e.description ? " — " : ""}${esc(e.description || "")}</div>
      <div class="meta">${esc(fmt(e.timestamp))}${typeof e.lat === "number" ? ` · 📍 ${e.lat}, ${e.lng}` : ""} · ${esc(e.kind)} · source: ${esc(e.source)} · by ${esc(e.actor || "system")}</div></li>`).join("") : '<li class="meta">No events recorded yet.</li>';
    loadHistory(state.sel.shipment.id);
  }
  // read-only per-shipment change history from the existing activity log
  async function loadHistory(code) {
    const box = $("evHistory"); box.innerHTML = '<p class="hint">Loading change history…</p>';
    try {
      const { items } = await api("audit", { limit: 50, code });
      if (state.sel?.shipment.id !== code) return;
      const brief = (o) => (o ? Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : v}`).join(", ") : "");
      box.innerHTML = items.length ? `<ol class="history-list">${items.map((a) => `<li><div><strong>${esc(a.action)}</strong> <small>by ${esc(a.actor)}</small></div>
        ${a.next ? `<div class="history-change">${esc(brief(a.previous) || "—")} → ${esc(brief(a.next))}</div>` : ""}<div class="meta">saved ${esc(fmt(a.at))}</div></li>`).join("")}</ol>` : '<p class="hint">No changes recorded yet.</p>';
    } catch { box.innerHTML = '<p class="hint">Change history could not be loaded. It is still available under Activity Logs.</p>'; }
  }
  document.addEventListener("click", (e) => { if (e.target.closest('[data-ws="preview"]') && state.sel) switchView("preview"); });
  $("eventForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const when = new Date(`${$("evDate").value}T${$("evTime").value}`);
    if (Number.isNaN(+when)) { host.showToast("Enter a valid date and time", "error"); return; }
    if (+when > Date.now() + 5 * 60 * 1000) { host.showToast("Event time cannot be in the future", "error"); return; }
    const coords = checkCoords("evLat", "evLng", "evCoordErr");
    if (!coords.ok) { $("evLat").focus(); return; }
    const body = { statusCode: $("evStatus").value, location: nv("evLocation"), description: nv("evDesc"), timestamp: when.toISOString(), clientVisible: $("evVisible").checked, applyToShipment: $("evApply").checked };
    if (coords.lat != null) { body.latitude = coords.lat; body.longitude = coords.lng; }
    mutateSelected("event", e.submitter, "addEvent", body, body.applyToShipment ? "Tracking event added — client page updated" : "Tracking event added").then((r) => { if (r && !r.duplicate) { $("evDesc").value = ""; $("evLat").value = ""; $("evLng").value = ""; } });
  });

  // ---------- client preview ----------
  async function renderPreview() {
    const code = state.sel.shipment.id;
    $("pvOpen").href = `track.html?code=${encodeURIComponent(code)}`;
    if (!state.previewTracker) {
      const { createTracker } = await import("../tracker/tracker.js");
      state.previewTracker = createTracker($("previewRoot"), {
        preview: true,
        loadView: async (c) => {
          try { const r = await api("preview", { code: c }); return { status: "ok", view: r.shipment }; }
          catch (err) { return { status: err.status === 404 ? "notfound" : "error" }; }
        }
      });
    }
    state.previewTracker.clear(); state.previewTracker.track(code, { push: false });
  }
  $("pvRefresh").addEventListener("click", () => { if (state.sel) { selectShipment(state.sel.shipment.id).then(() => renderPreview()); } });

  // ---------- audit ----------
  async function loadAudit() {
    await guarded("audit", $("auditLoad"), async () => {
      const code = nv("auditCode");
      const { items } = await api("audit", { limit: 150, code: code || undefined });
      const diff = (a) => { const f = (o) => (o ? Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n") : "—"); return `<div class="audit-diff">${esc(f(a.previous))}\n→\n${esc(f(a.next))}</div>`; };
      $("auditContainer").innerHTML = items.length ? `<table class="shipments-table responsive"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Shipment</th><th>Change</th></tr></thead><tbody>${items.map((a) =>
        `<tr><td data-label="When">${esc(fmt(a.at))}</td><td data-label="Admin">${esc(a.actor)}<br><small>${esc(a.role || "")}${a.via && a.via !== "admin" ? ` · ${esc(a.via)}` : ""}</small></td><td data-label="Action"><strong>${esc(a.action)}</strong></td><td data-label="Shipment">${esc(a.shipment || (a.courier ? `courier: ${a.courier}` : a.client ? `client: ${a.email || a.client}${a.result ? ` · ${a.result}` : ""}` : "—"))}</td><td data-label="Change">${diff(a)}</td></tr>`).join("")}</tbody></table>`
        : '<div class="empty-state"><div class="empty-icon">🛡️</div><h3>No activity recorded</h3><p>Actions will appear here as soon as shipments are created or changed.</p></div>';
    });
  }
  $("auditLoad").addEventListener("click", loadAudit);
  $("auditReset").addEventListener("click", () => { $("auditCode").value = ""; loadAudit(); });

  // ---------- settings ----------
  async function loadSettings() {
    await guarded("settings", null, async () => {
      const s = state.settings = await api("settings");
      const yes = (b) => (b ? '<span class="pill success">configured</span>' : '<span class="pill neutral">not configured</span>');
      $("settingsBody").innerHTML = `
        <div class="panel-grid">
          <div class="panel"><h4>Account</h4><p>${esc($("whoami").textContent)}</p><p class="hint">Session lifetime ${s.session.ttlMinutes} min (renewed while active). Permissions: ${esc(state.perms.join(", "))}</p></div>
          <div class="panel"><h4>Database</h4><p><strong>${esc(s.store)}</strong></p><p class="hint">Shipments, events, locations and the audit log are written server-side only.</p></div>
          <div class="panel"><h4>Map</h4><p>${esc(s.map.provider)}</p>${s.map.issues?.length ? `<p class="hint is-danger">${s.map.issues.map(esc).join("<br>")}</p>` : ""}<p class="hint">Fallbacks: ${esc((s.map.fallbacks || []).join(", "))}. To use a keyed provider set MAP_PROVIDER (maptiler, stadia or mapbox) and MAP_TILE_KEY (a public, domain-restricted key) in the server environment.</p></div>
          <div class="panel"><h4>Realtime</h4><p>${s.realtime.sse ? "Server-sent events" : "Polling only"} · fallback polling every ${Math.round(s.realtime.pollMs / 1000)}s</p></div>
          <div class="panel"><h4>Notifications</h4><p>${yes(s.notifications.configured)}</p><p class="hint">${s.notifications.configured ? `Providers: ${esc(s.notifications.providers.join(", "))}` : "Nothing is sent. Set RESEND_API_KEY + NOTIFY_EMAIL_FROM (+ SITE_URL) to e-mail customers who have a notification address, or NOTIFY_WEBHOOK_URL to forward events."}</p></div>
          <div class="panel"><h4>Courier / GPS providers</h4>${s.providers.map((p) => `<p>${esc(p.id)} (${esc(p.source)}) ${yes(p.configured)}</p>`).join("")}<p class="hint">Webhook: POST /api/provider?provider=&lt;id&gt; with X-Hyperion-Signature.</p></div>
          <div class="panel"><h4>Geocoding</h4><p>${esc(s.geocoding)}</p></div>
          <div class="panel"><h4>Status reference</h4><p class="hint">${s.statuses.map((x) => esc(x.label)).join(" · ")}</p></div>
        </div>`;
    });
  }

  // ---------- export ----------
  window.exportData = async () => {
    await guarded("export", null, async () => {
      let cursor = null; const all = []; let pages = 0;
      do { const r = await api("list", { limit: 100, cursor, includeArchived: true }); all.push(...r.items); cursor = r.nextCursor; pages++; } while (cursor && pages < 50);
      const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "shipments_export.json"; a.click(); URL.revokeObjectURL(url);
      host.showToast(`Exported ${all.length} shipments`, "success");
    });
  };


  // ---------- boot ----------
  (async () => {
    try { await enterApp(await api("me")); } catch (err) { if (!err.silent) showLogin(err.code === "network" ? err.message : ""); }
  })();

  return { api, switchView, openShipment };
}
