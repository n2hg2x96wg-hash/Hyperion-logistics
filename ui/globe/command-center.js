// Command center controller: picks the renderer (3D globe → flat map fallback), polls real data, renders the
// live activity feed, statistics and the selected-route card. Everything is progressive: the page (and the
// tracking form) work before any of this runs, and a failure here never affects shipment tracking.
import { globeSupported } from "./globe.js";
import { prefersReducedMotion } from "./geo.js";
import { EVENT_SOURCES } from "../../shared/status.js";
import { t, fmtAgo, fmtDateTime, fmtNumber, onLang } from "../i18n.js"; // English in the admin console (it never turns translations on)
import { statusText, eventTitle, sourceLabelText } from "../status-text.js";

// Visitors see a source only for verified feeds (GPS / carrier API); back-office labels stay in the admin console.
const VERIFIED_LABELS = new Set([EVENT_SOURCES.gps, EVENT_SOURCES.carrier_api]);

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso) => fmtDateTime(iso);
const timeAgo = (iso) => fmtAgo(iso);
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));

/**
 * @param {object} o
 *   mapEl, feedEl?, statsEl?, cardEl?, statusEl?    DOM elements (all but mapEl optional)
 *   tableEl?: <tbody> for a shipments table (one row per route: reference, route, status, last update)
 *   onData?: (data) => void, onSelect?: (key|null) => void   hooks for pages that build their own panels
 *   load: async () => ({ routes, activity?, stats?, version?, generatedAt? })   data source
 *   pollMs: number (0 = no polling)
 *   onOpen?: (route) => void                       admin: open the shipment
 *   mode: "public" | "admin"
 */
