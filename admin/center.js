// Admin Control Center. All shipment data flows through the authenticated /api/admin endpoint; the browser never
// writes shipments, events, locations or audit entries to the database directly.
import { STATUS_META, STATUS_CODES, EXCEPTION_TYPES, VISIBILITY_KEYS, DEFAULT_VISIBILITY, statusTone, timeAgo, locationFreshness, LOCATION_STATE_LABELS } from "../shared/status.js";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso) => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(+d) ? "—" : d.toLocaleString(); };
const VIEWS = ["dashboard", "create", "shipments", "tracking", "events", "preview", "audit", "couriers", "clients", "settings"];
const TITLES = { dashboard: "Dashboard", create: "Create Shipment", shipments: "Shipments", tracking: "Live Tracking", events: "Tracking Events", preview: "Client View", audit: "Activity Logs", couriers: "Couriers", clients: "Clients", settings: "Settings" };
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
    if (WORKSPACE_VIEWS.includes(view)) renderWorkspace();
  }
  window.switchView = switchView;

  // ---------- dashboard ----------
  async function loadDashboard() {
    await guarded("dash", null, async () => {
      const [d, settings] = await Promise.all([api("stats"), state.settings ? Promise.resolve(state.settings) : api("settings")]);
      state.settings = settings;
      const t = d.totals;
      const first = !$("kpiGrid").childElementCount;
      const tile = (label, value, cls = "") => `<div class="kpi ${cls}" ${first ? "data-reveal" : ""}><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>`;
      $("kpiGrid").innerHTML = tile("Total shipments", t.total) + tile("Active", t.active) + tile("In transit", t.inTransit) + tile("Delivered", t.delivered, "good") +
        tile("Delayed", t.delayed, t.delayed ? "warn" : "") + tile("Exceptions", t.exceptions, t.exceptions ? "bad" : "") + tile("Cancelled", t.cancelled) + tile("Archived", t.archived) + (t.unclassified ? tile("Not yet classified", t.unclassified, "warn") : "");
      $("lastUpdated").textContent = `refreshed ${fmt(d.generatedAt)}`;
      const banner = $("migrationBanner");
      banner.classList.toggle("hidden", !d.needsMigration);
      if (d.needsMigration) $("migrationText").textContent = `${d.unmigrated} existing shipment(s) were created before the control center upgrade. Run the additive data migration so they are counted, searchable and filterable. No data is removed.`;
      const li = (html) => `<li>${html}</li>`;
      const codeBtn = (c) => `<button class="code" data-open="${esc(c)}" type="button">${esc(c)}</button>`;
      $("dashRecent").innerHTML = d.recentShipments.length ? d.recentShipments.map((s) => li(`<span>${codeBtn(s.id)} ${s.status ? pill(s.status) : ""}<br><small>${esc(s.origin || "")} → ${esc(s.destination || "")}</small></span><small>${esc(timeAgo(s.updatedAt) || "")}</small>`)).join("") : li("<small>No shipments yet.</small>");
      const act = (a) => li(`<span>${codeBtn(a.shipment)} <strong>${esc(a.action)}</strong><br><small>by ${esc(a.actor)}</small></span><small>${esc(timeAgo(a.at) || "")}</small>`);
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
  $("migrateBtn").addEventListener("click", () => guarded("migrate", $("migrateBtn"), async () => {
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
        serviceType: nv("serviceType"), clientRef: nv("clientRef"), origin: nv("origin"), destination: nv("destination"), location: nv("location"),
        distance: nv("distance"), fee: nv("fee"), etaDate: nv("etaDate") || undefined, notes: nv("notes"), internalNotes: nv("internalNotes"),
        package: packageFrom("pkg")
      };
      if (lat !== undefined || lng !== undefined) { shipment.latitude = lat; shipment.longitude = lng; }
      const { shipment: created } = await api("create", { shipment });
      host.showToast(`Shipment ${created.id} created`, "success");
      $("createForm").reset(); $("courierPrefixHint").textContent = "Tracking prefix: --";
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
        <td data-label="Tracking ID"><strong>${esc(s.id)}</strong>${s.archived ? ' <span class="pill neutral">archived</span>' : ""}</td>
        <td data-label="Courier">${esc(cr?.name || s.courier || "—")}</td>
        <td data-label="Status">${s.statusCode ? pill(s.statusCode) : `<span class="pill neutral">${esc(s.status || "Unknown")}</span>`}</td>
        <td data-label="Route">${esc(s.origin || "—")} → ${esc(s.destination || "—")}</td>
        <td data-label="Location">${esc(s.location || "—")}${s.hasCoordinates ? "" : ' <small style="color:#94a3b8">(no coords)</small>'}</td>
        <td data-label="Updated">${esc(timeAgo(s.updatedAt) || "—")}</td>
        <td data-label="Actions"><div class="row-actions">
          <button class="btn-action" data-act="track" data-code="${esc(s.id)}">Open</button>
          <button class="btn-action" data-act="edit" data-code="${esc(s.id)}">Edit</button>
          <button class="btn-action" data-act="preview" data-code="${esc(s.id)}">Preview</button>
          ${can("archive") ? `<button class="btn-action" data-act="${s.archived ? "unarchive" : "archive"}" data-code="${esc(s.id)}">${s.archived ? "Restore" : "Archive"}</button>` : ""}
          ${can("delete") ? `<button class="btn-action btn-danger" data-act="delete" data-code="${esc(s.id)}">Delete</button>` : ""}
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
      archive: () => setArchived(code, true), unarchive: () => setArchived(code, false), delete: () => deleteShipment(code) })[b.dataset.act]?.();
  });
  async function setArchived(code, archived) {
    if (archived && !confirm(`Archive ${code}? It will disappear from public tracking but all data is kept.`)) return;
    await guarded(`arch:${code}`, null, async () => { await api(archived ? "archive" : "unarchive", { code }); host.showToast(archived ? "Shipment archived" : "Shipment restored", "success"); runSearch(true); });
  }
  async function deleteShipment(code) {
    if (!confirm(`Permanently delete ${code} including its events and location history? Consider archiving instead. This cannot be undone.`)) return;
    await guarded(`del:${code}`, null, async () => { await api("delete", { code }); host.showToast("Shipment deleted", "success"); if (state.sel?.shipment.id === code) state.sel = null; runSearch(true); });
  }

  // ---------- edit modal ----------
  let editing = null;
  async function openEdit(code) {
    await guarded("edit-open", null, async () => {
      const full = await api("get", { code }); const s = full.shipment; editing = s;
      const set = (id, v) => { $(id).value = v ?? ""; };
      set("shipmentIdInput", s.id); $("shipmentStatusInput").innerHTML = statusOptions(s.statusCode); set("shipmentServiceInput", s.serviceType); set("shipmentClientRefInput", s.clientRef);
      set("shipmentCourierInput", s.courier); set("shipmentCourierTrackingNumberInput", s.courierTrackingNumber); set("shipmentOriginInput", s.origin);
      set("shipmentDestinationInput", s.destination); set("shipmentLocationInput", s.location); set("shipmentDistanceInput", s.distance);
      set("shipmentLatitudeInput", s.latitude); set("shipmentLongitudeInput", s.longitude); set("shipmentFeeInput", s.fee);
      const p = s.package || {}; set("shipmentPkgDescription", p.description); set("shipmentPkgWeight", p.weight); set("shipmentPkgDimensions", p.dimensions); set("shipmentPkgPieces", p.pieces);
      set("shipmentNotesInput", s.notes); set("shipmentInternalNotesInput", s.internalNotes);
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
      cmp("serviceType", nv("shipmentServiceInput")); cmp("clientRef", nv("shipmentClientRefInput")); cmp("courier", nv("shipmentCourierInput"));
      cmp("courierTrackingNumber", nv("shipmentCourierTrackingNumberInput")); cmp("origin", nv("shipmentOriginInput")); cmp("destination", nv("shipmentDestinationInput"));
      cmp("location", nv("shipmentLocationInput")); cmp("distance", nv("shipmentDistanceInput")); cmp("fee", nv("shipmentFeeInput"));
      cmp("notes", nv("shipmentNotesInput")); cmp("internalNotes", nv("shipmentInternalNotesInput"));
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
      ["ETA", esc(eta)], ["Exception", esc(s.exception ? `${EXCEPTION_TYPES[s.exception.type] || s.exception.type}` : "None recorded")]
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
    for (const id of [a, b]) $(id)?.addEventListener("blur", () => { if ($(a).value || $(b).value || $(err).textContent) checkCoords(a, b, err); });
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
    mutateSelected("vis", e.submitter, "setVisibility", { visibility }, "Client visibility saved");
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
  }
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
        `<tr><td data-label="When">${esc(fmt(a.at))}</td><td data-label="Admin">${esc(a.actor)}<br><small>${esc(a.role || "")}${a.via && a.via !== "admin" ? ` · ${esc(a.via)}` : ""}</small></td><td data-label="Action"><strong>${esc(a.action)}</strong></td><td data-label="Shipment">${esc(a.shipment || "—")}</td><td data-label="Change">${diff(a)}</td></tr>`).join("")}</tbody></table>`
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
          <div class="panel"><h4>Map</h4><p>${esc(s.map.provider)}</p>${s.map.issues?.length ? `<p class="hint" style="color:#b91c1c">${s.map.issues.map(esc).join("<br>")}</p>` : ""}<p class="hint">Fallbacks: ${esc((s.map.fallbacks || []).join(", "))}. To use a keyed provider set MAP_PROVIDER (maptiler, stadia or mapbox) and MAP_TILE_KEY (a public, domain-restricted key) in the server environment.</p></div>
          <div class="panel"><h4>Realtime</h4><p>${s.realtime.sse ? "Server-sent events" : "Polling only"} · fallback polling every ${Math.round(s.realtime.pollMs / 1000)}s</p></div>
          <div class="panel"><h4>Notifications</h4><p>${yes(s.notifications.configured)}</p><p class="hint">${s.notifications.configured ? `Providers: ${esc(s.notifications.providers.join(", "))}` : "No email/SMS/push provider is connected. Set NOTIFY_WEBHOOK_URL to forward events."}</p></div>
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
