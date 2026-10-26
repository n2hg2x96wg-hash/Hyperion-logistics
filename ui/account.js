// "My account" page (account.html): a customer signs in with the client account Hyperion created for them, sees the
// shipments linked to that account, opens one in the standard tracking view, and gets a notification for each new
// status of those shipments (ui/notification-center.js).
//
// Sign-in: Firebase Authentication with the existing client accounts (client-auth.js, session-only persistence and a
// 30-minute inactivity sign-out). Every request sends the Firebase ID token; the server checks it and scopes all data
// to that account (api/customer.js). On the local in-memory development store, which has no Firebase, the page uses
// the store's built-in test accounts instead (the server only allows that outside production).
import { createTracker } from "../tracker/tracker.js";
import { t, esc, onLang, applyI18n } from "./i18n.js";
import { statusText } from "./status-text.js";
import { createNotificationCenter } from "./notification-center.js";

const FIREBASE_CONFIG = { // public web configuration (the same as the admin page); access is enforced on the server
  apiKey: "AIzaSyDRd7FFT2ycMaLvdgvYyauQz13nCnfGOss", authDomain: "hyperion-logistics.firebaseapp.com", projectId: "hyperion-logistics",
  storageBucket: "hyperion-logistics.firebasestorage.app", messagingSenderId: "481927084665", appId: "1:481927084665:web:6c067752a922890e44f2a8"
};
const DEV_TOKEN = "hx-account-dev-token";
const root = document.getElementById("account");
const header = document.querySelector("[data-site-header] .wrap");

let auth = null; // { mode, token(), signIn(email, pw), signOut(), watch(cb) }
let center = null; let tracker = null; let me = null; let shipments = []; let openCode = null; let view = "loading";

// ---------- authentication ----------
async function makeAuth() {
  const mode = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mode" }) })
    .then((r) => r.json()).then((j) => j.signIn).catch(() => "firebase");
  if (mode === "dev") {
    const get = () => { try { return sessionStorage.getItem(DEV_TOKEN); } catch { return null; } };
    const set = (v) => { try { if (v) sessionStorage.setItem(DEV_TOKEN, v); else sessionStorage.removeItem(DEV_TOKEN); } catch { /* private mode */ } };
    let listener = null;
    return {
      mode, token: async () => get(),
      async signIn(email, password) {
        const r = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "devLogin", email, password }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.message || ""), { code: r.status === 401 ? "auth/invalid-credential" : r.status === 429 ? "auth/too-many-requests" : "auth/network-request-failed" });
        set(j.token); listener?.(true);
      },
      async signOut() { set(null); listener?.(false); },
      watch(cb) { listener = cb; cb(!!get()); }
    };
  }
  const { createClientAuth } = await import("../client-auth.js");
  const fb = createClientAuth(FIREBASE_CONFIG);
  return {
    mode, token: async () => (fb.auth.currentUser ? fb.auth.currentUser.getIdToken() : null),
    signIn: (email, password) => fb.login(email, password),
    signOut: () => fb.logout(),
    watch(cb) {
      fb.monitorAuth({
        onAuthorized: () => cb(true), onTimeout: () => cb(false, "timeout"),
        onUnauthorized: (reason) => cb(false, reason === "error" ? "error" : reason ? "inactive" : null),
        // the server checks the account (active profile, not disabled), so nothing depends on browser database access
        verifyProfile: async (user) => {
          const res = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ action: "me" }) });
          if (res.ok) return { status: "active" };
          if (res.status === 401 || res.status === 403) return null; // not a customer account, or not active
          throw new Error(`account check failed (${res.status})`);
        }
      });
    }
  };
}

/** Authenticated call to the customer API. Throws { status, message }; a 401 signs the visitor out. */
async function call(action, body = {}) {
  const token = await auth.token();
  if (!token) { showSignedOut("expired"); throw Object.assign(new Error(t("acct.err.expired")), { status: 401 }); }
  let res;
  try { res = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...body }) }); }
  catch { throw Object.assign(new Error(t("acct.err.network")), { status: 0 }); }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { await auth.signOut().catch(() => {}); showSignedOut("expired"); throw Object.assign(new Error(t("acct.err.expired")), { status: 401 }); }
  if (res.status === 403) { await auth.signOut().catch(() => {}); showSignedOut("inactive"); throw Object.assign(new Error(t("acct.err.inactive")), { status: 403 }); }
  if (!res.ok) throw Object.assign(new Error(res.status === 404 ? t("acct.err.notFound") : t("acct.err.generic")), { status: res.status });
  return json;
}

// ---------- views ----------
const SIGN_IN_ERRORS = {
  "auth/invalid-credential": "acct.err.credentials", "auth/wrong-password": "acct.err.credentials", "auth/user-not-found": "acct.err.credentials",
  "auth/invalid-email": "acct.err.credentials", "auth/user-disabled": "acct.err.inactive", "auth/too-many-requests": "acct.err.tooMany",
  "auth/network-request-failed": "acct.err.network"
};
let signedOutReason = null;
function showSignedOut(reason = null) {
  signedOutReason = reason; view = "signin";
  center?.destroy(); center = null; tracker?.destroy(); tracker = null; me = null; shipments = []; openCode = null;
  document.documentElement.classList.remove("acct-sheet-open");
  render();
}

