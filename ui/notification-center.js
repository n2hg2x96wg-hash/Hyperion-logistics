// Customer notification center: a bell with the unread count, and a panel listing the customer's notifications.
// Everything shown comes from the server (POST /api/customer), which stores the notifications and checks that they
// belong to the signed-in customer; this module never invents a count or an update.
//   - desktop: a panel under the bell; phones: a full-height sheet under the header (the bell and menu stay visible)
//   - "All" / "Unread" tabs; notifications grouped by day (Today, Yesterday, Earlier), each with its status icon
//   - tapping one opens its detail screen (status, message, date, the shipment's route and current status) with
//     "View shipment"; opening it marks it as read. Back returns to the list.
//   - read state: one notification ("Mark as read", or by opening it) or all of them ("Mark all as read")
//   - loading, empty and error (with retry) states; refreshes every minute while the page is visible
import { t, tn, esc, fmtDateTime, fmtAgo, onLang } from "./i18n.js";
import { statusText } from "./status-text.js";

const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const BELL = svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const CLOSE = svg('<path d="M6 6l12 12M18 6 6 18"/>');
const BACK = svg('<path d="m15 18-6-6 6-6"/>');
const CHEVRON = svg('<path d="m9 6 6 6-6 6"/>', 18);
// one icon per tone: delivered, needs attention, problem, on its way
const TONE_ICON = {
  success: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  warn: svg('<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  danger: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  info: svg('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
  neutral: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
};
const REFRESH_MS = 60_000;
const DAY = 24 * 3600 * 1000;

/**
 * @param {object} o
 *   mount: element to insert the bell into (before `before`, if given)
 *   call: async (action, body) => json        authenticated customer API call (throws {status, message} on failure)
 *   onOpenShipment: (code) => void            opens that shipment's details (ownership is checked by the server)
 *   shipmentInfo: (code) => {origin, destination, status} | null   the account's own shipment list, for the detail screen
 *   refreshShipments: async () => void        reloads that list, so the detail screen shows the current status
 */
export function createNotificationCenter({ mount, before = null, call, onOpenShipment, shipmentInfo = () => null, refreshShipments = null }) {
  const state = { items: [], unread: 0, phase: "loading", busy: new Set(), open: false, timer: null, error: "", filter: "all", detail: null };

  const wrap = document.createElement("div");
  wrap.className = "nc";
  wrap.innerHTML = `<button type="button" class="nc-bell" aria-haspopup="dialog" aria-expanded="false" aria-controls="ncPanel">${BELL}<span class="nc-badge" hidden></span></button>`;
  mount.insertBefore(wrap, before);
  // The panel lives in <body>, not in the header: the header's blur effect would otherwise become its positioning box.
  const layer = document.createElement("div");
  layer.className = "nc-layer";
  layer.innerHTML = `<div class="nc-scrim" hidden></div>
    <section class="nc-panel" id="ncPanel" role="dialog" aria-modal="false" aria-labelledby="ncTitle" hidden>
      <div class="nc-grip" aria-hidden="true"></div>
      <div class="nc-view nc-view-list">
        <header class="nc-head"><h2 id="ncTitle" tabindex="-1"></h2>
          <span class="nc-head-actions"><button type="button" class="nc-all" data-act="all"></button>
          <button type="button" class="nc-x" data-act="close">${CLOSE}</button></span></header>
        <div class="nc-tabs" role="tablist">
          <button type="button" role="tab" class="nc-tab" data-filter="all"></button>
          <button type="button" role="tab" class="nc-tab" data-filter="unread"></button>
        </div>
        <div class="nc-body" aria-live="polite"></div>
      </div>
      <div class="nc-view nc-view-detail" hidden>
        <header class="nc-head"><button type="button" class="nc-back" data-act="back">${BACK}<span></span></button>
          <button type="button" class="nc-x" data-act="close">${CLOSE}</button></header>
        <div class="nc-detail"></div>
      </div>
    </section>`;
  document.body.appendChild(layer);
  const bell = wrap.querySelector(".nc-bell"); const badge = wrap.querySelector(".nc-badge");
  const panel = layer.querySelector(".nc-panel"); const body = layer.querySelector(".nc-body"); const scrim = layer.querySelector(".nc-scrim");
  const listView = layer.querySelector(".nc-view-list"); const detailView = layer.querySelector(".nc-view-detail"); const detailBox = layer.querySelector(".nc-detail");

  // ---------- text helpers ----------
  const titleOf = (n) => (n.statusCode ? statusText({ code: n.statusCode, label: n.title }) : n.title || t("notif.update"));
  const msgOf = (n) => (n.shipment ? t(n.statusCode === "CREATED" ? "notif.msgCreated" : "notif.msg", { code: n.shipment, status: titleOf(n) }) : "");
  const toneOf = (n) => (TONE_ICON[n.tone] ? n.tone : "neutral");
  const when = (iso) => {
    const ms = Date.parse(iso); if (!Number.isFinite(ms)) return "";
    const full = fmtDateTime(iso);
    return Date.now() - ms < DAY ? `${full} · ${fmtAgo(iso)}` : full;
  };
  // local calendar day: 0 today, 1 yesterday, 2 earlier
  const dayGroup = (iso) => {
    const d = new Date(iso); if (Number.isNaN(+d)) return 2;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return d >= start ? 0 : d >= new Date(+start - DAY) ? 1 : 2;
  };

  // ---------- rendering ----------
  function renderBell() {
    const n = state.unread;
    badge.hidden = !n; badge.textContent = n > 9 ? "9+" : String(n);
    bell.setAttribute("aria-label", n ? tn("notif.bellUnread", n) : t("notif.bell"));
    bell.title = t("notif.title");
    layer.querySelector("#ncTitle").textContent = t("notif.title");
    const all = layer.querySelector(".nc-all");
    all.textContent = t("notif.markAll"); all.hidden = state.phase !== "ready" || !state.unread; all.disabled = state.busy.has("all");
    layer.querySelectorAll(".nc-x").forEach((b) => b.setAttribute("aria-label", t("notif.close")));
    layer.querySelector(".nc-back span").textContent = t("notif.back");
    for (const tab of layer.querySelectorAll(".nc-tab")) {
      const on = tab.dataset.filter === state.filter;
      tab.setAttribute("aria-selected", String(on)); tab.classList.toggle("is-on", on);
      tab.innerHTML = tab.dataset.filter === "all" ? esc(t("notif.tabAll"))
        : `${esc(t("notif.unread"))}${state.unread ? ` <span class="nc-tab-count">${state.unread > 99 ? "99+" : state.unread}</span>` : ""}`;
    }
  }
  function itemHtml(n) {
    const title = titleOf(n); const busy = state.busy.has(n.id);
    return `<li class="nc-item tone-${esc(toneOf(n))}${n.read ? "" : " is-unread"}" data-id="${esc(n.id)}">
      <button type="button" class="nc-open" data-act="open">
        <span class="nc-ico" aria-hidden="true">${TONE_ICON[toneOf(n)]}</span>
        <span class="nc-main">
          <span class="nc-title">${n.read ? "" : `<span class="nc-dot" aria-hidden="true"></span><span class="nc-sr">${esc(t("notif.unread"))}: </span>`}${esc(title)}</span>
          <span class="nc-msg">${esc(msgOf(n))}</span>
          <time class="nc-time" datetime="${esc(n.createdAt || "")}" title="${esc(fmtDateTime(n.createdAt))}">${esc(when(n.createdAt))}</time>
        </span>
        <span class="nc-chev" aria-hidden="true">${CHEVRON}</span>
      </button>
      ${n.read ? "" : `<button type="button" class="nc-read" data-act="read" aria-label="${esc(t("notif.markReadOne", { title }))}" title="${esc(t("notif.markRead"))}" ${busy ? "disabled" : ""}>${CHECK}</button>`}</li>`;
  }
  function listHtml() {
    const items = state.filter === "unread" ? state.items.filter((n) => !n.read) : state.items;
    if (!items.length) {
      return `<div class="nc-state"><span class="nc-state-ico" aria-hidden="true">${state.filter === "unread" ? CHECK : BELL}</span><p class="nc-state-title">${esc(t("notif.emptyTitle"))}</p>
        <p>${esc(t(state.filter === "unread" ? "notif.noUnread" : "notif.emptyBody"))}</p></div>`;
    }
    const labels = ["notif.today", "notif.yesterday", "notif.earlier"];
    const groups = [[], [], []];
    for (const n of items) groups[dayGroup(n.createdAt)].push(n);
    return groups.map((g, i) => (g.length ? `<h3 class="nc-group">${esc(t(labels[i]))}</h3><ul class="nc-list">${g.map(itemHtml).join("")}</ul>` : "")).join("");
  }
  function renderBody() {
    if (state.phase === "loading" && !state.items.length) {
      body.innerHTML = `<div class="nc-skel" role="status" aria-label="${esc(t("notif.loading"))}">${"<span></span>".repeat(3)}</div>`;
    } else if (state.phase === "error" && !state.items.length) {
      body.innerHTML = `<div class="nc-state" role="alert"><p class="nc-state-title">${esc(t("notif.errorTitle"))}</p><p>${esc(state.error || t("notif.errorBody"))}</p><button type="button" class="nc-retry" data-act="retry">${esc(t("notif.retry"))}</button></div>`;
    } else if (!state.items.length) {
      body.innerHTML = `<div class="nc-state"><span class="nc-state-ico" aria-hidden="true">${BELL}</span><p class="nc-state-title">${esc(t("notif.emptyTitle"))}</p><p>${esc(t("notif.emptyBody"))}</p></div>`;
    } else {
      body.innerHTML = `${state.phase === "error" ? `<p class="nc-inline-err" role="alert">${esc(state.error || t("notif.errorBody"))} <button type="button" class="nc-retry" data-act="retry">${esc(t("notif.retry"))}</button></p>` : ""}${listHtml()}`;
    }
  }
  function renderDetail() {
    const n = state.items.find((x) => x.id === state.detail);
    if (!n) { detailBox.innerHTML = ""; return; }
    const ship = n.shipment ? shipmentInfo(n.shipment) : null;
    detailBox.innerHTML = `<div class="nc-hero tone-${esc(toneOf(n))}">
        <span class="nc-hero-ico" aria-hidden="true">${TONE_ICON[toneOf(n)]}</span>
        <h3 class="nc-hero-title" tabindex="-1">${esc(titleOf(n))}</h3>
        <p class="nc-hero-msg">${esc(msgOf(n))}</p>
        <p class="nc-hero-time"><time datetime="${esc(n.createdAt || "")}">${esc(fmtDateTime(n.createdAt))}</time></p>
      </div>
      ${n.shipment ? `<div class="nc-ship">
        <p class="nc-ship-label">${esc(t("notif.shipment"))}</p>
        <p class="nc-ship-code" dir="ltr">${esc(n.shipment)}</p>
        ${ship ? `<p class="nc-ship-route">${esc(ship.origin || t("route.originNotSet"))} <span aria-hidden="true">→</span> ${esc(ship.destination || t("route.destinationNotSet"))}</p>
        <p class="nc-ship-now"><span>${esc(t("notif.currentStatus"))}</span> <span class="hx-pill tone-${esc(ship.status?.tone || "neutral")}">${esc(statusText(ship.status || {}))}</span></p>` : ""}
      </div>
      <button type="button" class="nc-primary" data-act="view">${esc(t("notif.viewShipment"))}</button>` : ""}`;
  }
  const render = () => { renderBell(); if (state.open) { renderBody(); if (state.detail) renderDetail(); } };

  // ---------- list ⇄ detail ----------
  function showDetail(id) {
    state.detail = id; renderDetail();
    // the list may be older than this notification: reload it, then show the shipment's current status
    refreshShipments?.().then(() => { if (state.open && state.detail === id) renderDetail(); }).catch(() => {});
    listView.hidden = true; detailView.hidden = false;
    panel.classList.add("is-detail");
    detailBox.querySelector(".nc-hero-title")?.focus({ preventScroll: true });
    detailView.scrollTop = 0;
  }
  function showList() {
    const from = state.detail; state.detail = null;
    detailView.hidden = true; listView.hidden = false;
    panel.classList.remove("is-detail");
    renderBody();
    body.querySelector(`.nc-item[data-id="${CSS.escape(from || "")}"] .nc-open`)?.focus({ preventScroll: true });
  }

  // ---------- data (always the server's stored records) ----------
  function apply(r) { state.items = Array.isArray(r?.items) ? r.items : []; state.unread = Number(r?.unread) || 0; state.phase = "ready"; state.error = ""; }
  async function load() {
    if (!state.items.length) state.phase = "loading";
    render();
    try { apply(await call("notifications")); }
    catch (err) { if (err?.status === 401) return; state.phase = "error"; state.error = err?.message || ""; }
    render();
  }
  async function act(key, action, payload) {
    if (state.busy.has(key)) return;
    state.busy.add(key); render();
    try { apply(await call(action, payload)); }
    catch (err) { state.phase = "error"; state.error = err?.message || ""; }
    finally { state.busy.delete(key); render(); }
  }

  // ---------- open / close ----------
  /** Desktop: under the bell, kept inside the window. Phones: the CSS makes it a full-height sheet under the header. */
  function place() {
    if (!state.open) return;
    const r = bell.getBoundingClientRect(); const w = panel.offsetWidth;
    panel.style.top = `${Math.round(r.bottom + 10)}px`;
    const rtl = document.documentElement.dir === "rtl";
    const x = rtl ? r.right - w : r.left;
    panel.style.left = `${Math.round(Math.min(Math.max(12, x), innerWidth - w - 12))}px`;
  }
  function setOpen(open) {
    if (open === state.open) return;
    state.open = open;
    panel.hidden = !open; scrim.hidden = !open; bell.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("nc-open", open);
    if (open) {
      state.detail = null; listView.hidden = false; detailView.hidden = true; panel.classList.remove("is-detail");
      renderBell(); renderBody(); place(); load();
      requestAnimationFrame(() => { place(); layer.querySelector("#ncTitle").focus({ preventScroll: true }); });
    }
  }
  bell.addEventListener("click", () => setOpen(!state.open));
  scrim.addEventListener("click", () => setOpen(false));
  // outside clicks close it; composedPath() is taken when the click happens, so buttons re-drawn by that click still count as inside
  document.addEventListener("click", (e) => { const path = e.composedPath(); if (state.open && !path.includes(wrap) && !path.includes(layer)) setOpen(false); });
  addEventListener("resize", place);
  document.addEventListener("keydown", (e) => {
    if (!state.open || e.key !== "Escape") return;
    if (state.detail) showList(); else { setOpen(false); bell.focus(); }
  });
  panel.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-filter]");
    if (tab) { state.filter = tab.dataset.filter; renderBell(); renderBody(); return; }
    const btn = e.target.closest("[data-act]"); if (!btn || btn.disabled) return;
    const id = btn.closest(".nc-item")?.dataset.id; const n = state.items.find((x) => x.id === id);
    const a = btn.dataset.act;
    if (a === "retry") load();
    if (a === "close") { setOpen(false); bell.focus(); }
    if (a === "back") showList();
    if (a === "all") act("all", "markAllRead");
    if (a === "read" && n) act(n.id, "markRead", { id: n.id });
    if (a === "open" && n) {
      if (!n.read) act(n.id, "markRead", { id: n.id });
      showDetail(n.id);
    }
    if (a === "view") {
      const cur = state.items.find((x) => x.id === state.detail);
      setOpen(false);
      if (cur?.shipment) onOpenShipment(cur.shipment);
    }
  });

  // refresh: on a timer while visible, and when the tab comes back
  const tick = () => { clearTimeout(state.timer); state.timer = setTimeout(() => { if (!document.hidden) load(); tick(); }, REFRESH_MS); };
  const onVis = () => { if (!document.hidden) load(); };
  document.addEventListener("visibilitychange", onVis);
  const offLang = onLang(render);
  load(); tick();

  return {
    refresh: load,
    get unread() { return state.unread; },
    destroy() { clearTimeout(state.timer); offLang(); document.removeEventListener("visibilitychange", onVis); removeEventListener("resize", place); document.documentElement.classList.remove("nc-open"); wrap.remove(); layer.remove(); }
  };
}
