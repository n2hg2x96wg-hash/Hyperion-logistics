// Client tracking dashboard component. The SAME component renders the public tracking page and the
// admin "Preview client view", so what admins preview is exactly what clients get.
//
// Data comes only from the server's visibility-filtered view (see api/_lib/client-view.js).
// Realtime: Server-Sent Events -> adaptive polling fallback. One realtime session at a time, fully cleaned up on destroy().
//
// Privacy: the active tracking code lives ONLY in this closure (memory). It is never written to localStorage,
// sessionStorage, cookies or the address bar. clear()/expire() wipe it together with the rendered shipment.
import { timeAgo, locationFreshness, LOCATION_STATE_LABELS } from "../shared/status.js";
import { resolveMapData, hasPoints } from "./map-data.js";
import { presentation, sceneSvg, routeStops, stagePhoto, stagePhotoHtml, stageScene, modelCaption, routeOverlaySvg, STATUS_HELP } from "./scene.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;
const LIVE_SOURCES = new Set(["gps", "carrier_api"]); // the only sources that are verified live carrier / telemetry data
const SOURCE_TEXT = { gps: "GPS", carrier_api: "Carrier update" };
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
  let serverOffset = 0; let renderedCode = null; let refreshNote = ""; let noteFor = null; let noteTimer = null;
  const REFRESH_NOTES = { updated: "✓ New information loaded.", unchanged: "✓ Checked — no new updates since the last recorded one.", error: "Couldn't check right now — showing the last loaded information." }; let shownStage = null; // progress stage last drawn, so the bar animates only on a real change
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
    if (switching) { state.view = null; destroyMap(); drop3d(); want3d = true; if (failed3d !== "slow") failed3d = null; renderedCode = null; } // a slow device stays on photos
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

  /** Manual check. Never overlaps itself; resolves to "updated" | "unchanged" | "error" for the on-screen feedback. */
  let refreshing = null;
  function refresh() {
    if (!state.code) return Promise.resolve("error");
    if (!refreshing) refreshing = (async () => {
      const before = state.view?.version;
      if (preview) { const res = await loadView(state.code, {}); if (res.status === "ok") applyView(res.view); return res.status === "ok" ? (res.view.version !== before ? "updated" : "unchanged") : "error"; }
      const st = await pollNow(true);
      return st === "ok" ? (state.view?.version !== before ? "updated" : "unchanged") : st === "unchanged" ? "unchanged" : "error";
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function pollNow(force = false) {
    if (!state.code || destroyed) return "error";
    clearTimeout(pollTimer);
    const code = state.code;
    const res = await loadView(code, { version: force ? null : state.view?.version });
    if (destroyed || code !== state.code) return "error";
    state.lastCheckedAt = Date.now();
    if (res.status === "ok") { applyView(res.view); pollDelay = 0; setTransport(state.transport === "live" ? "live" : "polling"); }
    else if (res.status === "unchanged") { pollDelay = 0; renderMeta(); if (state.transport === "offline") setTransport("polling"); }
    else if (res.status === "notfound") { state.view = null; setPhase("notfound"); renderMessage("notfound"); stopRealtime(); return "notfound"; }
    else { // keep last valid data, back off
      pollDelay = Math.min((pollDelay || cfg.pollMs) * 2, 120000); if (res.retryAfter) pollDelay = Math.max(pollDelay, res.retryAfter * 1000);
      setTransport("offline");
    }
    if (state.transport !== "live") schedulePoll();
    return res.status;
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
  // Only a verified feed (GPS telemetry or a carrier API) can make a location "Live" or "Recently updated".
  // Locations entered by operations are shown as the last known location, without a time: when an operator does not
  // give one, the stored time is when the entry was made, which is not when the shipment was there.
  const verifiedFeed = (v) => LIVE_SOURCES.has(v?.currentLocation?.source);
  function locState(v = state.view) {
    const ls = v?.locationState;
    if (!ls) return null;
    if (!verifiedFeed(v)) { const s = ls.state === "none" ? "none" : "last"; return { ...ls, state: s, label: LOCATION_STATE_LABELS[s] }; }
    const s = locationFreshness({ updatedAt: ls.updatedAt, hasCoordinates: ls.hasCoordinates, hasName: !!v.currentLocation,
      statusCode: v.status?.code, now: Date.now() + serverOffset, liveMs: ls.liveMs, recentMs: ls.recentMs });
    return { ...ls, state: s, label: LOCATION_STATE_LABELS[s] };
  }
  const badge = (ls) => (ls && (ls.state === "live" || ls.state === "recent") ? `<span class="hx-loc-badge is-${esc(ls.state)}" data-slot="locbadge"><i></i>${esc(ls.label)}</span>` : "");

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
    destroyMap(); drop3d();
    root.innerHTML = `<div class="hx-card hx-skeleton" role="status" aria-label="Loading shipment"><div class="hx-sk hx-sk-a"></div><div class="hx-sk hx-sk-b"></div><div class="hx-sk hx-sk-map"></div><div class="hx-sk hx-sk-c"></div></div>`;
  }

  const MESSAGES = {
    notfound: { icon: "🔎", title: "Tracking number not found.", body: "Check the number on your booking confirmation and try again. Letters and numbers must match exactly.", retry: false },
    invalid: { icon: "⌨️", title: "Please enter a valid tracking number.", body: "Tracking numbers use letters, numbers and dashes only, with at least 3 characters.", retry: false },
    error: { icon: "📡", title: "We couldn't load tracking right now.", body: "Please check your connection and try again in a moment.", retry: true },
    expired: { icon: "🔒", title: "Your tracking session has ended.", body: "For your privacy, shipment details are cleared when you leave, reload or stay inactive. Enter your tracking number again to continue.", retry: false }
  };
  function renderMessage(kind) {
    destroyMap(); drop3d(); renderedCode = null;
    const msg = MESSAGES[kind];
    root.innerHTML = `<div class="hx-card hx-empty" role="alert" data-reveal><div class="hx-empty-ico">${msg.icon}</div><h3>${msg.title}</h3><p>${msg.body}</p>${msg.retry ? '<button type="button" class="hx-btn" data-act="retry">Try again</button>' : ""}</div>`;
  }

  // Stage-based progress. No percentage is shown: the lifecycle position is the only fact the data supports.
  function stepsHtml(p) {
    const cur = p.steps.findIndex((s) => s.code === p.stage);
    const n = p.steps.length;
    const frac = (i) => (p.stage === "DELIVERED" ? 1 : i <= 0 ? 0 : i / (n - 1));
    const items = p.steps.map((s, i) => {
      const st = p.cancelled ? "" : i < cur ? "done" : i === cur ? (p.held ? "current held" : "current") : "upcoming";
      const sr = st.startsWith("current") ? (p.held ? "Current, on hold" : "Current") : st === "done" ? "Completed" : "Upcoming";
      return `<li class="hx-step ${st}" ${i === cur ? 'aria-current="step"' : ""}><span class="hx-step-dot" aria-hidden="true"></span><span class="hx-step-label">${esc(s.label)}</span><span class="hx-sr"> — ${sr}</span></li>`;
    }).join("");
    if (cur < 0) return `<ol class="hx-steps">${items}</ol>`;
    const label = p.steps[cur].label;
    const now = `<div class="hx-stage-now">${esc(label)}${p.held ? " · on hold" : ""}</div>`;
    const head = `<div class="hx-progress-head"><span>Stage <strong>${cur + 1}</strong> of ${n}</span><span class="hx-progress-label">${esc(label)}</span></div>`;
    return `${head}<div class="hx-progress-bar" role="progressbar" aria-label="Shipment progress" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${cur + 1}" aria-valuetext="Stage ${cur + 1} of ${n}: ${esc(label)}"><span data-p="${frac(cur)}" style="--hx-p:${frac(cur)}"></span></div><ol class="hx-steps">${items}</ol>${now}`;
  }

  /** Origin → destination with the recorded stage, above the map (no percentage: the stage is the only fact). */
  const MODE_SVG = {
    ship: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/><path d="M5 14 4 10h16l-1 4"/><path d="M8 10V6h4v4M12 7h4v3"/></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5Z"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>'
  };
  function routeSummaryHtml(v) {
    if (!v.origin && !v.destination) return "";
    const p = v.progress; const n = p?.steps?.length || 0; const i = p ? p.steps.findIndex((x) => x.code === p.stage) : -1;
    const frac = p?.stage === "DELIVERED" ? 1 : i <= 0 || n < 2 ? 0 : i / (n - 1);
    const mode = presentation(v).mode; const icon = mode ? MODE_SVG[mode] : "";
    const eta = v.eta?.state === "date" ? fmtDate(v.eta.date, "medium") : v.eta?.state === "delivered" && v.eta.deliveredAt ? fmtDateTime(v.eta.deliveredAt) : "";
    return `<div class="hx-routesum"><div class="hx-rsum-end"><small>From</small><strong>${esc(v.origin || "Origin not set")}</strong></div>
      <div class="hx-rsum-line" aria-hidden="true"><i style="--hx-p:${p?.cancelled ? 0 : frac}"></i>${icon ? `<span class="hx-rsum-mode" style="--hx-p:${p?.cancelled ? 0 : frac}">${icon}</span>` : ""}</div>
      <div class="hx-rsum-end is-dest"><small>To</small><strong>${esc(v.destination || "Destination not set")}</strong></div>
      ${i >= 0 || eta ? `<div class="hx-rsum-meta">${i >= 0 ? `<span>${p.cancelled ? "Cancelled" : `Stage ${i + 1} of ${n} · ${esc(p.steps[i].label)}${p.held ? " · on hold" : ""}`}</span>` : ""}${eta ? `<span>${v.eta.state === "delivered" ? "Delivered" : "Estimated delivery"} ${esc(eta)}</span>` : ""}</div>` : ""}</div>`;
  }

  function routeHtml(v, reveal) {
    const stops = routeStops(v);
    if (stops.length < 2) return "";
    const MAX = 6; const hidden = Math.max(0, stops.length - MAX);
    const shown = hidden ? [stops[0], ...stops.slice(-(MAX - 1))] : stops;
    const mark = { done: "✓", current: "●", upcoming: "" };
    const srState = { done: "completed", current: "current", upcoming: "upcoming" };
    return `<section class="hx-card hx-route" ${reveal ? "data-reveal" : ""} aria-labelledby="hxRouteH"><h3 class="hx-h" id="hxRouteH">Recorded route <small class="hx-h-sub">oldest first</small></h3>
      <ol class="hx-route-list">${shown.map((x, i) => `${hidden && i === 1 ? `<li class="hx-route-gap">+${hidden} earlier stop${hidden === 1 ? "" : "s"}</li>` : ""}
        <li class="hx-rs is-${x.state} k-${x.kind}"><span class="hx-rs-dot" aria-hidden="true">${mark[x.state]}</span>
          <span class="hx-rs-body"><span class="hx-rs-title">${esc(x.title)}<span class="hx-sr"> (${srState[x.state]})</span></span><span class="hx-rs-place">${esc(x.place)}</span>
          ${x.at ? `<time class="hx-rs-time" datetime="${esc(x.at)}">${esc(fmtDateTime(x.at))}</time>` : ""}</span></li>`).join("")}</ol>
      <p class="hx-route-note">Each checkpoint is time-stamped when it is recorded by our operations team or the carrier.</p></section>`;
  }

  function sceneHtml(v, ls) {
    const pr = presentation(v);
    const loc = v.currentLocation?.name;
    const photo = stagePhoto(v); const sc = stageScene(v);
    const media = photo ? stagePhotoHtml(photo) + (photo.key === "ship" ? routeOverlaySvg(v) : "") : sceneSvg(pr);
    return `<figure class="hx-scene" data-stage="${esc(pr.stage)}" data-mode="${esc(pr.mode || "none")}" data-photo="${esc(photo?.key || "none")}" data-scene="${esc(sc.scene)}" data-animate="${sc.animate}" data-state="${esc(sc.state)}">
      <div class="hx-scene-media"><div class="hx-scene-stage${photo ? " has-photo" : ""}">${media}<div class="hx-3d" data-slot="3d" hidden></div></div>${bar3dHtml()}</div>
      <figcaption><strong>${esc(pr.label)}</strong><span>${loc ? `Last recorded at ${esc(loc)}` : "No location recorded yet"}</span>
      <small data-slot="scenecap">${photo?.key === "ship" ? "Illustration with the shipment's recorded checkpoints." : "Illustration of the current shipment stage."}</small></figcaption></figure>`;
  }

  function bar3dHtml() {
    const hint = fine ? "Drag to rotate · click, then scroll to zoom" : "Swipe sideways to rotate · pinch to zoom";
    return `<div class="hx-3d-bar" data-slot="3dbar" data-mode="loading">
      <div class="hx-segs hx-3d-mode" role="group" aria-label="Scene view"><button type="button" class="hx-seg" data-act="3d" aria-pressed="true" aria-controls="hx3d">3D</button><button type="button" class="hx-seg" data-act="3d-close" aria-pressed="false">Photo</button></div>
      <span class="hx-3d-hint">${hint}</span>
      <div class="hx-segs hx-3d-views" role="group" aria-label="Camera views" data-slot="3dviews"></div>
      <div class="hx-3d-tools"><button type="button" class="hx-3d-btn" data-act="3d-zoom-out" aria-label="Zoom out" disabled>−</button><button type="button" class="hx-3d-btn" data-act="3d-zoom-in" aria-label="Zoom in" disabled>+</button><button type="button" class="hx-3d-btn" data-act="3d-reset" aria-label="Reset view" disabled>⟲</button></div>
      <p class="hx-3d-note" role="status" hidden></p></div>`;
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

  let timelineOrder = "oldest"; // the journey reads in the order it happened; visitors can flip it
  function timelineHtml(items, reveal) {
    if (!items) return "";
    if (!items.length) return `<section class="hx-card" ${reveal ? "data-reveal" : ""}><h3 class="hx-h">Shipment timeline</h3><p class="hx-muted">No tracking events have been recorded yet.</p></section>`;
    const latestId = items[0]?.id; // the API sends the newest first
    const list = timelineOrder === "oldest" ? items.slice().reverse() : items;
    const sw = (k, label) => `<button type="button" class="hx-seg" data-act="order" data-order="${k}" aria-pressed="${timelineOrder === k}">${label}</button>`;
    return `<section class="hx-card hx-tl-card" ${reveal ? "data-reveal" : ""}><div class="hx-tl-head"><h3 class="hx-h">Shipment timeline <small class="hx-h-sub"><span data-count="${items.length}">${items.length}</span> recorded update${items.length === 1 ? "" : "s"}</small></h3>
      ${items.length > 1 ? `<div class="hx-segs" role="group" aria-label="Timeline order">${sw("oldest", "Oldest first")}${sw("latest", "Latest first")}</div>` : ""}</div>
      <ol class="hx-timeline is-${timelineOrder}" ${reveal ? "data-reveal-stagger" : ""}>${list.map((t) => { const latest = t.id === latestId; return `
      <li class="hx-tl tone-${esc(t.tone)} ${latest ? "latest" : ""}" ${reveal ? "data-reveal" : ""} ${latest ? 'aria-current="step"' : ""}><span class="hx-tl-dot"></span>
        <div class="hx-tl-body"><div class="hx-tl-title">${esc(t.title)}${latest ? ' <span class="hx-tl-tag">Latest</span>' : ""}</div>
        ${t.location ? `<div class="hx-tl-loc">${ICON.pin} ${esc(t.location)}</div>` : ""}
        ${t.description ? `<div class="hx-tl-desc">${esc(t.description)}</div>` : ""}
        ${t.timestamp ? `<div class="hx-tl-time"><time datetime="${esc(t.timestamp)}">${esc(fmtDateTime(t.timestamp))}</time>${SOURCE_TEXT[t.source] ? ` · ${SOURCE_TEXT[t.source]}` : ""}</div>` : ""}</div></li>`; }).join("")}</ol></section>`;
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
    // Latest milestone = the newest recorded event. The server sends an event time only for verified carrier / GPS
    // events: the time a member of staff entered or edited a milestone is never shown to clients.
    const latest = v.timeline?.[0] || null;
    const ago = latest?.timestamp ? timeAgo(latest.timestamp, Date.now() + serverOffset) : null;

    // The 3D view survives a data update when the stage model is unchanged; otherwise it is rebuilt for the new stage.
    const next3d = stageScene(v); const keep3d = viewer3d && viewer3dKey === `${next3d.scene}:${next3d.animate}:${next3d.state}` ? root.querySelector('[data-slot="3d"]') : null;
    if (keep3d) keep3d.remove(); else drop3d();
    // Keep the live map element (and its Leaflet instance) across re-renders: updates move markers, never rebuild the map.
    const keepMap = v.map && map ? map.el : null;
    if (keepMap) keepMap.remove();

    root.innerHTML = `
      ${preview ? `<div class="hx-preview-banner" role="note"><strong>PREVIEW MODE</strong> — this is exactly what the client sees for this tracking number. Nothing here is editable.</div>` : ""}
      <section class="hx-card hx-header" ${R()}>
        <div class="hx-header-top">
          <div class="hx-id"><div class="hx-kicker">Tracking number</div><div class="hx-code-row"><h2 class="hx-code">${esc(v.trackingCode)}</h2><button type="button" class="hx-copy hx-press" data-act="copy" aria-label="Copy tracking number"><span aria-hidden="true">⧉</span> <span data-copy-label>Copy</span></button></div>${v.origin || v.destination ? `<div class="hx-od"><span>${esc(v.origin || "Origin not set")}</span><i aria-hidden="true"></i><span>${esc(v.destination || "Destination not set")}</span></div>` : ""}</div>
          <div class="hx-status"><div class="hx-kicker">Current status</div><span class="hx-pill tone-${esc(v.status.tone)}${v.status.code && !["DELIVERED", "CANCELLED"].includes(v.status.code) ? " is-active" : ""}"><i aria-hidden="true"></i>${esc(v.status.label)}</span></div>
        </div>
        ${sceneHtml(v, ls)}
        <div class="hx-facts" ${reveal ? "data-reveal-stagger" : ""}>
          ${ls ? `<div class="hx-fact hx-fact-loc" ${R()}><div class="hx-fact-label">${ICON.pin} ${ls.state === "live" ? "Current location" : ls.state === "none" ? "Location" : "Last known location"}</div><div class="hx-fact-value">${loc ? esc(loc.name) : '<span class="hx-muted">Awaiting location update</span>'}</div>${verifiedFeed(v) ? `<div class="hx-fact-sub">${badge(ls)}${ls.updatedAt ? ` <span class="hx-loc-time"><time datetime="${esc(ls.updatedAt)}">${esc(fmtDateTime(ls.updatedAt))}</time> · ${SOURCE_TEXT[v.currentLocation.source]}</span>` : ""}</div>` : ""}</div>` : ""}
          ${carrier ? `<div class="hx-fact" ${R()}><div class="hx-fact-label">${ICON.truck} Carrier</div><div class="hx-fact-value">${carrierName}</div>${carrier.trackingNumber ? `<div class="hx-fact-sub">Ref ${esc(carrier.trackingNumber)}</div>` : ""}</div>` : ""}
          ${latest ? `<div class="hx-fact hx-fact-updated" ${R()}><div class="hx-fact-label">🕒 Latest recorded milestone</div><div class="hx-fact-value">${esc(latest.title)}</div>${latest.timestamp ? `<div class="hx-fact-sub"><time datetime="${esc(latest.timestamp)}">${esc(fmtDateTime(latest.timestamp))}</time>${ago ? ` · <span data-ago="${esc(latest.timestamp)}">${esc(ago)}</span>` : ""}</div>` : latest.location ? `<div class="hx-fact-sub">${esc(latest.location)}</div>` : ""}</div>` : ""}
          ${v.eta ? `<div ${R()} class="hx-fact-wrap">${etaFact(v.eta)}</div>` : ""}
        </div>
        <div class="hx-meta" data-slot="meta"></div>
        ${v.exception ? `<div class="hx-exception" role="alert">${ICON.warn} <div><strong>${esc(v.exception.label)}</strong>${v.exception.note ? `<div>${esc(v.exception.note)}</div>` : ""}</div></div>` : ""}
        ${v.progress ? `<div class="hx-progress">${v.progress.cancelled ? '<p class="hx-muted">This shipment was cancelled.</p>' : stepsHtml(v.progress)}${v.progress.held ? '<p class="hx-muted hx-held">Progress is paused at the last confirmed stage while this issue is resolved.</p>' : ""}</div>` : ""}
      </section>
      ${v.map ? `<section class="hx-card hx-mapcard" ${R("fade")}><div class="hx-map-head"><h3 class="hx-h" data-slot="maptitle">${ls?.state === "live" ? "Live tracking map" : "Shipment map"}</h3>${badge(ls)}</div>
        ${routeSummaryHtml(v)}
        <div class="hx-map" data-slot="map" role="region" aria-label="Shipment map"></div>
        <p class="hx-map-note"><span data-slot="mapnote"></span> <span class="hx-map-cap">Lines connect recorded places; they aren't a tracked path.</span></p></section>` : ""}
      ${routeHtml(v, reveal)}
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
      ${STATUS_HELP[v.status?.code] ? `<details class="hx-card hx-help" ${R()}><summary>What does “${esc(v.status.label)}” mean?</summary><p>${esc(STATUS_HELP[v.status.code])}</p></details>` : ""}
      ${supportCardHtml(v.trackingCode, R())}`;
    animateProgress(v, isUpdate);
    renderedCode = v.trackingCode;
    if (keepMap) root.querySelector('[data-slot="map"]')?.replaceWith(keepMap);
    renderMeta();
    if (reveal) animateCounters();
    if (v.map) mountMap(resolveMapData(v));
    else destroyMap();
    mount3d(keep3d);
    if (isUpdate) { root.classList.add("hx-flash"); setTimeout(() => root.classList.remove("hx-flash"), 1200); }
  }

  /** The progress bar moves only when the recorded stage changes; a first render or an unrelated update draws it in place. */
  function animateProgress(v, isUpdate) {
    const bar = root.querySelector(".hx-progress-bar span");
    const stage = v.progress?.stage || null;
    const prevStage = shownStage; shownStage = stage;
    if (!bar) return;
    const changed = isUpdate && prevStage && stage !== prevStage && !reducedMotion();
    if (!changed) { bar.classList.add("no-anim"); return; }
    const steps = v.progress.steps; const n = steps.length; const i = steps.findIndex((x) => x.code === prevStage);
    bar.classList.add("no-anim"); bar.style.setProperty("--hx-p", String(i <= 0 ? 0 : i / (n - 1)));
    void bar.offsetWidth; // commit the old width, then transition to the new one
    bar.classList.remove("no-anim"); bar.style.setProperty("--hx-p", bar.dataset.p);
    root.querySelector(".hx-step.current")?.classList.add("is-new");
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
    if (noteFor && noteFor !== v.trackingCode) { refreshNote = ""; noteFor = null; }
    const t = state.transport;
    const secs = Math.round((pollDelay || cfg.pollMs || 20000) / 1000);
    // Connection state only. Whether the SHIPMENT is live is the location badge's job, based on recorded data.
    const conn = preview ? '<span class="hx-conn poll"><i></i>Preview: updates when you refresh</span>' : t === "live" ? '<span class="hx-conn ok"><i></i>Checks for new updates automatically</span>'
      : t === "polling" ? `<span class="hx-conn poll"><i></i>Checks for new updates every ${secs}s</span>`
      : t === "offline" ? '<span class="hx-conn off"><i></i>Offline — showing last known update</span>' : '<span class="hx-conn poll"><i></i>Connecting for updates…</span>';
    const checked = state.lastCheckedAt ? `<small class="hx-checked">Last checked ${esc(new Date(state.lastCheckedAt + serverOffset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small>` : "";
    slot.innerHTML = `<div class="hx-meta-status">${conn}${checked}</div><div class="hx-actions"><button type="button" class="hx-btn-sec hx-press" data-act="refresh" aria-label="Check for new updates now"><span aria-hidden="true">↻</span> Check now</button><a class="hx-btn-sec hx-press" href="#hx-support" data-act="support"><span aria-hidden="true">✉</span> Support</a></div><p class="hx-refresh-note" role="status" aria-live="polite">${esc(refreshNote)}</p>`;
  }

  /** Re-evaluate "Live" / "Recently updated" / "Last known" as time passes without new data. */
  function refreshFreshness() {
    const v = state.view; if (!v) return;
    const ls = locState(v); if (!ls) return;
    root.querySelectorAll('[data-slot="locbadge"]').forEach((el) => { if (!el.classList.contains(`is-${ls.state}`)) el.outerHTML = badge(ls); });
    if (!badge(ls)) root.querySelectorAll('[data-slot="locbadge"]').forEach((el) => el.remove());
    const title = root.querySelector('[data-slot="maptitle"]'); if (title) title.textContent = ls.state === "live" ? "Live tracking map" : "Shipment map";
    root.querySelectorAll("[data-ago]").forEach((agoEl) => { const iso = agoEl.dataset.ago; const a = iso && timeAgo(iso, Date.now() + serverOffset); if (a) agoEl.textContent = a; });
    if (v.map) { const md = resolveMapData(v); mapNote(md, ls); if (map && md.current && md.current.state !== ls.state) map.api.update(withState(md, ls)); }
  }
  const withState = (data, ls) => {
    if (!data.current) return data;
    const verified = verifiedFeed(state.view) && !data.current.approx && !data.current.fromTrail; // fallbacks are never "verified"
    const moving = ["IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(state.view?.status?.code);
    return { ...data, mode: moving ? presentation(state.view).mode : null,
      current: { ...data.current, state: ls?.state || "last", sourceLabel: verified ? SOURCE_TEXT[state.view.currentLocation.source] : null, updatedAt: verified ? data.current.updatedAt : null } };
  };

  // ---------- map ----------
  function mapNote(data, ls) {
    const note = root.querySelector('[data-slot="mapnote"]'); if (!note) return;
    const c = data.current; const when = c?.updatedAt ? fmtDateTime(c.updatedAt) : null;
    const ends = data.resolved?.origin || data.resolved?.destination ? " Origin and destination are shown at city level." : "";
    let text;
    if (c && !c.approx && !c.fromTrail && ls?.state === "live") text = `Live — position reported ${timeAgo(c.updatedAt, Date.now() + serverOffset)} (${when}).`;
    else if (c && !c.approx && !c.fromTrail && ls?.state === "recent") text = `Recently updated — position reported ${when}.`;
    else if (c?.fromTrail) text = `Latest recorded checkpoint shown${c.name ? `: ${c.name}` : ""}.`;
    else if (c?.approx && data.resolved?.current) text = `Latest recorded place, shown at city level${c.name ? `: ${c.name}` : ""}.`;
    else if (c) text = verifiedFeed(state.view) ? "Last known location shown." : "Latest recorded location shown (approximate, city level).";
    else if (data.origin || data.destination) text = "No location has been recorded yet — showing origin and destination.";
    else text = "";
    note.textContent = `${text}${ends}`.trim();
  }

  async function mountMap(data) {
    const el = root.querySelector('[data-slot="map"]');
    if (!el) return;
    const ls = locState();
    mapNote(data, ls);
    if (!hasPoints(data)) { destroyMap(); el.classList.add("hx-map-empty"); el.innerHTML = '<div class="hx-map-msg"><strong>Awaiting location update</strong><br>No coordinates have been recorded for this shipment yet. The map will appear as soon as a location is recorded.</div>'; return; }
    if (map && map.el === el) { map.api.update(withState(data, ls)); if (el.querySelector(".hx-map-fallback")) showMapUnavailable(el, data); return; }
    destroyMap();
    if (mapFailed) { fallbackMap(el, data); return; }
    const token = ++mapToken;
    try {
      mapMod = mapMod || await import("./map.js");
      const api = await mapMod.createMap(el, { initial: withState(state.view ? resolveMapData(state.view) : data, locState()), onStatus: (s) => {
        // No tiles from any provider: never leave a blank map. Show a clear panel with the recorded facts instead.
        if (s === "tiles-unavailable") showMapUnavailable(el, state.view ? resolveMapData(state.view) : data);
        if (s === "tiles-ok") el.querySelector(".hx-map-fallback")?.remove();
        if (s === "street-unavailable") { const n = root.querySelector('[data-slot="mapnote"]'); if (n) n.textContent = "The street map isn't available right now; showing the outline map."; }
        if (s === "no-current") { const n = root.querySelector('[data-slot="mapnote"]'); if (n) n.textContent = "No location has been recorded yet — showing the route."; }
      } });
      if (destroyed || token !== mapToken || !el.isConnected) { api.destroy(); return; }
      map = { el, api };
    } catch { mapFailed = true; fallbackMap(el, data); }
  }
  function mapFallbackHtml(data) {
    const v = state.view; const c = data?.current;
    const rows = [
      ["Last known location", c ? (c.name || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`) : (v?.currentLocation?.name || "Awaiting location update")],
      c ? ["Coordinates", `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`] : null,
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

  // ---------- 3D stage scene: starts by itself when the scene scrolls into view ----------
  // The stage photo (or drawing) is the poster while Three.js loads and stays as the fallback when 3D can't run: no
  // WebGL, CDN blocked, slow network, or a device too slow to draw it smoothly. "Photo" switches back for the current
  // result only; nothing is stored.
  let viewer3d = null; let viewer3dKey = null; let scene3dMod = null; let v3token = 0; let v3io = null;
  let want3d = true; let failed3d = null; // null | "unavailable" | "slow"
  const V3_TIMEOUT = 15000;
  const FALLBACK_NOTE = { unavailable: "Showing photo — 3D view isn't available on this device.", slow: "Showing photo — 3D view turned off to keep this page smooth on this device." };
  const sceneCap = (fig) => (fig.dataset.photo === "ship" ? "Illustration with the shipment's recorded checkpoints." : "Illustration of the current shipment stage.");
  const figKey = (fig) => `${fig.dataset.scene}:${fig.dataset.animate === "true"}:${fig.dataset.state}`;

  function drop3d() { v3token++; v3io?.disconnect(); v3io = null; viewer3d?.dispose(); viewer3d = null; viewer3dKey = null; }

  function setBar(fig, mode) {
    const bar = fig?.querySelector('[data-slot="3dbar"]'); if (!bar) return;
    bar.dataset.mode = mode;
    bar.querySelectorAll(".hx-3d-btn, .hx-3d-views .hx-seg").forEach((b) => { b.disabled = mode !== "3d"; });
    bar.querySelector('[data-act="3d"]')?.setAttribute("aria-pressed", String(mode === "3d" || mode === "loading"));
    bar.querySelector('[data-act="3d-close"]')?.setAttribute("aria-pressed", String(mode === "photo"));
    const note = bar.querySelector(".hx-3d-note"); note.hidden = mode !== "fallback"; note.textContent = mode === "fallback" ? FALLBACK_NOTE[failed3d] || FALLBACK_NOTE.unavailable : "";
  }
  function setViews(fig, active) {
    const box = fig.querySelector('[data-slot="3dviews"]'); if (!box || !viewer3d) return;
    if (!box.childElementCount) box.innerHTML = viewer3d.views.map((x) => `<button type="button" class="hx-seg" data-act="3d-view" data-view="${esc(x.id)}" aria-pressed="false">${esc(x.label)}</button>`).join("");
    box.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === active)));
  }
  const captionFor = (fig) => modelCaption(fig.dataset.scene, fig.dataset.state);

  /** After each render: re-attach a kept viewer, or arm the lazy start, or show the photo state. */
  function mount3d(kept) {
    const fig = root.querySelector(".hx-scene[data-scene]"); if (!fig) { drop3d(); return; }
    if (kept) {
      fig.querySelector('[data-slot="3d"]')?.replaceWith(kept);
      fig.classList.add("is-3d"); setBar(fig, "3d"); setViews(fig, viewer3d.activeView);
      fig.querySelector('[data-slot="scenecap"]').textContent = captionFor(fig);
      return;
    }
    if (failed3d) { setBar(fig, "fallback"); return; }
    if (!want3d) { setBar(fig, "photo"); return; }
    const stage = fig.querySelector(".hx-scene-stage");
    if (typeof IntersectionObserver === "undefined") { start3d(fig); return; }
    v3io?.disconnect();
    v3io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      v3io.disconnect(); v3io = null; start3d(fig);
    }, { rootMargin: "200px 0px" });
    v3io.observe(stage);
  }

  async function start3d(fig) {
    const slot = fig.querySelector('[data-slot="3d"]'); const scene = fig.dataset.scene;
    if (!slot || !scene || viewer3d || !fig.isConnected) return;
    const token = ++v3token;
    slot.hidden = false; slot.id = "hx3d"; slot.innerHTML = "";
    fig.querySelector(".hx-3d-loading")?.remove();
    fig.querySelector(".hx-scene-stage").insertAdjacentHTML("beforeend", '<div class="hx-3d-loading" role="status"><span class="hx-spinner" aria-hidden="true"></span>Loading 3D view…</div>');
    fig.setAttribute("aria-busy", "true"); setBar(fig, "loading");
    let built = false; // the scene exists but is still being drawn / measured
    const load = (async () => {
      scene3dMod = scene3dMod || await import("./scene3d.js");
      const v = await scene3dMod.createViewer(slot, scene, { reducedMotion: reducedMotion(), animate: fig.dataset.animate === "true" }); built = true;
      try { await v.ready; } catch (err) { v.dispose(); throw err; }
      return v;
    })();
    let timer; let reason = "unavailable";
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), V3_TIMEOUT); });
    let viewer = null;
    try { viewer = await Promise.race([load, timeout]); }
    catch (err) { if (err?.code === "slow" || built) reason = "slow"; load.then((v) => v.dispose(), () => {}); } // a viewer that arrives after the timeout is discarded
    finally { clearTimeout(timer); }
    if (token !== v3token || !slot.isConnected) { viewer?.dispose(); return; }
    fig.removeAttribute("aria-busy"); fig.querySelector(".hx-3d-loading")?.remove();
    if (!viewer) { failed3d = reason; slot.hidden = true; slot.innerHTML = ""; setBar(fig, "fallback"); return; }
    viewer3d = viewer; viewer3dKey = figKey(fig); viewer3d.activeView = viewer3d.views[0]?.id;
    fig.classList.add("is-3d"); setBar(fig, "3d"); setViews(fig, viewer3d.activeView);
    fig.querySelector('[data-slot="scenecap"]').textContent = captionFor(fig);
  }

  function show3d() {
    const fig = root.querySelector(".hx-scene[data-scene]"); if (!fig || viewer3d) return;
    want3d = true; failed3d = null; start3d(fig);
  }
  function showPhoto() {
    want3d = false; drop3d();
    const fig = root.querySelector(".hx-scene[data-scene]"); if (!fig) return;
    const slot = fig.querySelector('[data-slot="3d"]'); if (slot) { slot.hidden = true; slot.innerHTML = ""; }
    fig.removeAttribute("aria-busy"); fig.querySelector(".hx-3d-loading")?.remove();
    fig.classList.remove("is-3d"); setBar(fig, failed3d ? "fallback" : "photo");
    fig.querySelector('[data-slot="scenecap"]').textContent = sceneCap(fig);
  }
  function show3dView(id) {
    const fig = root.querySelector(".hx-scene[data-scene]"); if (!fig || !viewer3d) return;
    viewer3d.setView(id); viewer3d.activeView = id; setViews(fig, id);
  }

  async function copyCode(btn, code) {
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; }
    catch { // older browsers: copy through a temporary, off-screen text field
      const t = document.createElement("textarea"); t.value = code; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(t); t.select(); try { ok = document.execCommand("copy"); } catch { ok = false; } t.remove();
    }
    const label = btn?.querySelector("[data-copy-label]"); if (!label) return;
    label.textContent = ok ? "Copied" : "Copy failed"; btn.classList.toggle("is-done", ok);
    setTimeout(() => { if (label.isConnected) { label.textContent = "Copy"; btn.classList.remove("is-done"); } }, 1600);
  }

  function reset() {
    drop3d(); want3d = true; if (failed3d !== "slow") failed3d = null;
    if (abort) abort.abort();
    abort = null; inflightCode = null;
    stopRealtime(); destroyMap();
    state.code = null; state.view = null; state.lastCheckedAt = null; renderedCode = null; shownStage = null;
  }

  // ---------- events ----------
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "refresh") {
      const b = e.target.closest("[data-act]"); if (b.disabled) return;
      b.classList.add("is-busy"); b.disabled = true; b.setAttribute("aria-busy", "true");
      refresh().then((r) => { refreshNote = REFRESH_NOTES[r] || ""; noteFor = state.view?.trackingCode || null; }).finally(() => {
        renderMeta();
        clearTimeout(noteTimer); noteTimer = setTimeout(() => { refreshNote = ""; root.querySelector(".hx-refresh-note")?.replaceChildren(); }, 6000);
      });
    }
    if (act === "support") { e.preventDefault(); root.querySelector("#hx-support")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }); root.querySelector("#hx-support .hx-support-btn")?.focus({ preventScroll: true }); }
    if (act === "3d" && state.view) show3d();
    if (act === "3d-close") showPhoto();
    if (act === "3d-reset" && viewer3d) { viewer3d.reset(); show3dView(viewer3d.views[0]?.id); }
    if (act === "3d-view") show3dView(e.target.closest("[data-view]").dataset.view);
    if (act === "3d-zoom-in") viewer3d?.zoom(0.85);
    if (act === "3d-zoom-out") viewer3d?.zoom(1 / 0.85);
    if (act === "order" && state.view) {
      timelineOrder = e.target.closest("[data-order]").dataset.order;
      const card = root.querySelector(".hx-tl-card");
      if (card) { const t = document.createElement("div"); t.innerHTML = timelineHtml(state.view.timeline, false); card.replaceWith(t.firstElementChild); root.querySelector(`.hx-seg[data-order="${timelineOrder}"]`)?.focus({ preventScroll: true }); }
    }
    if (act === "copy" && state.view) copyCode(e.target.closest("[data-act]"), state.view.trackingCode);
    if (act === "retry" && state.code) { const c = state.code; state.code = null; inflightCode = null; track(c); }
  });
  // Gentle depth on the stage illustration for mouse users (±4°); nothing on touch screens or with reduced motion.
  const fine = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
  const onPointer = (e) => {
    const st = e.target.closest?.(".hx-scene-stage"); if (!st || reducedMotion()) return;
    const r = st.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
    st.style.setProperty("--rx", `${(-y * 4).toFixed(2)}deg`); st.style.setProperty("--ry", `${(x * 4).toFixed(2)}deg`);
  };
  const onLeave = (e) => { const st = e.target.closest?.(".hx-scene-stage"); if (st) { st.style.removeProperty("--rx"); st.style.removeProperty("--ry"); } };
  if (fine) { root.addEventListener("pointermove", onPointer); root.addEventListener("pointerout", onLeave); }
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
      root.removeEventListener("pointermove", onPointer); root.removeEventListener("pointerout", onLeave); drop3d();
      document.removeEventListener("visibilitychange", visibilityHandler); root.innerHTML = "";
    }
  };
}