function render() {
  if (view === "loading") { root.innerHTML = `<div class="acct-loading" role="status">${esc(t("common.loading"))}</div>`; return; }
  if (view === "signin") return renderSignIn();
  renderDashboard();
}

function renderSignIn() {
  const note = signedOutReason === "expired" || signedOutReason === "timeout" ? t("acct.note.expired") : signedOutReason === "inactive" ? t("acct.err.inactive") : signedOutReason === "error" ? t("acct.err.network") : "";
  root.innerHTML = `<section class="acct-signin" aria-labelledby="acctSignInTitle">
    <h1 id="acctSignInTitle">${esc(t("acct.signIn.title"))}</h1>
    <p class="acct-lead">${esc(t("acct.signIn.lead"))}</p>
    ${note ? `<p class="acct-note" role="status">${esc(note)}</p>` : ""}
    <form class="acct-form" novalidate>
      <label for="acctEmail">${esc(t("acct.email"))}</label>
      <input id="acctEmail" name="email" type="email" autocomplete="username" inputmode="email" required dir="ltr">
      <label for="acctPassword">${esc(t("acct.password"))}</label>
      <input id="acctPassword" name="password" type="password" autocomplete="current-password" required dir="ltr">
      <p class="acct-error" role="alert" id="acctError"></p>
      <button type="submit" class="acct-submit">${esc(t("acct.signIn.button"))}</button>
    </form>
    <p class="acct-help">${esc(t("acct.signIn.help"))} <a href="mailto:hyperionlogistics.com@gmail.com" dir="ltr">hyperionlogistics.com@gmail.com</a></p>
    <p class="acct-help"><a href="/track.html">${esc(t("acct.signIn.trackInstead"))}</a></p>
  </section>`;
  const form = root.querySelector("form"); const err = root.querySelector("#acctError"); const btn = root.querySelector(".acct-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim(); const password = form.password.value;
    if (!email || !password) { err.textContent = t("acct.err.missing"); (email ? form.password : form.email).focus(); return; }
    btn.disabled = true; btn.textContent = t("acct.signIn.busy"); err.textContent = "";
    try { signedOutReason = null; await auth.signIn(email, password); }
    catch (e2) { err.textContent = t(SIGN_IN_ERRORS[e2?.code] || "acct.err.generic"); btn.disabled = false; btn.textContent = t("acct.signIn.button"); form.password.select(); }
  });
}

function shipmentRow(s) {
  return `<li><button type="button" class="acct-ship${s.code === openCode ? " is-open" : ""}" data-code="${esc(s.code)}" aria-expanded="${s.code === openCode}" aria-controls="acctDetails">
    <span class="acct-ship-code" dir="ltr">${esc(s.code)}</span>
    <span class="acct-ship-route">${esc(s.origin || t("route.originNotSet"))} <span class="acct-arrow" aria-hidden="true">→</span> ${esc(s.destination || t("route.destinationNotSet"))}</span>
    <span class="hx-pill acct-pill tone-${esc(s.status.tone)}">${esc(statusText(s.status))}</span></button></li>`;
}

