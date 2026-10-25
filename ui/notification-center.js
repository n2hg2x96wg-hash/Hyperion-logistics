// Customer notification center: a bell with the unread count, and a panel listing the customer's notifications.
// Everything shown comes from the server (POST /api/customer), which stores the notifications and checks that they
// belong to the signed-in customer; this module never invents a count or an update.
//   - desktop: a panel under the bell; phones: a sheet under the header (it never covers the bell or the menu button)
//   - read state: one notification ("Mark as read", or by opening it) or all of them ("Mark all as read")
//   - loading, empty and error (with retry) states; refreshes every minute while the page is visible
import { t, tn, esc, fmtDateTime, fmtAgo, onLang } from "./i18n.js";
import { statusText } from "./status-text.js";

const BELL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const REFRESH_MS = 60_000;
const DAY = 24 * 3600 * 1000;

/**
 * @param {object} o
 *   mount: element to insert the bell into (before `before`, if given)
 *   call: async (action, body) => json        authenticated customer API call (throws {status, message} on failure)
 *   onOpenShipment: (code) => void            opens that shipment's details (ownership is checked by the server)
 */
export function createNotificationCenter({ mount, before = null, call, onOpenShipment }) {
  const state = { items: [], unread: 0, phase: "loading", busy: new Set(), open: false, timer: null, error: "" };

  const wrap = document.createElement("div");
  wrap.className = "nc";
  wrap.innerHTML = `<button type="button" class="nc-bell" aria-haspopup="dialog" aria-expanded="false" aria-controls="ncPanel">${BELL}<span class="nc-badge" hidden></span></button>`;
  mount.insertBefore(wrap, before);
  // The panel lives in <body>, not in the header: the header's blur effect would otherwise become its positioning box.
  const layer = document.createElement("div");
  layer.className = "nc-layer";
  layer.innerHTML = `<div class="nc-scrim" hidden></div>
    <section class="nc-panel" id="ncPanel" role="dialog" aria-modal="false" aria-labelledby="ncTitle" hidden>
      <header class="nc-head"><h2 id="ncTitle" tabindex="-1"></h2><button type="button" class="nc-all" data-act="all"></button></header>
      <div class="nc-body" aria-live="polite"></div>
    </section>`;
  document.body.appendChild(layer);
  const bell = wrap.querySelector(".nc-bell"); const badge = wrap.querySelector(".nc-badge");
  const panel = layer.querySelector(".nc-panel"); const body = layer.querySelector(".nc-body"); const scrim = layer.querySelector(".nc-scrim");

  // ---------- rendering ----------
  function renderBell() {
    const n = state.unread;
    badge.hidden = !n; badge.textContent = n > 9 ? "9+" : String(n);
    bell.setAttribute("aria-label", n ? tn("notif.bellUnread", n) : t("notif.bell"));
    bell.title = t("notif.title");
    layer.querySelector("#ncTitle").textContent = t("notif.title");
    const all = layer.querySelector(".nc-all");
    all.textContent = t("notif.markAll"); all.hidden = state.phase !== "ready" || !state.unread; all.disabled = state.busy.has("all");
  }
  const when = (iso) => {
    const ms = Date.parse(iso); if (!Number.isFinite(ms)) return "";
    const full = fmtDateTime(iso);
    return Date.now() - ms < DAY ? `${full} · ${fmtAgo(iso)}` : full;
  };
  function itemHtml(n) {
    const title = n.statusCode ? statusText({ code: n.statusCode, label: n.title }) : n.title || t("notif.update");
    const msg = n.shipment ? t(n.statusCode === "CREATED" ? "notif.msgCreated" : "notif.msg", { code: n.shipment, status: title }) : "";
    const busy = state.busy.has(n.id);
    return `<li class="nc-item tone-${esc(n.tone || "neutral")}${n.read ? "" : " is-unread"}" data-id="${esc(n.id)}">
      <button type="button" class="nc-open" data-act="open" ${n.shipment ? "" : "disabled"}>
        <span class="nc-title">${n.read ? "" : `<span class="nc-dot" aria-hidden="true"></span><span class="nc-sr">${esc(t("notif.unread"))}: </span>`}${esc(title)}</span>
        <span class="nc-msg">${esc(msg)}</span>
        <time class="nc-time" datetime="${esc(n.createdAt || "")}">${esc(when(n.createdAt))}</time>
      </button>
      ${n.read ? "" : `<button type="button" class="nc-read" data-act="read" aria-label="${esc(t("notif.markReadOne", { title }))}" title="${esc(t("notif.markRead"))}" ${busy ? "disabled" : ""}>${CHECK}</button>`}</li>`;
  }
  function renderBody() {
    if (state.phase === "loading" && !state.items.length) {
      body.innerHTML = `<div class="nc-skel" role="status" aria-label="${esc(t("notif.loading"))}">${"<span></span>".repeat(3)}</div>`;
    } else if (state.phase === "error" && !state.items.length) {
      body.innerHTML = `<div class="nc-state" role="alert"><p class="nc-state-title">${esc(t("notif.errorTitle"))}</p><p>${esc(state.error || t("notif.errorBody"))}</p><button type="button" class="nc-retry" data-act="retry">${esc(t("notif.retry"))}</button></div>`;
    } else if (!state.items.length) {
      body.innerHTML = `<div class="nc-state"><span class="nc-state-ico" aria-hidden="true">${BELL}</span><p class="nc-state-title">${esc(t("notif.emptyTitle"))}</p><p>${esc(t("notif.emptyBody"))}</p></div>`;
    } else {
      body.innerHTML = `${state.phase === "error" ? `<p class="nc-inline-err" role="alert">${esc(state.error || t("notif.errorBody"))} <button type="button" class="nc-retry" data-act="retry">${esc(t("notif.retry"))}</button></p>` : ""}
        <ul class="nc-list">${state.items.map(itemHtml).join("")}</ul>`;
    }
  }
  const render = () => { renderBell(); if (state.open) renderBody(); };

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
  /** Desktop: under the bell, kept inside the window. Phones: the CSS makes it a full-width sheet under the header. */
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
    if (open) { renderBody(); place(); load(); requestAnimationFrame(() => { place(); layer.querySelector("#ncTitle").focus({ preventScroll: true }); }); }
  }
  bell.addEventListener("click", () => setOpen(!state.open));
  scrim.addEventListener("click", () => setOpen(false));
  // outside clicks close it; composedPath() is taken when the click happens, so buttons re-drawn by that click still count as inside
  document.addEventListener("click", (e) => { const path = e.composedPath(); if (state.open && !path.includes(wrap) && !path.includes(layer)) setOpen(false); });
  addEventListener("resize", place);
  document.addEventListener("keydown", (e) => { if (state.open && e.key === "Escape") { setOpen(false); bell.focus(); } });
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn || btn.disabled) return;
    const id = btn.closest(".nc-item")?.dataset.id; const n = state.items.find((x) => x.id === id);
    if (btn.dataset.act === "retry") load();
    if (btn.dataset.act === "all") act("all", "markAllRead");
    if (btn.dataset.act === "read" && n) act(n.id, "markRead", { id: n.id });
    if (btn.dataset.act === "open" && n) {
      if (!n.read) act(n.id, "markRead", { id: n.id });
      setOpen(false);
      if (n.shipment) onOpenShipment(n.shipment);
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