export function mountCommandCenter(o) {
  const params = new URLSearchParams(location.search);
  const forced = params.get("map"); // "globe" | "flat" (testing / support)
  const state = { data: null, version: null, selected: null, renderer: null, destroyed: false, timer: null, delay: o.pollMs || 0 };
  const status = (text, tone = "") => { if (o.statusEl) { o.statusEl.textContent = text; o.statusEl.dataset.tone = tone; } };

  // ---------- renderer (lazy, never blocking) ----------
  let started = false;
  async function startRenderer() {
    if (started || state.destroyed) return; started = true;
    o.mapEl.dataset.state = "loading";
    o.mapEl.style.setProperty("--cc-loading", JSON.stringify(t("cc.loadingMap"))); // CSS placeholder text, in the selected language
    const onSelect = (key) => select(key, { fromMap: true });
    const wantGlobe = forced === "globe" || (forced !== "flat" && globeSupported());
    if (wantGlobe) {
      try {
        const { createGlobe } = await import("./globe.js");
        state.renderer = await createGlobe(o.mapEl, { onSelect, skipProbe: forced === "globe" });
      } catch (err) {
        console.info("[command-center] globe unavailable, using flat map:", err?.message);
        o.mapEl.innerHTML = "";
      }
    }
    if (!state.renderer) {
      try {
        const { createFlatMap } = await import("./flatmap.js");
        state.renderer = await createFlatMap(o.mapEl, { onSelect });
      } catch {
        o.mapEl.dataset.state = "failed";
        o.mapEl.innerHTML = `<div class="cc-map-msg">${esc(t("cc.mapFailed"))}</div>`;
        return;
      }
    }
    if (state.destroyed) { state.renderer.destroy(); return; }
    o.mapEl.dataset.state = "ready"; o.mapEl.dataset.renderer = state.renderer.kind;
    if (state.data) state.renderer.update(state.data.routes || []);
    if (state.selected) state.renderer.select(state.selected);
  }
  const begin = () => idle(startRenderer);
  if (typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); if (document.readyState === "complete") begin(); else addEventListener("load", begin, { once: true }); } }, { rootMargin: "300px" });
    io.observe(o.mapEl);
  } else begin();

  // ---------- data ----------
  async function refresh() {
    clearTimeout(state.timer);
    if (state.destroyed) return;
    try {
      const data = await o.load();
      state.delay = o.pollMs;
      if (data.version && data.version === state.version) { status(t("cc.checked", { ago: timeAgo(new Date().toISOString()) }), "ok"); }
      else { state.version = data.version || null; state.data = data; render(); }
    } catch {
      state.delay = Math.min((state.delay || 30000) * 2, 240000);
      status(t(state.data ? "cc.connectionLost" : "cc.unavailableLive"), "warn");
    }
    schedule();
  }
  function schedule() {
    if (!o.pollMs || state.destroyed) return;
    state.timer = setTimeout(() => (document.hidden ? schedule() : refresh()), state.delay);
  }
  const onVisible = () => { if (!document.hidden && o.pollMs) refresh(); };
  document.addEventListener("visibilitychange", onVisible);

  // ---------- rendering ----------
  function render() {
    const d = state.data; const routes = d.routes || [];
    state.renderer?.update(routes);
    if (state.selected && !routes.some((r) => r.key === state.selected)) state.selected = null;
    renderStats(d.stats);
    renderFeed(d, routes);
    renderTable(routes, d.activity);
    renderCard();
    o.onData?.(d);
    o.mapEl.classList.toggle("cc-empty", !routes.length);
    // Public visitors only get times from verified carrier / GPS feeds (the server withholds staff edit and entry times);
    // stats.lastUpdated is when a record was last edited (admin only).
    const updated = o.mode === "admin" ? d.stats?.lastUpdated : (d.activity || []).map((a) => a.at).filter(Boolean).sort().at(-1);
    status(updated ? (o.mode === "admin" ? `Last update ${timeAgo(updated)}` : t("cc.lastMilestone", { ago: timeAgo(updated) }))
      : o.mode !== "admin" && (d.activity || []).length ? t("cc.showingLatest") : t("cc.noUpdates"), "ok");
    if (o.statusEl) o.statusEl.title = updated ? `${o.mode === "admin" ? "Last recorded shipment update" : t("cc.newestMilestone")}: ${fmt(updated)}` : "";
  }

  function renderStats(s) {
    if (!o.statsEl || !s) return;
    for (const el of o.statsEl.querySelectorAll("[data-stat]")) {
      const v = Number(s[el.dataset.stat] ?? 0);
      if (el.dataset.value === String(v)) continue;
      el.dataset.value = String(v);
      countTo(el, v);
    }
    const list = o.statsEl.querySelector("[data-countries]");
    if (list) list.textContent = s.activeCountries?.length ? s.activeCountries.map((c) => c.name).join(" · ") : "No active shipments yet";
  }
  function countTo(el, target) {
    const from = Number(el.textContent.replace(/\D/g, "")) || 0;
    if (prefersReducedMotion() || from === target) { el.textContent = fmtNumber(target); return; }
    const start = performance.now(); const dur = 700;
    const step = (t) => { const k = Math.min(1, (t - start) / dur); el.textContent = fmtNumber(Math.round(from + (target - from) * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function renderFeed(d, routes) {
    if (!o.feedEl) return;
    const items = o.mode === "admin"
      ? routes.map((r) => ({ routeKey: r.key, ref: r.ref, title: r.status.label, tone: r.status.tone, from: r.originLabel, to: r.destinationLabel,
          place: r.current?.place, at: r.current?.recordedAt || r.updatedAt, sourceLabel: r.publicMap ? "Shown on homepage" : "Private" }))
      : (d.activity || []).map((a) => ({ ...a, title: eventTitle(a) }));
    if (!items.length) {
      o.feedEl.innerHTML = `<li class="cc-feed-empty">${o.mode === "admin" ? "No active shipments with coordinates yet. Add origin/destination points or a location in Live Tracking." :
        esc(t("cc.feedEmpty"))}</li>`;
      return;
    }
    o.feedEl.innerHTML = items.map((a) => `
      <li><button type="button" class="cc-feed-item ${a.routeKey === state.selected ? "is-selected" : ""}" data-route="${esc(a.routeKey)}">
        <span class="cc-dot tone-${esc(a.tone)}"></span>
        <span class="cc-feed-main">
          <span class="cc-feed-top"><strong>${esc(a.title)}</strong>${a.at ? `<time datetime="${esc(a.at)}">${esc(timeAgo(a.at))}</time>` : o.mode === "admin" ? "<time>time not recorded</time>" : ""}</span>
          <span class="cc-feed-route">${esc(a.from || t("route.originNotSet"))} <span class="cc-arrow" aria-hidden="true">→</span> ${esc(a.to || t("route.destinationNotSet"))}</span>
          <span class="cc-feed-meta"><bdi dir="ltr">${esc(a.ref)}</bdi>${a.place ? ` · ${esc(a.place)}` : ""}${o.mode === "admin" ? ` · ${esc(a.sourceLabel)}` : VERIFIED_LABELS.has(a.sourceLabel) ? ` · ${esc(sourceLabelText(a.sourceLabel))}` : ""}</span>
        </span></button></li>`).join("");
  }

  function renderTable(routes, activity = []) {
    if (!o.tableEl) return;
    if (!routes.length) {
      o.tableEl.innerHTML = `<tr class="cc-row-empty"><td colspan="4">${o.mode === "admin" ? "No active shipments with coordinates yet." :
        esc(t("cc.tableEmpty"))}</td></tr>`;
      return;
    }
    o.tableEl.innerHTML = routes.slice(0, 12).map((r) => {
      // public: the route's newest recorded event, else its recorded position time; never the record-edit time
      const at = o.mode === "admin" ? r.current?.recordedAt || r.updatedAt : activity.find((a) => a.routeKey === r.key)?.at || r.current?.recordedAt || null;
      return `<tr data-route="${esc(r.key)}" tabindex="0" class="${r.key === state.selected ? "is-selected" : ""}">
        <td data-label="${esc(t("cc.col.shipment"))}"><span class="cc-ref" dir="ltr">${esc(r.ref)}</span></td>
        <td data-label="${esc(t("cc.col.route"))}"><span class="cc-route">${esc(r.originLabel || t("route.originNotSet"))}<i aria-hidden="true">→</i>${esc(r.destinationLabel || t("route.destinationNotSet"))}</span></td>
        <td data-label="${esc(t("cc.col.status"))}"><span class="cc-pill tone-${esc(r.status.tone)}">${esc(statusText(r.status))}</span></td>
        <td data-label="${esc(t("cc.col.updated"))}">${at ? `<time datetime="${esc(at)}" title="${esc(fmt(at))}">${esc(timeAgo(at))}</time>` : o.mode === "admin" ? "Not recorded" : "—"}</td></tr>`;
    }).join("");
  }

  function renderCard() {
    if (!o.cardEl) return;
    const r = state.data?.routes?.find((x) => x.key === state.selected);
    if (!r) { o.cardEl.hidden = true; return; }
    o.cardEl.hidden = false;
    const pos = r.current
      ? `<div class="cc-card-row"><span class="cc-key cc-key-current"></span><div><strong>${esc(t("map.recordedPosition"))}</strong><br>${esc(r.current.place || `${r.current.lat}, ${r.current.lng}`)}${o.mode === "admin" ? `<br><small>${r.current.recordedAt ? `${esc(fmt(r.current.recordedAt))} · ` : "Time not recorded · "}${esc(r.current.sourceLabel || EVENT_SOURCES.admin)}</small>` : VERIFIED_LABELS.has(r.current.sourceLabel) && r.current.recordedAt ? `<br><small>${esc(fmt(r.current.recordedAt))} · ${esc(sourceLabelText(r.current.sourceLabel))}</small>` : ""}</div></div>`
      : `<div class="cc-card-row"><span class="cc-key"></span><div><strong>${esc(t("cc.card.noPosition"))}</strong><br><small>${esc(t("cc.card.plannedOnly"))}</small></div></div>`;
    o.cardEl.innerHTML = `
      <div class="cc-card-head"><span class="cc-ref" dir="ltr">${esc(r.ref)}</span><span class="cc-pill tone-${esc(r.status.tone)}">${esc(statusText(r.status))}${r.deliveredRecently ? ` · ${esc(t("cc.card.recently"))}` : ""}</span>
        <button type="button" class="cc-close" aria-label="${esc(t("cc.card.close"))}" data-close>×</button></div>
      <div class="cc-card-row"><span class="cc-key cc-key-origin"></span><div><small>${esc(t("route.from"))}</small><br>${esc(r.originLabel || t("route.notSet"))}</div></div>
      <div class="cc-card-row"><span class="cc-key cc-key-dest"></span><div><small>${esc(t("route.to"))}</small><br>${esc(r.destinationLabel || t("route.notSet"))}</div></div>
      ${pos}
      <p class="cc-note">${esc(t("cc.card.note"))}</p>
      ${o.onOpen ? '<button type="button" class="cc-open" data-open-route>Open shipment</button>' : ""}`;
  }

  function select(key, { fromMap = false } = {}) {
    state.selected = state.selected === key && fromMap ? null : key;
    state.renderer?.select(state.selected);
    renderCard();
    o.feedEl?.querySelectorAll(".cc-feed-item").forEach((b) => b.classList.toggle("is-selected", b.dataset.route === state.selected));
    o.tableEl?.querySelectorAll("tr[data-route]").forEach((b) => b.classList.toggle("is-selected", b.dataset.route === state.selected));
    o.onSelect?.(state.selected);
  }

  o.feedEl?.addEventListener("click", (e) => { const b = e.target.closest("[data-route]"); if (b) select(b.dataset.route); });
  o.tableEl?.addEventListener("click", (e) => { const b = e.target.closest("[data-route]"); if (b) select(b.dataset.route); });
  o.tableEl?.addEventListener("keydown", (e) => { const b = e.target.closest("[data-route]"); if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(b.dataset.route); } });
  o.cardEl?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) select(null);
    if (e.target.closest("[data-open-route]")) { const r = state.data?.routes?.find((x) => x.key === state.selected); if (r) o.onOpen?.(r); }
  });

  // language changed: redraw the last data in the new wording (no new request)
  const offLang = onLang(() => {
    o.mapEl.style.setProperty("--cc-loading", JSON.stringify(t("cc.loadingMap")));
    if (state.data && !state.destroyed) render();
  });
  refresh();
  return {
    refresh,
    select: (key) => select(key),
    destroy() { offLang(); state.destroyed = true; clearTimeout(state.timer); document.removeEventListener("visibilitychange", onVisible); state.renderer?.destroy(); },
    get renderer() { return state.renderer?.kind || null; }
  };
}
