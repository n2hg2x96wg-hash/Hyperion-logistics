// Client profile screen in the admin console (Clients → tap a client). Phones: a full screen over the console with a
// back button (the phone's back gesture closes it too); wider screens: a large panel. Shows the client's account, quick
// actions, their linked shipments and the notifications they received (read state included), loaded read-only from
// POST /api/admin { action: "clientActivity" }. Tapping a notification opens its own screen; tapping a shipment opens
// the usual shipment editor. Nothing here changes data except through the existing actions (Edit, Suspend/Activate).

const esc = (v = "") => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  back: svg('<path d="m15 18-6-6 6-6"/>', 22),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  pause: svg('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'),
  play: svg('<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5Z"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 18),
  bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
};
const TONE_ICON = {
  success: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  warn: svg('<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  danger: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  info: svg('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
  neutral: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
};
const toneOf = (n) => (TONE_ICON[n?.tone] ? n.tone : "neutral");
const fmt = (iso, opts = { dateStyle: "medium", timeStyle: "short" }) => {
  const d = new Date(iso); return iso && !Number.isNaN(+d) ? new Intl.DateTimeFormat(undefined, opts).format(d) : "—";
};
const initials = (c) => ((c.name || c.email || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
const msgOf = (n) => (n.shipment ? (n.statusCode === "CREATED" ? `Shipment ${n.shipment} has been registered.` : `Shipment ${n.shipment} is now: ${n.title || "updated"}.`) : "");

/**
 * @param {object} o
 *   api: (action, body) => Promise<json>            the console's authenticated admin API
 *   statusInfo: (client) => {key, label}            "active" | "pending" | "suspended" and its label
 *   actions: { edit(id), toggle(id) => Promise, newShipment(id) }
 *   extraRows: (client) => [label, value][]         remaining details (sign-in account, holdings, notes, id …)
 */
export function createClientProfile({ api, statusInfo, actions, extraRows }) {
  const root = document.createElement("div");
  root.className = "cp-layer"; root.hidden = true;
  root.innerHTML = `<div class="cp-scrim" data-act="close"></div>
    <section class="cp" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
      <header class="cp-bar"><button type="button" class="cp-back" data-act="back" aria-label="Back to clients">${I.back}</button>
        <h2 class="cp-bar-title" id="cpTitle" tabindex="-1"></h2>
        <button type="button" class="cp-x" data-act="close" aria-label="Close">${I.close}</button></header>
      <div class="cp-scroll"><div class="cp-main"></div><div class="cp-note" hidden></div></div>
    </section>`;
  document.body.appendChild(root);
  const main = root.querySelector(".cp-main"); const noteView = root.querySelector(".cp-note");
  const sheet = root.querySelector(".cp"); const title = root.querySelector("#cpTitle");

  let client = null; let activity = null; let phase = "loading"; let filter = "all"; let noteId = null;
  let historyEntry = false;
  const phoneQuery = matchMedia("(max-width: 760px)");

  function render() {
    if (!client) return;
    const st = statusInfo(client);
    const shipCount = activity ? activity.shipments.length : client.shipments?.count;
    title.textContent = noteId ? "Notification" : client.name || client.email;
    main.innerHTML = `
      <div class="cp-hero">
        <span class="cp-avatar" aria-hidden="true">${esc(initials(client))}</span>
        <div class="cp-hero-text">
          <h3 class="cp-name">${esc(client.name || "—")}</h3>
          <p class="cp-email">${esc(client.email || "")}</p>
          <p class="cp-meta"><span class="client-state ${st.key === "active" ? "active" : st.key === "pending" ? "pending" : "inactive"}">${esc(st.label)}</span>
            <span>Client since ${esc(fmt(client.registeredAt, { dateStyle: "medium" }))}</span></p>
        </div>
      </div>
      <div class="cp-actions">
        <button type="button" class="cp-act" data-act="edit">${I.edit}<span>Edit</span></button>
        <button type="button" class="cp-act${st.key === "active" ? " is-warn" : ""}" data-act="toggle">${st.key === "active" ? I.pause : I.play}<span>${st.key === "active" ? "Suspend" : "Activate"}</span></button>
        ${client.email ? `<a class="cp-act" href="mailto:${esc(client.email)}">${I.mail}<span>Email</span></a>` : ""}
        ${client.phone ? `<a class="cp-act" href="tel:${esc(String(client.phone).replace(/[^\d+]/g, ""))}">${I.phone}<span>Call</span></a>` : ""}
        <button type="button" class="cp-act" data-act="newShipment">${I.plus}<span>New shipment</span></button>
      </div>
      <div class="cp-stats">
        <div><strong>${shipCount == null ? "—" : shipCount}</strong><span>Shipments</span></div>
        <div><strong>${activity ? activity.unread : "—"}</strong><span>Unread notifications</span></div>
        <div><strong>${esc(client.lastSignInAt ? fmt(client.lastSignInAt, { dateStyle: "medium" }) : "Never")}</strong><span>Last sign-in</span></div>
      </div>
      ${phase === "error" ? `<div class="cp-error" role="alert">This client's shipments and notifications could not be loaded. <button type="button" class="btn-action" data-act="retry">Try again</button></div>` : ""}
      <section class="cp-sec" aria-labelledby="cpShips"><h4 id="cpShips">Shipments</h4>${shipmentsHtml()}</section>
      <section class="cp-sec" aria-labelledby="cpNotes"><div class="cp-sec-head"><h4 id="cpNotes">Notifications</h4>
        <div class="cp-tabs" role="tablist">${["all", "unread"].map((f) => `<button type="button" role="tab" class="cp-tab${filter === f ? " is-on" : ""}" aria-selected="${filter === f}" data-filter="${f}">${f === "all" ? "All" : `Unread${activity?.unread ? ` <span class="cp-count">${activity.unread}</span>` : ""}`}</button>`).join("")}</div></div>
        ${notificationsHtml()}</section>
      <section class="cp-sec" aria-labelledby="cpDetails"><h4 id="cpDetails">Details</h4>
        <dl class="cp-dl">${[["Email", client.email || "—"], ["Phone", client.phone || "—"], ["Last activity", fmt(client.lastActivityAt)], ...extraRows(client)]
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></section>`;
  }
  function shipmentsHtml() {
    if (phase === "loading") return '<div class="cp-skel"><span></span><span></span></div>';
    if (!activity) return "";
    if (!activity.shipments.length) return '<p class="cp-empty">No shipments are linked to this client yet. Use “New shipment” to register one for them.</p>';
    return `<ul class="cp-list">${activity.shipments.map((s) => `<li><button type="button" class="cp-row" data-act="ship" data-code="${esc(s.code)}">
        <span class="cp-row-ico tone-${esc(s.status?.tone || "neutral")}" aria-hidden="true">${TONE_ICON[TONE_ICON[s.status?.tone] ? s.status.tone : "neutral"]}</span>
        <span class="cp-row-main"><strong>${esc(s.code)}</strong><span>${esc(s.origin || "Origin not set")} → ${esc(s.destination || "Destination not set")}</span>
          <span class="cp-row-pill"><span class="pill ${esc(s.status?.tone || "neutral")}">${esc(s.status?.label || "")}</span></span></span>
        <span class="cp-chev" aria-hidden="true">${I.chev}</span></button></li>`).join("")}</ul>`;
  }
  function notificationsHtml() {
    if (phase === "loading") return '<div class="cp-skel"><span></span><span></span><span></span></div>';
    if (!activity) return "";
    const items = filter === "unread" ? activity.notifications.filter((n) => !n.read) : activity.notifications;
    if (!items.length) return `<p class="cp-empty">${filter === "unread" ? "Everything has been read." : "No notifications have been sent to this client yet. They get one each time one of their shipments has a new status."}</p>`;
    return `<ul class="cp-list">${items.map((n) => `<li><button type="button" class="cp-row cp-note-row${n.read ? "" : " is-unread"}" data-act="note" data-id="${esc(n.id)}">
        <span class="cp-row-ico tone-${esc(toneOf(n))}" aria-hidden="true">${TONE_ICON[toneOf(n)]}</span>
        <span class="cp-row-main"><strong>${n.read ? "" : '<span class="cp-dot" aria-hidden="true"></span>'}${esc(n.title || "Shipment update")}</strong>
          <span>${esc(msgOf(n))}</span><small>${esc(fmt(n.createdAt))} · ${n.read ? "Read" : "Not read yet"}</small></span>
        <span class="cp-chev" aria-hidden="true">${I.chev}</span></button></li>`).join("")}</ul>`;
  }
  function renderNote() {
    const n = activity?.notifications.find((x) => x.id === noteId);
    if (!n) { showMain(); return; }
    const ship = activity.shipments.find((s) => s.code === n.shipment);
    noteView.innerHTML = `<div class="cp-note-hero tone-${esc(toneOf(n))}"><span class="cp-note-ico" aria-hidden="true">${TONE_ICON[toneOf(n)]}</span>
        <h3>${esc(n.title || "Shipment update")}</h3><p>${esc(msgOf(n))}</p>
        <dl class="cp-dl cp-note-dl"><div><dt>Sent</dt><dd>${esc(fmt(n.createdAt))}</dd></div>
          <div><dt>Read by the client</dt><dd>${n.read ? esc(n.readAt ? fmt(n.readAt) : "Yes") : "Not yet"}</dd></div></dl></div>
      ${n.shipment ? `<div class="cp-note-ship"><p class="cp-label">Shipment</p><p class="cp-note-code">${esc(n.shipment)}</p>
        ${ship ? `<p>${esc(ship.origin || "Origin not set")} → ${esc(ship.destination || "Destination not set")}</p><p class="cp-now">Current status <span class="pill ${esc(ship.status?.tone || "neutral")}">${esc(ship.status?.label || "")}</span></p>` : ""}
        <button type="button" class="btn-action cp-primary" data-act="ship" data-code="${esc(n.shipment)}">Open shipment</button></div>` : ""}`;
  }
  function showNote(id) {
    noteId = id; renderNote(); main.hidden = true; noteView.hidden = false; sheet.classList.add("is-note");
    title.textContent = "Notification"; root.querySelector(".cp-scroll").scrollTop = 0; title.focus({ preventScroll: true });
    root.querySelector(".cp-back").setAttribute("aria-label", "Back to client");
  }
  function showMain() {
    const from = noteId; noteId = null; noteView.hidden = true; main.hidden = false; sheet.classList.remove("is-note"); render();
    root.querySelector(".cp-back").setAttribute("aria-label", "Back to clients");
    if (from) main.querySelector(`[data-act="note"][data-id="${CSS.escape(from)}"]`)?.focus({ preventScroll: true });
  }

  async function loadActivity() {
    phase = "loading"; render();
    try { activity = await api("clientActivity", { id: client.id }); phase = "ready"; }
    catch { phase = "error"; }
    if (noteId) renderNote(); else render();
  }

  function open(c) {
    client = c; activity = null; filter = "all"; noteId = null;
    main.hidden = false; noteView.hidden = true; sheet.classList.remove("is-note");
    root.hidden = false; document.documentElement.classList.add("cp-open");
    root.querySelector(".cp-scroll").scrollTop = 0;
    render(); title.focus({ preventScroll: true });
    if (phoneQuery.matches && !historyEntry) { history.pushState({ clientProfile: c.id }, ""); historyEntry = true; }
    loadActivity();
  }
  function close({ fromHistory = false } = {}) {
    if (root.hidden) return;
    root.hidden = true; document.documentElement.classList.remove("cp-open");
    const id = client?.id; client = null; noteId = null;
    if (historyEntry && !fromHistory) { historyEntry = false; history.back(); }
    document.querySelector(`[data-client="${CSS.escape(id || "")}"] [data-action="view"]`)?.focus({ preventScroll: true });
  }
  addEventListener("popstate", () => { if (historyEntry) { historyEntry = false; close({ fromHistory: true }); } });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || e.key !== "Escape" || document.querySelector(".modal-overlay.show")) return;
    if (noteId) showMain(); else close();
  });

  root.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-filter]");
    if (tab) { filter = tab.dataset.filter; render(); return; }
    const b = e.target.closest("[data-act]"); if (!b || !client) return;
    const a = b.dataset.act; const id = client.id;
    if (a === "close") close();
    if (a === "back") { if (noteId) showMain(); else close(); }
    if (a === "retry") loadActivity();
    if (a === "note") showNote(b.dataset.id);
    if (a === "ship") window.editShipment?.(b.dataset.code); // the editor opens above this screen
    if (a === "edit") { close(); actions.edit(id); }
    if (a === "newShipment") { close(); actions.newShipment(id); }
    if (a === "toggle") { b.disabled = true; const updated = await actions.toggle(id).catch(() => null); if (updated && client?.id === id) { client = updated; render(); } else b.disabled = false; }
  });

  return { open, close, update(c) { if (client && c?.id === client.id) { client = c; if (!noteId) render(); } } };
}
