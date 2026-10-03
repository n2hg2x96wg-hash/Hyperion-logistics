// Client tracking dashboard component. The SAME component renders the public tracking page and the
// admin "Preview client view", so what admins preview is exactly what clients get.
//
// Data comes only from the server's visibility-filtered view (see api/_lib/client-view.js).
// Realtime: Server-Sent Events -> adaptive polling fallback. One realtime session at a time, fully cleaned up on destroy().
import { timeAgo } from "../shared/status.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dtf = (() => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return null; } })();
const fmtDateTime = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : (dtf ? dtf.format(d) : d.toLocaleString()); };
const fmtDate = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); return Number.isNaN(+d) ? ymd : new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: "UTC" }).format(d); };

export function normalizeCode(input) {
  const code = String(input ?? "").replace(/\s+/g, "").toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

const ICON = { pin: "📍", box: "📦", route: "🧭", truck: "🚚", note: "📝", money: "💳", clock: "⏱️", flag: "🏁", warn: "⚠️" };

/**
 * @param {HTMLElement} root
 * @param {object} opts
 *   preview: boolean                       render the PREVIEW banner and disable realtime
 *   loadView: async (code, {version, signal}) => ({status:'ok'|'unchanged'|'notfound'|'invalid'|'error', view?, retryAfter?})
 *   realtime: boolean (default !preview)
 *   syncUrl: boolean   keep ?code= in the address bar
 *   onState: (state) => void
 */
export function createTracker(root, opts = {}) {
  const preview = !!opts.preview;
  const useRealtime = opts.realtime ?? !preview;
  const loadView = opts.loadView || defaultLoadView;
  const state = { code: null, view: null, phase: "idle", transport: "none", lastCheckedAt: null };
  let abort = null; let inflightCode = null; let map = null; let mapMod = null; let mapFailed = false;
  let es = null; let pollTimer = null; let pollDelay = 0; let esFailures = 0; let sseRetryAt = 0; let tick = null; let destroyed = false;
  let cfg = { pollMs: 20000, sse: true };
  const visibilityHandler = () => { if (!document.hidden && state.code && state.view && useRealtime) pollNow(); };

  root.classList.add("hx-tracker");
  root.setAttribute("aria-live", "polite");
  document.addEventListener("visibilitychange", visibilityHandler);
  fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c?.realtime) cfg = { ...cfg, ...c.realtime }; }).catch(() => {});

  // ---------- data loading ----------
  async function defaultLoadView(code, { version, signal } = {}) {
    let res;
    try { res = await fetch(`/api/track?code=${encodeURIComponent(code)}${version ? `&v=${encodeURIComponent(version)}` : ""}`, { signal, headers: { Accept: "application/json" } }); }
    catch (err) { if (err.name === "AbortError") return { status: "aborted" }; return { status: "error" }; }
    if (res.status === 404) return { status: "notfound" };
    if (res.status === 400) return { status: "invalid" };
    if (res.status === 429) return { status: "error", retryAfter: Number(res.headers.get("Retry-After")) || 30 };
    if (!res.ok) return { status: "error" };
    const body = await res.json().catch(() => null);
    if (!body) return { status: "error" };
    if (body.unchanged) return { status: "unchanged" };
    return { status: "ok", view: body.shipment };
  }

  /** User-initiated lookup. Duplicate in-flight searches for the same code are ignored. */
  async function track(input, { push = true } = {}) {
    const code = normalizeCode(input);
    if (!code) { stopRealtime(); state.code = null; state.view = null; setPhase("invalid"); renderMessage("invalid"); return; }
    if (inflightCode === code) return;
    if (abort) abort.abort();
    abort = new AbortController(); inflightCode = code;
    stopRealtime();
    const switching = state.code !== code;
    state.code = code;
    if (switching) { state.view = null; destroyMap(); }
    setPhase("loading"); if (switching || !state.view) renderSkeleton();
    if (push && opts.syncUrl) { try { const u = new URL(location.href); u.searchParams.set("code", code); history.replaceState(null, "", u); } catch { /* ignore */ } }
    const res = await loadView(code, { signal: abort.signal });
    if (destroyed || res.status === "aborted") return;
    inflightCode = null;
    state.lastCheckedAt = Date.now();
    if (res.status === "ok") { applyView(res.view); setPhase("ready"); startRealtime(); }
    else if (res.status === "notfound") { state.view = null; setPhase("notfound"); renderMessage("notfound"); }
    else if (res.status === "invalid") { state.view = null; setPhase("invalid"); renderMessage("invalid"); }
    else { state.view = null; setPhase("error"); renderMessage("error"); }
  }

  async function refresh() {
    if (!state.code) return;
    if (preview) { const res = await loadView(state.code, {}); if (res.status === "ok") applyView(res.view); return; }
    await pollNow(true);
  }

  async function pollNow(force = false) {
    if (!state.code || destroyed) return;
    clearTimeout(pollTimer);
    const code = state.code;
    const res = await loadView(code, { version: force ? null : state.view?.version });
    if (destroyed || code !== state.code) return;
    state.lastCheckedAt = Date.now();
    if (res.status === "ok") { applyView(res.view); pollDelay = 0; setTransport(state.transport === "live" ? "live" : "polling"); }
    else if (res.status === "unchanged") { pollDelay = 0; renderMeta(); if (state.transport === "offline") setTransport("polling"); }
    else if (res.status === "notfound") { state.view = null; setPhase("notfound"); renderMessage("notfound"); stopRealtime(); return; }
    else { // keep last valid data, back off
      pollDelay = Math.min((pollDelay || cfg.pollMs) * 2, 120000); if (res.retryAfter) pollDelay = Math.max(pollDelay, res.retryAfter * 1000);
      setTransport("offline");
    }
    if (state.transport !== "live") schedulePoll();
  }

  // ---------- realtime (SSE -> polling) ----------
  function startRealtime() {
    if (!useRealtime || destroyed || !state.code) return;
    stopRealtime();
    if (cfg.sse !== false && typeof EventSource !== "undefined" && Date.now() >= sseRetryAt) openStream();
    else { setTransport("polling"); schedulePoll(); }
  }

  function openStream() {
    const code = state.code;
    let gotMessage = false;
    try { es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}${state.view ? `&v=${encodeURIComponent(state.view.version)}` : ""}`); }
    catch { fallbackToPolling(); return; }
    const source = es;
    source.addEventListener("ready", () => { gotMessage = true; esFailures = 0; setTransport("live"); clearTimeout(pollTimer); });
    source.addEventListener("update", (e) => { try { applyView(JSON.parse(e.data).shipment); state.lastCheckedAt = Date.now(); } catch { /* ignore bad frame */ } });
    source.addEventListener("gone", () => { state.view = null; setPhase("notfound"); renderMessage("notfound"); stopRealtime(); });
    source.addEventListener("bye", () => { if (es === source) { source.close(); es = null; if (!destroyed && state.code === code) openStream(); } });
    source.onerror = () => {
      if (es !== source) return;
      source.close(); es = null;
      esFailures = gotMessage ? 0 : esFailures + 1;
      if (esFailures >= 2) { sseRetryAt = Date.now() + 120000; fallbackToPolling(); }
      else setTimeout(() => { if (!destroyed && state.code === code && !es) openStream(); }, 1500 * (esFailures + 1));
    };
  }

  function fallbackToPolling() { setTransport("polling"); schedulePoll(); }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (destroyed || !state.code) return;
    const base = pollDelay || cfg.pollMs || 20000;
    pollTimer = setTimeout(() => {
      if (document.hidden) { schedulePoll(); return; }                  // no background polling
      if (sseRetryAt && Date.now() >= sseRetryAt && !es && cfg.sse !== false && typeof EventSource !== "undefined") { esFailures = 0; sseRetryAt = 0; openStream(); return; }
      pollNow();
    }, base);
  }
  function stopRealtime() {
    if (es) { es.onerror = null; es.close(); es = null; }
    clearTimeout(pollTimer); pollTimer = null; pollDelay = 0; esFailures = 0;
    setTransport("none");
  }

  // ---------- rendering ----------
  function setPhase(p) { state.phase = p; root.dataset.phase = p; opts.onState?.({ ...state }); }
  function setTransport(t) { if (state.transport !== t) { state.transport = t; renderMeta(); } }

  function applyView(view) {
    const prev = state.view;
    if (prev && prev.version === view.version && state.phase === "ready") { state.view = view; renderMeta(); return; }
    state.view = view;
    render(view, !!prev);
  }

  function renderSkeleton() {
    root.innerHTML = `<div class="hx-card hx-skeleton" role="status" aria-label="Loading shipment"><div class="hx-sk hx-sk-a"></div><div class="hx-sk hx-sk-b"></div><div class="hx-sk hx-sk-map"></div><div class="hx-sk hx-sk-c"></div></div>`;
  }

  function renderMessage(kind) {
    destroyMap();
    const msg = {
      notfound: { icon: "🔎", title: "Tracking number not found.", body: "Check the number and try again. Tracking numbers look like <strong>HY-123456</strong>.", retry: false },
      invalid: { icon: "⌨️", title: "Please enter a valid tracking number.", body: "Use letters, numbers and dashes only (for example <strong>HY-123456</strong>).", retry: false },
      error: { icon: "📡", title: "We couldn't load tracking right now.", body: "Please check your connection and try again in a moment.", retry: true }
    }[kind];
    root.innerHTML = `<div class="hx-card hx-empty" role="alert"><div class="hx-empty-ico">${msg.icon}</div><h3>${msg.title}</h3><p>${msg.body}</p>${msg.retry ? '<button type="button" class="hx-btn" data-act="retry">Try again</button>' : ""}</div>`;
  }

  function stepsHtml(p) {
    const cur = p.steps.findIndex((s) => s.code === p.stage);
    const pct = p.cancelled ? 0 : (p.pct ?? 0);
    const items = p.steps.map((s, i) => {
      const cls = p.cancelled ? "" : i < cur ? "done" : i === cur ? (p.held ? "current held" : "current") : "";
      return `<li class="hx-step ${cls}" ${i === cur ? 'aria-current="step"' : ""}><span class="hx-step-dot"></span><span class="hx-step-label">${esc(s.label)}</span></li>`;
    }).join("");
    const now = cur >= 0 ? `<div class="hx-stage-now">${esc(p.steps[cur].label)}</div>` : "";
    return `<div class="hx-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div><ol class="hx-steps">${items}</ol>${now}`;
  }

  function etaHtml(eta) {
    if (!eta) return "";
    let label = "Estimated delivery"; let main = ""; let sub = "";
    if (eta.state === "delivered") { label = "Delivered"; main = eta.deliveredAt ? esc(fmtDateTime(eta.deliveredAt)) : "Delivered"; }
    else if (eta.state === "window") { main = `${esc(fmtDateTime(eta.start))}<small> – ${esc(fmtDateTime(eta.end))}</small>`; sub = eta.source && eta.source !== "admin" ? "Provided by carrier" : "Delivery window"; }
    else if (eta.state === "date") { main = esc(fmtDate(eta.date)); sub = eta.overdue ? "This date has passed — an update is pending." : (eta.source && eta.source !== "admin" ? "Provided by carrier" : ""); }
    else if (eta.state === "text") { main = esc(eta.text); }
    else { main = `<span class="hx-muted">${esc(eta.text || "Delivery estimate unavailable.")}</span>`; }
    return `<div class="hx-eta"><div class="hx-eta-label">${ICON.clock} ${label}</div><div class="hx-eta-main">${main}</div>${sub ? `<div class="hx-eta-sub">${esc(sub)}</div>` : ""}</div>`;
  }

  function infoItem(icon, label, value, extra = "") {
    if (!value) return "";
    return `<div class="hx-info"><div class="hx-info-label">${icon} ${esc(label)}</div><div class="hx-info-value">${value}</div>${extra}</div>`;
  }

  function timelineHtml(items) {
    if (!items) return "";
    if (!items.length) return `<section class="hx-card"><h3 class="hx-h">Shipment timeline</h3><p class="hx-muted">No tracking events have been recorded yet.</p></section>`;
    return `<section class="hx-card"><h3 class="hx-h">Shipment timeline</h3><ol class="hx-timeline">${items.map((t, i) => `
      <li class="hx-tl tone-${esc(t.tone)} ${i === 0 ? "latest" : ""}"><span class="hx-tl-dot"></span>
        <div class="hx-tl-body"><div class="hx-tl-title">${esc(t.title)}</div>
        ${t.location ? `<div class="hx-tl-loc">${ICON.pin} ${esc(t.location)}</div>` : ""}
        ${t.description ? `<div class="hx-tl-desc">${esc(t.description)}</div>` : ""}
        <div class="hx-tl-time">${esc(fmtDateTime(t.timestamp))}${t.source === "carrier_api" || t.source === "gps" ? ` · ${esc(t.sourceLabel)}` : ""}</div></div></li>`).join("")}</ol></section>`;
  }

  function render(v, isUpdate) {
    const pkg = v.package;
    const pkgText = pkg ? [pkg.description, pkg.weight, pkg.dimensions, pkg.pieces ? `${pkg.pieces} pc` : null].filter(Boolean).map(esc).join(" · ") : "";
    const carrier = v.carrier;
    const carrierBits = carrier ? [esc(carrier.name), carrier.serviceType ? esc(carrier.serviceType) : null].filter(Boolean).join(" · ") : "";
    const carrierExtra = carrier ? `<div class="hx-info-sub">${[carrier.trackingNumber ? `Carrier ref: ${esc(carrier.trackingNumber)}` : "", carrier.phone ? esc(carrier.phone) : "", carrier.website ? `<a href="${esc(carrier.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""].filter(Boolean).join(" · ")}</div>` : "";
    const loc = v.currentLocation;
    const locExtra = loc ? `<div class="hx-info-sub">${loc.updatedAt ? `Position updated ${esc(timeAgo(loc.updatedAt) || "")}` : ""}${loc.sourceLabel ? ` · ${esc(loc.sourceLabel)}` : ""}</div>` : "";

    root.innerHTML = `
      ${preview ? `<div class="hx-preview-banner" role="note"><strong>PREVIEW MODE</strong> — this is exactly what the client sees for this tracking number. Nothing here is editable.</div>` : ""}
      <section class="hx-card hx-header">
        <div class="hx-header-top">
          <div><div class="hx-kicker">Tracking number</div><h2 class="hx-code">${esc(v.trackingCode)}</h2></div>
          <span class="hx-pill tone-${esc(v.status.tone)}">${esc(v.status.label)}</span>
        </div>
        <div class="hx-meta" data-slot="meta"></div>
        ${v.exception ? `<div class="hx-exception" role="alert">${ICON.warn} <div><strong>${esc(v.exception.label)}</strong>${v.exception.note ? `<div>${esc(v.exception.note)}</div>` : ""}${v.exception.recordedAt ? `<small>Recorded ${esc(fmtDateTime(v.exception.recordedAt))}</small>` : ""}</div></div>` : ""}
        ${v.progress ? `<div class="hx-progress">${v.progress.cancelled ? '<p class="hx-muted">This shipment was cancelled.</p>' : stepsHtml(v.progress)}${v.progress.held ? '<p class="hx-muted hx-held">Progress is paused at the last confirmed stage while this issue is resolved.</p>' : ""}</div>` : ""}
      </section>
      ${v.map ? `<section class="hx-card hx-mapcard"><div class="hx-map-head"><h3 class="hx-h">Live tracking map</h3><div class="hx-legend"><span><i class="hx-lg hx-m-origin"></i>Origin</span><span><i class="hx-lg hx-m-current"></i>Current</span><span><i class="hx-lg hx-m-dest"></i>Destination</span></div></div><div class="hx-map" data-slot="map" role="region" aria-label="Shipment map"></div><div class="hx-map-note" data-slot="mapnote"></div></section>` : ""}
      <section class="hx-grid">
        ${v.eta ? `<div class="hx-card hx-eta-card">${etaHtml(v.eta)}</div>` : ""}
        <div class="hx-card hx-infos">
          ${infoItem(ICON.pin, "Current location", loc ? esc(loc.name) : "", locExtra)}
          ${infoItem(ICON.flag, "Origin", v.origin ? esc(v.origin) : "")}
          ${infoItem(ICON.route, "Destination", v.destination ? esc(v.destination) : "")}
          ${infoItem(ICON.truck, "Carrier", carrierBits, carrierExtra)}
          ${infoItem(ICON.box, "Package", pkgText, pkg?.distance ? `<div class="hx-info-sub">Distance: ${esc(pkg.distance)} km</div>` : "")}
          ${infoItem(ICON.money, "Shipping fee", v.fee ? esc(v.fee) : "")}
        </div>
      </section>
      ${v.notes ? `<section class="hx-card"><h3 class="hx-h">${ICON.note} Shipment notes</h3><p class="hx-notes">${esc(v.notes)}</p></section>` : ""}
      ${timelineHtml(v.timeline)}`;
    renderMeta();
    if (v.map) mountMap(v.map);
    else destroyMap();
    if (isUpdate) root.classList.add("hx-flash"), setTimeout(() => root.classList.remove("hx-flash"), 1200);
  }

  function renderMeta() {
    const slot = root.querySelector('[data-slot="meta"]'); const v = state.view;
    if (!slot || !v) return;
    const ago = v.lastUpdated ? timeAgo(v.lastUpdated) : null;
    const t = state.transport;
    const live = preview ? "" : t === "live" ? '<span class="hx-live live"><i></i>Live</span>'
      : t === "polling" ? '<span class="hx-live poll"><i></i>Auto-refreshing</span>'
      : t === "offline" ? '<span class="hx-live off"><i></i>Offline — showing last known update</span>' : "";
    slot.innerHTML = `<span data-ago="${esc(v.lastUpdated || "")}">${ago ? `Updated ${esc(ago)}` : "Update time unavailable"}${v.lastUpdated ? ` <small title="${esc(v.lastUpdated)}">(${esc(fmtDateTime(v.lastUpdated))})</small>` : ""}</span>${live}
      ${preview ? "" : '<button type="button" class="hx-link" data-act="refresh">Refresh</button>'}`;
  }

  // ---------- map ----------
  async function mountMap(data) {
    const el = root.querySelector('[data-slot="map"]'); const note = root.querySelector('[data-slot="mapnote"]');
    if (!el) return;
    const hasAny = data.current || data.origin || data.destination;
    if (!hasAny) { el.classList.add("hx-map-empty"); el.innerHTML = '<div class="hx-map-msg">Map unavailable — no coordinates have been recorded for this shipment yet.</div>'; return; }
    if (!data.current && note) note.textContent = "Live position not available yet. Showing the planned route.";
    else if (note) note.textContent = data.current.updatedAt ? `Last position update ${fmtDateTime(data.current.updatedAt)} · ${data.current.sourceLabel}. Route is drawn between recorded points.` : "Route is drawn between recorded points.";
    if (map && map.el === el) { map.api.update(data); return; }
    destroyMap();
    if (mapFailed) { fallbackMap(el, data); return; }
    try {
      mapMod = mapMod || await import("./map.js");
      const api = await mapMod.createMap(el, { onStatus: (s) => { if (s === "tiles-unavailable" && note) note.textContent = "Map background unavailable. Showing route markers only."; } });
      if (destroyed || !el.isConnected) { api.destroy(); return; }
      map = { el, api }; api.update(state.view?.map || data);
    } catch { mapFailed = true; fallbackMap(el, data); }
  }
  function fallbackMap(el, data) {
    el.classList.add("hx-map-empty");
    const bits = [data.current && `Current: ${data.current.name || `${data.current.lat.toFixed(3)}, ${data.current.lng.toFixed(3)}`}`, data.originLabel && `Origin: ${data.originLabel}`, data.destinationLabel && `Destination: ${data.destinationLabel}`].filter(Boolean);
    el.innerHTML = `<div class="hx-map-msg">The interactive map is temporarily unavailable.<br>${bits.map(esc).join("<br>")}</div>`;
  }
  function destroyMap() { if (map) { map.api.destroy(); map = null; } }

  // ---------- events ----------
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "refresh") refresh();
    if (act === "retry" && state.code) { const c = state.code; state.code = null; inflightCode = null; track(c); }
  });
  tick = setInterval(() => { if (!state.view) return; const el = root.querySelector("[data-ago]"); const iso = el?.dataset.ago; if (el && iso) { const a = timeAgo(iso); if (a) el.firstChild.textContent = `Updated ${a}`; } }, 30000);

  return {
    track, refresh, getState: () => ({ ...state }),
    setView(view) { state.code = view.trackingCode; applyView(view); setPhase("ready"); },
    clear() { stopRealtime(); destroyMap(); state.code = null; state.view = null; inflightCode = null; root.innerHTML = ""; setPhase("idle"); },
    destroy() {
      destroyed = true; stopRealtime(); destroyMap(); clearInterval(tick);
      document.removeEventListener("visibilitychange", visibilityHandler); if (abort) abort.abort(); root.innerHTML = "";
    }
  };
}