function renderDashboard() {
  root.innerHTML = `<section class="acct-dash" aria-labelledby="acctTitle">
    <div class="acct-top">
      <div><h1 id="acctTitle">${esc(me?.name ? t("acct.hello", { name: me.name.split(/\s+/)[0] }) : t("acct.title"))}</h1>
        <p class="acct-lead">${esc(t("acct.lead"))}</p></div>
      <button type="button" class="acct-signout">${esc(t("acct.signOut"))}</button>
    </div>
    <h2 class="acct-h2">${esc(t("acct.shipments"))}</h2>
    <div class="acct-ships" aria-live="polite">${shipmentsHtml()}</div>
    <div id="acctDetails" class="acct-details${openCode && sheetMode() ? " is-sheet" : ""}"${openCode ? "" : " hidden"} role="region" aria-labelledby="acctDetailsTitle">
      <div class="acct-details-head">
        <button type="button" class="acct-back" aria-label="${esc(t("acct.backToShipments"))}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
        <div class="acct-details-titles"><h2 class="acct-h2" id="acctDetailsTitle" tabindex="-1">${esc(t("acct.details"))}</h2><p class="acct-details-code" dir="ltr">${esc(openCode || "")}</p></div>
        <button type="button" class="acct-close">${esc(t("acct.closeDetails"))}</button></div><div id="acctTracker"></div></div>
  </section>`;
  root.querySelector(".acct-signout").addEventListener("click", () => auth.signOut().then(() => showSignedOut(null)));
  root.querySelector(".acct-close").addEventListener("click", () => closeShipment());
  root.querySelector(".acct-back").addEventListener("click", () => closeShipment());
  root.querySelector(".acct-ships").addEventListener("click", (e) => {
    const b = e.target.closest("[data-code]"); if (b) (b.dataset.code === openCode ? closeShipment() : openShipment(b.dataset.code));
    if (e.target.closest("[data-act=retry-ships]")) loadShipments();
  });
  // the tracking view keeps its element across re-renders (e.g. a language change)
  const slot = root.querySelector("#acctTracker");
  if (tracker && trackerEl) slot.replaceWith(trackerEl); else trackerEl = slot;
}
let trackerEl = null;
let shipState = "loading";
function shipmentsHtml() {
  if (shipState === "loading") return `<div class="acct-skel" role="status" aria-label="${esc(t("common.loading"))}"><span></span><span></span></div>`;
  if (shipState === "error") return `<div class="acct-empty" role="alert"><p>${esc(t("acct.shipmentsError"))}</p><button type="button" class="acct-retry" data-act="retry-ships">${esc(t("notif.retry"))}</button></div>`;
  if (!shipments.length) return `<div class="acct-empty"><p class="acct-empty-title">${esc(t("acct.noShipments"))}</p><p>${esc(t("acct.noShipmentsBody"))}</p><a href="/track.html">${esc(t("acct.trackByNumber"))}</a></div>`;
  return `<ul class="acct-list">${shipments.map(shipmentRow).join("")}</ul>`;
}
async function loadShipments({ quiet = false } = {}) {
  if (!quiet || shipState !== "ready") { shipState = "loading"; refreshList(); } // a quiet reload keeps the list on screen
  try { shipments = (await call("shipments")).shipments || []; shipState = "ready"; }
  catch (err) { if (err.status === 401 || err.status === 403) return; shipState = "error"; }
  refreshList();
}
function refreshList() { const el = root.querySelector(".acct-ships"); if (el) el.innerHTML = shipmentsHtml(); }

// Phones: the details open as a full screen over the list, like an app screen, with a back button; the phone's own back
// gesture/button closes it too (one history entry while it is open). Wider screens keep them below the list.
const sheetQuery = matchMedia("(max-width: 640px)");
const sheetMode = () => sheetQuery.matches;
let sheetEntry = false; // a history entry was added for the open sheet
addEventListener("popstate", () => { if (sheetEntry) { sheetEntry = false; closeShipment({ fromHistory: true }); } });
sheetQuery.addEventListener?.("change", () => { const box = root.querySelector("#acctDetails"); if (box && openCode) setSheet(box, sheetMode()); });
function setSheet(box, on) {
  box.classList.toggle("is-sheet", on);
  document.documentElement.classList.toggle("acct-sheet-open", on);
}

/** Opens a shipment from the list or a notification. The server returns it only if it is linked to this account. */
function openShipment(code) {
  openCode = code; refreshList();
  const box = root.querySelector("#acctDetails"); if (!box) return;
  box.hidden = false;
  box.querySelector(".acct-details-code").textContent = code;
  setSheet(box, sheetMode());
  if (sheetMode() && !sheetEntry) { history.pushState({ acctSheet: code }, ""); sheetEntry = true; }
  if (!tracker) {
    tracker = createTracker(trackerEl, {
      realtime: false,
      loadView: async (c) => {
        try { return { status: "ok", view: (await call("shipment", { code: c })).shipment }; }
        catch (err) { return { status: err.status === 404 ? "notfound" : "error" }; }
      }
    });
  }
  tracker.track(code);
  if (sheetMode()) { box.scrollTop = 0; box.querySelector("#acctDetailsTitle")?.focus({ preventScroll: true }); }
  else box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function closeShipment({ fromHistory = false } = {}) {
  const was = openCode;
  openCode = null; tracker?.clear(); refreshList();
  const box = root.querySelector("#acctDetails");
  if (box) { box.hidden = true; setSheet(box, false); }
  if (sheetEntry && !fromHistory) { sheetEntry = false; history.back(); }
  if (was) root.querySelector(`[data-code="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
}

async function showSignedIn() {
  view = "dashboard"; shipState = "loading"; render();
  try { me = await call("me"); } catch { return; }
  render();
  if (!center) center = createNotificationCenter({ mount: header, before: header.querySelector(".lang-pick") || header.querySelector("[data-theme-toggle]"), call, onOpenShipment: openShipment,
    shipmentInfo: (code) => shipments.find((x) => x.code === code) || null, refreshShipments: () => loadShipments({ quiet: true }) });
  loadShipments();
}

// ---------- start ----------
render();
onLang(() => { if (view !== "dashboard") render(); else { const keep = openCode; render(); refreshList(); if (keep) { const box = root.querySelector("#acctDetails"); box.hidden = false; setSheet(box, sheetMode()); } } applyI18n(root); });
makeAuth().then((a) => {
  auth = a;
  a.watch((signedIn, reason) => { if (signedIn) showSignedIn(); else showSignedOut(reason || signedOutReason); });
}).catch(() => { root.innerHTML = `<p class="acct-error" role="alert">${esc(t("acct.err.network"))}</p>`; });
