// Client tracking dashboard component. The SAME component renders the public tracking page and the
// admin "Preview client view", so what admins preview is exactly what clients get.
//
// Data comes only from the server's visibility-filtered view (see api/_lib/client-view.js).
// Realtime: Server-Sent Events -> adaptive polling fallback. One realtime session at a time, fully cleaned up on destroy().
//
// Privacy: the active tracking code lives ONLY in this closure (memory). It is never written to localStorage,
// sessionStorage, cookies or the address bar. clear()/expire() wipe it together with the rendered shipment.
import { timeAgo, locationFreshness, LOCATION_STATE_LABELS } from "../shared/status.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dtf = (() => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return null; } })();
const fmtDateTime = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : (dtf ? dtf.format(d) : d.toLocaleString()); };
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmtDate = (ymd, style = "full") => { const d = new Date(`${ymd}T00:00:00Z`); return Number.isNaN(+d) ? ymd : new Intl.DateTimeFormat(undefined, { dateStyle: style, timeZone: "UTC" }).format(d); };

export function normalizeCode(input) {
  const code = String(input ?? "").replace(/\s+/g, "").toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

const ICON = { pin: "📍", box: "📦", route: "🧭", truck: "🚚", note: "📝", money: "💳", clock: "⏱️", flag: "🏁", warn: "⚠️" };

// Customer Support: a direct email contact (opens the visitor's own email app). Shown with every shipment view,
// including the homepage tracker and the admin "Client View" preview, so clients can always find it.
export const SUPPORT_EMAIL = "hyperionlogistics.com@gmail.com";
const SUPPORT_SUBJECT = "Hyperion Logistics — Customer Inquiry";
export const supportHref = (code) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}${code ? `&body=${encodeURIComponent(`Tracking number: ${code}\n\n`)}` : ""}`;
const MAIL_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>';
export function supportCardHtml(code, attrs = "") {
  const href = esc(supportHref(code));
  return `<section class="hx-support-card hx-support-inline" id="hx-support" aria-labelledby="hxSupportH" ${attrs}>
    <span class="hx-support-icon">${MAIL_SVG}</span>
    <div class="hx-support-text"><h3 id="hxSupportH">Customer Support <span>Need help with your shipment?</span></h3>
      <p>Email our support team${code ? " — your tracking number is added to the message for you" : " and include your tracking number"}.</p>
      <a class="hx-support-email" href="${href}">${SUPPORT_EMAIL}</a></div>
    <a class="hx-support-btn hx-press" href="${href}">Contact Customer Support</a></section>`;
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 *   preview: boolean                       render the PREVIEW banner and disable realtime
 *   loadView: async (code, {version, signal}) => ({status:'ok'|'unchanged'|'notfound'|'invalid'|'error', view?, retryAfter?})
 *   realtime: boolean (default !preview)
 *   syncUrl: ignored (kept for compatibility). The tracking code is never written to the URL.
 *   onState: (state) => void
 */
export function createTracker(root, opts = {}) {
  const preview = !!opts.preview;
  const useRealtime = opts.realtime ?? !preview;
  const loadView = opts.loadView || defaultLoadView;
  const state = { code: null, view: null, phase: "idle", transport: "none", lastCheckedAt: null };
  let abort = null; let inflightCode = null; let map = null; let mapMod = null; let mapFailed = false; let mapToken = 0;
  let es = null; let pollTimer = null; let pollDelay = 0; let esFailures = 0; let sseRetryAt = 0; let tick = null; let destroyed = false;
  let serverOffset = 0; let renderedCode = null;
  let cfg = { pollMs: 20000, sse: true };
  const visibilityHandler = () => { if (!document.hidden && state.code && state.view && useRealtime) pollNow(); };

  root.classList.add("hx-tracker");
  root.setAttribute("aria-live", "polite");
  document.addEventListener("visibilitychange", visibilityHandler);
  fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c?.realtime) cfg = { ...cfg, ...c.realtime }; }).catch(() => {});

  // ---------- data loading ----------
  async function defaultLoadView(code, { version, signal } = {}) {
    let res;
    try { res = await fetch(`/api/track?code=${encodeURIComponent(code)}${version ? `&v=${encodeURIComponent(version)}` : ""}`, { signal, cache: "no-store", headers: { Accept: "application/json" } }); }
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

  /** User-initiated lookup. Duplicate in-flight searches for the same code are ignored. Every lookup is verified by the server. */
  async function track(input) {
    const code = normalizeCode(input);
    if (!code) { reset(); setPhase("invalid"); renderMessage("invalid"); return; }
    if (inflightCode === code) return;
    if (abort) abort.abort();
    abort = new AbortController(); inflightCode = code;
    stopRealtime();
    const switching = state.code !== code;
    state.code = code;
    if (switching) { state.view = null; destroyMap(); renderedCode = null; }
    setPhase("loading"); if (switching || !state.view) renderSkeleton();
    const res = await loadView(code, { signal: abort.signal });
    if (destroyed || res.status === "aborted" || state.code !== code) return;
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
    source.addEventListener("update", (e) => { if (es !== source || state.code !== code) return; try { applyView(JSON.parse(e.data).shipment); state.lastCheckedAt = Date.now(); } catch { /* ignore bad frame */ } });
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

  // ---------- location freshness (re-evaluated as time passes, same rule as the server) ----------
  function locState(v = state.view) {
    const ls = v?.locationState;
    if (!ls) return null;
    const s = locationFreshness({ updatedAt: ls.updatedAt, hasCoordinates: ls.hasCoordinates, hasName: !!v.currentLocation,
      statusCode: v.status?.code, now: Date.now() + serverOffset, liveMs: ls.liveMs, recentMs: ls.recentMs });
    return { ...ls, state: s, label: LOCATION_STATE_LABELS[s] };
  }
  const badge = (ls) => (ls ? `<span class="hx-loc-badge is-${esc(ls.state)}" data-slot="locbadge"><i></i>${esc(ls.label)}</span>` : "");

  // ---------- rendering ----------
  function setPhase(p) { state.phase = p; root.dataset.phase = p; opts.onState?.({ ...state }); }
  function setTransport(t) { if (state.transport !== t) { state.transport = t; renderMeta(); } }

  function applyView(view) {
    const prev = state.view;
    const t = Date.parse(view?.serverTime || ""); if (Number.isFinite(t)) serverOffset = t - Date.now();
    if (prev && prev.version === view.version && state.phase === "ready") { state.view = view; renderMeta(); return; }
    state.view = view;
    render(view, !!prev && renderedCode === view.trackingCode);
  }

  function renderSkeleton() {
    destroyMap();
    root.innerHTML = `<div class="hx-card hx-skeleton" role="status" aria-label="Loading shipment"><div class="hx-sk hx-sk-a"></div><div class="hx-sk hx-sk-b"></div><div class="hx-sk hx-sk-map"></div><div class="hx-sk hx-sk-c"></div></div>`;
  }

  const MESSAGES = {
    notfound: { icon: "🔎", title: "Tracking number not found.", body: "Check the number and try again. Tracking numbers look like <strong>HY-123456</strong>.", retry: false },
    invalid: { icon: "⌨️", title: "Please enter a valid tracking number.", body: "Use letters, numbers and dashes only (for example <strong>HY-123456</strong>).", retry: false },
    error: { icon: "📡", title: "We couldn't load tracking right now.", body: "Please check your connection and try again in a moment.", retry: true },
    expired: { icon: "🔒", title: "Your tracking session has ended.", body: "For your privacy, shipment details are cleared when you leave, reload or stay inactive. Enter your tracking number again to continue.", retry: false }
  };
  function renderMessage(kind) {
    destroyMap(); renderedCode = null;
    const msg = MESSAGES[kind];
    root.innerHTML = `<div class="hx-card hx-empty" role="alert" data-reveal><div class="hx-empty-ico">${msg.icon}</div><h3>${msg.title}</h3><p>${msg.body}</p>${msg.retry ? '<button type="button" class="hx-btn" data-act="retry">Try again</button>' : ""}</div>`;
  }

  function stepsHtml(p) {
    const cur = p.steps.findIndex((s) => s.code === p.stage);
    const pct = p.cancelled ? 0 : (p.pct ?? 0);
    const items = p.steps.map((s, i) => {
      const cls = p.cancelled ? "" : i < cur ? "done" : i === cur ? (p.held ? "current held" : "current") : "";
      return `<li class="hx-step ${cls}" ${i === cur ? 'aria-current="step"' : ""}><span class="hx-step-dot"></span><span class="hx-step-label">${esc(s.label)}</span></li>`;
    }).join("");
    const now = cur >= 0 ? `<div class="hx-stage-now">${esc(p.steps[cur].label)}</div>` : "";
    const count = cur >= 0 ? `<div class="hx-progress-head"><span>Stage <strong data-count="${cur + 1}">${cur + 1}</strong> of ${p.steps.length}</span><span><strong data-count="${Math.round(pct)}">${Math.round(pct)}</strong>% of the journey</span></div>` : "";
    return `${count}<div class="hx-progress-bar" role="progressbar" aria-label="Shipment progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="--hx-p:${pct / 100}"></span></div><ol class="hx-steps">${items}</ol>${now}`;
  }

  /** Compact delivery estimate for the key-facts strip. */
  function etaFact(eta) {
    if (!eta) return "";
    let label = "Estimated delivery"; let main = ""; let sub = ""; let cls = "";
    if (eta.state === "delivered") { label = "Delivered"; main = eta.deliveredAt ? esc(fmtDateTime(eta.deliveredAt)) : "Delivered"; cls = "is-delivered"; }
    else if (eta.state === "window") { main = `${esc(fmtDateTime(eta.start))}<small> – ${esc(fmtDateTime(eta.end))}</small>`; sub = eta.source && eta.source !== "admin" ? "Provided by carrier" : "Delivery window"; }
    else if (eta.state === "date") { main = esc(fmtDate(eta.date, "medium")); sub = eta.overdue ? "This date has passed — an update is pending." : (eta.source && eta.source !== "admin" ? "Provided by carrier" : fmtDate(eta.date).split(",")[0]); if (eta.overdue) cls = "is-overdue"; }
    else if (eta.state === "text") { main = esc(eta.text); }
    else { main = `<span class="hx-eta-na">${esc(eta.text || "Delivery estimate unavailable.")}</span>`; cls = "is-na"; }
    return `<div class="hx-fact hx-fact-eta ${cls}"><div class="hx-fact-label">${ICON.clock} ${label}</div><div class="hx-fact-value">${main}</div>${sub ? `<div class="hx-fact-sub">${esc(sub)}</div>` : ""}</div>`;
  }

  function infoItem(icon, label, value, extra = "", attrs = "") {
    if (!value) return "";
    return `<div class="hx-info" ${attrs}><div class="hx-info-label">${icon} ${esc(label)}</div><div class="hx-info-value">${value}</div>${extra}</div>`;
  }

  function timelineHtml(items, reveal) {
    if (!items) return "";
    if (!items.length) return `<section class="hx-card" ${reveal ? "data-reveal" : ""}><h3 class="hx-h">Shipment timeline</h3><p class="hx-muted">No tracking events have been recorded yet.</p></section>`;
    return `<section class="hx-card" ${reveal ? "data-reveal" : ""}><h3 class="hx-h">Shipment timeline <small class="hx-h-sub"><span data-count="${items.length}">${items.length}</span> update${items.length === 1 ? "" : "s"} · latest first</small></h3><ol class="hx-timeline" ${reveal ? "data-reveal-stagger" : ""}>${items.map((t, i) => `
      <li class="hx-tl tone-${esc(t.tone)} ${i === 0 ? "latest" : ""}" ${reveal ? "data-reveal" : ""}><span class="hx-tl-dot"></span>
        <div class="hx-tl-body"><div class="hx-tl-title">${esc(t.title)}${i === 0 ? ' <span class="hx-tl-tag">Latest</span>' : ""}</div>
        ${t.location ? `<div class="hx-tl-loc">${ICON.pin} ${esc(t.location)}</div>` : ""}
        ${t.description ? `<div class="hx-tl-desc">${esc(t.description)}</div>` : ""}
        <div class="hx-tl-time"><time datetime="${esc(t.timestamp)}">${esc(fmtDateTime(t.timestamp))}</time>${t.source === "carrier_api" || t.source === "gps" ? ` · ${esc(t.sourceLabel)}` : ""}</div></div></li>`).join("")}</ol></section>`;
  }

  function render(v, isUpdate) {
    const reveal = !isUpdate; // entrance motion only for the first render of a shipment, never on live updates
    const R = (kind = "") => (reveal ? `data-reveal${kind ? `="${kind}"` : ""}` : "");
    const pkg = v.package;
    const pkgText = pkg ? [pkg.description, pkg.weight, pkg.dimensions, pkg.pieces ? `${pkg.pieces} pc` : null].filter(Boolean).map(esc).join(" · ") : "";
    const carrier = v.carrier;
    const carrierName = carrier ? `${esc(carrier.name)}${carrier.custom ? ' <span class="hx-tag" title="Custom/internal carrier arrangement, not an official carrier service">Custom carrier</span>' : ""}` : "";
    const carrierBits = carrier ? [esc(carrier.name), carrier.serviceType ? esc(carrier.serviceType) : null].filter(Boolean).join(" · ") : "";
    const carrierExtra = carrier ? `<div class="hx-info-sub">${[carrier.trackingNumber ? `Carrier ref: ${esc(carrier.trackingNumber)}` : "", carrier.phone ? esc(carrier.phone) : "", carrier.website ? `<a href="${esc(carrier.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : "", carrier.trackingUrl ? `<a href="${esc(carrier.trackingUrl)}" target="_blank" rel="noopener noreferrer">Track on carrier site</a>` : "", carrier.custom ? "Custom carrier arrangement" : ""].filter(Boolean).join(" · ")}</div>` : "";
    const loc = v.currentLocation; const ls = locState(v);
    const ago = v.lastUpdated ? timeAgo(v.lastUpdated, Date.now() + serverOffset) : null;

    // Keep the live map element (and its Leaflet instance) across re-renders: updates move markers, never rebuild the map.
    const keepMap = v.map && map ? map.el : null;
    if (keepMap) keepMap.remove();

    root.innerHTML = `
      ${preview ? `<div class="hx-preview-banner" role="note"><strong>PREVIEW MODE</strong> — this is exactly what the client sees for this tracking number. Nothing here is editable.</div>` : ""}
      <section class="hx-card hx-header" ${R()}>
        <div class="hx-header-top">
          <div class="hx-id"><div class="hx-kicker">Tracking number</div><h2 class="hx-code">${esc(v.trackingCode)}</h2></div>
          <div class="hx-status"><div class="hx-kicker">Current status</div><span class="hx-pill tone-${esc(v.status.tone)}${v.status.code && !["DELIVERED", "CANCELLED"].includes(v.status.code) ? " is-active" : ""}"><i aria-hidden="true"></i>${esc(v.status.label)}</span></div>
        </div>
        <div class="hx-facts" ${reveal ? "data-reveal-stagger" : ""}>
          ${ls ? `<div class="hx-fact hx-fact-loc" ${R()}><div class="hx-fact-label">${ICON.pin} ${ls.state === "live" ? "Current location" : ls.state === "none" ? "Location" : "Last known location"}</div><div class="hx-fact-value">${loc ? esc(loc.name) : '<span class="hx-muted">Awaiting location update</span>'}</div><div class="hx-fact-sub">${badge(ls)}${ls.updatedAt ? ` <span class="hx-loc-time">Recorded <time datetime="${esc(ls.updatedAt)}">${esc(fmtDateTime(ls.updatedAt))}</time></span>` : ls.state !== "none" ? ' <span class="hx-loc-time">Recorded time not available</span>' : ""}</div></div>` : ""}
          ${carrier ? `<div class="hx-fact" ${R()}><div class="hx-fact-label">${ICON.truck} Carrier</div><div class="hx-fact-value">${carrierName}</div>${carrier.trackingNumber ? `<div class="hx-fact-sub">Ref ${esc(carrier.trackingNumber)}</div>` : ""}</div>` : ""}
          <div class="hx-fact" ${R()}><div class="hx-fact-label">🕒 Last updated</div><div class="hx-fact-value" data-ago="${esc(v.lastUpdated || "")}">${ago ? esc(ago[0].toUpperCase() + ago.slice(1)) : "Unavailable"}</div>${v.lastUpdated ? `<div class="hx-fact-sub"><time datetime="${esc(v.lastUpdated)}">${esc(fmtDateTime(v.lastUpdated))}</time></div>` : ""}</div>
          ${v.eta ? `<div ${R()} class="hx-fact-wrap">${etaFact(v.eta)}</div>` : ""}
        </div>
        <div class="hx-meta" data-slot="meta"></div>
        ${v.exception ? `<div class="hx-exception" role="alert">${ICON.warn} <div><strong>${esc(v.exception.label)}</strong>${v.exception.note ? `<div>${esc(v.exception.note)}</div>` : ""}${v.exception.recordedAt ? `<small>Recorded ${esc(fmtDateTime(v.exception.recordedAt))}</small>` : ""}</div></div>` : ""}
        ${v.progress ? `<div class="hx-progress">${v.progress.cancelled ? '<p class="hx-muted">This shipment was cancelled.</p>' : stepsHtml(v.progress)}${v.progress.held ? '<p class="hx-muted hx-held">Progress is paused at the last confirmed stage while this issue is resolved.</p>' : ""}</div>` : ""}
      </section>
      ${v.map ? `<section class="hx-card hx-mapcard" ${R("fade")}><div class="hx-map-head"><h3 class="hx-h" data-slot="maptitle">${ls?.state === "live" ? "Live tracking map" : "Shipment map"}</h3>${badge(ls)}</div><div class="hx-map" data-slot="map" role="region" aria-label="Shipment map"></div><div class="hx-map-foot"><div class="hx-legend"><span><i class="hx-lg hx-m-origin"></i>Origin</span><span><i class="hx-lg hx-m-current"></i>Shipment</span><span><i class="hx-lg hx-m-dest"></i>Destination</span><span><i class="hx-lg-line"></i>Recorded route</span><span><i class="hx-lg-line dashed"></i>Remaining</span></div><div class="hx-map-note" data-slot="mapnote"></div></div></section>` : ""}
      ${timelineHtml(v.timeline, reveal)}
      <section class="hx-card hx-details" ${R()}>
        <h3 class="hx-h">Shipment details</h3>
        <div class="hx-infos" ${reveal ? "data-reveal-stagger" : ""}>
          ${infoItem(ICON.flag, "Origin", v.origin ? esc(v.origin) : "", "", R())}
          ${infoItem(ICON.route, "Destination", v.destination ? esc(v.destination) : "", "", R())}
          ${infoItem(ICON.truck, "Carrier", carrierBits, carrierExtra, R())}
          ${infoItem(ICON.box, "Package", pkgText, pkg?.distance ? `<div class="hx-info-sub">Distance: ${esc(pkg.distance)} km</div>` : "", R())}
          ${infoItem(ICON.money, "Shipping fee", v.fee ? esc(v.fee) : "", "", R())}
        </div>
      </section>
      ${v.notes ? `<section class="hx-card" ${R()}><h3 class="hx-h">${ICON.note} Shipment notes</h3><p class="hx-notes">${esc(v.notes)}</p></section>` : ""}
      ${supportCardHtml(v.trackingCode, R())}`;
    renderedCode = v.trackingCode;
    if (keepMap) root.querySelector('[data-slot="map"]')?.replaceWith(keepMap);
    renderMeta();
    if (reveal) animateCounters();
    if (v.map) mountMap(v.map);
    else destroyMap();
    if (isUpdate) { root.classList.add("hx-flash"); setTimeout(() => root.classList.remove("hx-flash"), 1200); }
  }

  /** Counts numbers up once when they scroll into view (bounded ~700ms, then stops). Final values are in the HTML already. */
  let counterIO = null;
  function animateCounters() {
    if (reducedMotion() || typeof IntersectionObserver === "undefined" || !document.documentElement.classList.contains("hx-motion")) return;
    counterIO?.disconnect();
    counterIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return; counterIO.unobserve(e.target);
      const el = e.target; const to = Number(el.dataset.count); if (!Number.isFinite(to) || to <= 0) return;
      const start = performance.now(); const dur = 700;
      const step = (t) => { const k = Math.min(1, (t - start) / dur); el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
      el.textContent = "0"; requestAnimationFrame(step);
    }), { threshold: 0.4 });
    root.querySelectorAll("[data-count]").forEach((el) => counterIO.observe(el));
  }

  function renderMeta() {
    const slot = root.querySelector('[data-slot="meta"]'); const v = state.view;
    if (!slot || !v) return;
    const t = state.transport;
    const secs = Math.round((pollDelay || cfg.pollMs || 20000) / 1000);
    // Connection state only. Whether the SHIPMENT is live is the location badge's job, based on recorded data.
    const conn = preview ? '<span class="hx-conn poll"><i></i>Preview: updates when you refresh</span>' : t === "live" ? '<span class="hx-conn ok"><i></i>Auto-updating</span>'
      : t === "polling" ? `<span class="hx-conn poll"><i></i>Auto-updating · checks every ${secs}s</span>`
      : t === "offline" ? '<span class="hx-conn off"><i></i>Offline — showing last known update</span>' : '<span class="hx-conn poll"><i></i>Connecting for updates…</span>';
    const checked = state.lastCheckedAt ? `<small class="hx-checked">Checked ${esc(new Date(state.lastCheckedAt + serverOffset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small>` : "";
    slot.innerHTML = `<div class="hx-meta-status">${conn}${checked}</div><div class="hx-actions"><button type="button" class="hx-btn-sec hx-press" data-act="refresh" aria-label="Refresh tracking now"><span aria-hidden="true">↻</span> Refresh</button><a class="hx-btn-sec hx-press" href="#hx-support" data-act="support"><span aria-hidden="true">✉</span> Support</a></div>`;
  }

  /** Re-evaluate "Live" / "Recently updated" / "Last known" as time passes without new data. */
  function refreshFreshness() {
    const v = state.view; if (!v) return;
    const ls = locState(v); if (!ls) return;
    root.querySelectorAll('[data-slot="locbadge"]').forEach((el) => { if (!el.classList.contains(`is-${ls.state}`)) el.outerHTML = badge(ls); });
    const title = root.querySelector('[data-slot="maptitle"]'); if (title) title.textContent = ls.state === "live" ? "Live tracking map" : "Shipment map";
    const agoEl = root.querySelector("[data-ago]"); const iso = agoEl?.dataset.ago;
    if (agoEl && iso) { const a = timeAgo(iso, Date.now() + serverOffset); if (a) agoEl.textContent = a[0].toUpperCase() + a.slice(1); }
    if (v.map) { mapNote(v.map, ls); if (map && v.map.current && v.map.current.state !== ls.state) map.api.update(withState(v.map, ls)); }
  }
  const withState = (data, ls) => (data.current ? { ...data, current: { ...data.current, state: ls?.state || "last" } } : data);

  // ---------- map ----------
  function mapNote(data, ls) {
    const note = root.querySelector('[data-slot="mapnote"]'); if (!note) return;
    const c = data.current; const when = c?.updatedAt ? fmtDateTime(c.updatedAt) : null;
    const src = c?.sourceLabel ? ` · ${c.sourceLabel}` : "";
    let text;
    if (c && ls?.state === "live") text = `Live — position recorded ${timeAgo(c.updatedAt, Date.now() + serverOffset)} (${when})${src}.`;
    else if (c && ls?.state === "recent") text = `Recently updated — live location unavailable. Last recorded position ${when}${src}.`;
    else if (c) text = `Live location unavailable — last recorded location shown${when ? ` (${when})` : ""}${src}.`;
    else if (data.trail?.length) text = "Live location unavailable — showing the most recent recorded route points.";
    else if (data.origin || data.destination) text = "No location has been recorded yet — showing origin and destination only.";
    else text = "";
    note.textContent = text;
  }

  async function mountMap(data) {
    const el = root.querySelector('[data-slot="map"]');
    if (!el) return;
    const ls = locState();
    mapNote(data, ls);
    const hasAny = data.current || data.origin || data.destination || data.trail?.length;
    if (!hasAny) { destroyMap(); el.classList.add("hx-map-empty"); el.innerHTML = '<div class="hx-map-msg"><strong>Awaiting location update</strong><br>No coordinates have been recorded for this shipment yet. The map will appear as soon as a location is recorded.</div>'; return; }
    if (map && map.el === el) { map.api.update(withState(data, ls)); if (el.querySelector(".hx-map-fallback")) showMapUnavailable(el, data); return; }
    destroyMap();
    if (mapFailed) { fallbackMap(el, data); return; }
    const token = ++mapToken;
    try {
      mapMod = mapMod || await import("./map.js");
      const api = await mapMod.createMap(el, { onStatus: (s) => {
        // No tiles from any provider: never leave a blank map. Show a clear panel with the recorded facts instead.
        if (s === "tiles-unavailable") showMapUnavailable(el, state.view?.map || data);
        if (s === "tiles-ok") el.querySelector(".hx-map-fallback")?.remove();
      } });
      if (destroyed || token !== mapToken || !el.isConnected) { api.destroy(); return; }
      map = { el, api }; api.update(withState(state.view?.map || data, locState()));
    } catch { mapFailed = true; fallbackMap(el, data); }
  }
  function mapFallbackHtml(data) {
    const v = state.view; const ls = locState(v); const c = data?.current;
    const rows = [
      ["Last known location", c ? (c.name || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`) : (v?.currentLocation?.name || "Awaiting location update")],
      c ? ["Coordinates", `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`] : null,
      ["Recorded", c?.updatedAt ? fmtDateTime(c.updatedAt) : (ls?.updatedAt ? fmtDateTime(ls.updatedAt) : "Time not available")],
      ["Status", v?.status?.label || ""],
      data?.originLabel ? ["Origin", data.originLabel] : null,
      data?.destinationLabel ? ["Destination", data.destinationLabel] : null
    ].filter((r) => r && r[1]);
    return `<div class="hx-map-fallback" role="status"><div class="hx-map-fallback-ico" aria-hidden="true">🗺️</div><strong>Map location temporarily unavailable.</strong><dl>${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join("")}</dl></div>`;
  }
  function showMapUnavailable(el, data) {
    if (!el.isConnected) return;
    el.querySelector(".hx-map-fallback")?.remove();
    el.insertAdjacentHTML("beforeend", mapFallbackHtml(data));
  }
  function fallbackMap(el, data) {
    el.classList.add("hx-map-empty");
    el.innerHTML = mapFallbackHtml(data);
  }
  function destroyMap() { mapToken++; if (map) { map.api.destroy(); map = null; } }

  function reset() {
    if (abort) abort.abort();
    abort = null; inflightCode = null;
    stopRealtime(); destroyMap();
    state.code = null; state.view = null; state.lastCheckedAt = null; renderedCode = null;
  }

  // ---------- events ----------
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "refresh") { const b = e.target.closest("[data-act]"); b.classList.add("is-busy"); Promise.resolve(refresh()).finally(() => { renderMeta(); }); }
    if (act === "support") { e.preventDefault(); root.querySelector("#hx-support")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }); root.querySelector("#hx-support .hx-support-btn")?.focus({ preventScroll: true }); }
    if (act === "retry" && state.code) { const c = state.code; state.code = null; inflightCode = null; track(c); }
  });
  tick = setInterval(refreshFreshness, 30000);

  return {
    track, refresh, getState: () => ({ ...state }),
    setView(view) { state.code = view.trackingCode; applyView(view); setPhase("ready"); },
    /** Wipes the tracking session from memory and the page. */
    clear() { reset(); root.innerHTML = ""; setPhase("idle"); },
    /** Same as clear(), but tells the client why the shipment disappeared. */
    expire() { const had = !!state.code; reset(); if (had) { setPhase("expired"); renderMessage("expired"); } else { root.innerHTML = ""; setPhase("idle"); } },
    destroy() {
      destroyed = true; reset(); clearInterval(tick); counterIO?.disconnect();
      document.removeEventListener("visibilitychange", visibilityHandler); root.innerHTML = "";
    }
  };
}
