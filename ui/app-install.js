// Installable app: registers the service worker (sw.js, network-only apart from an offline page) and shows how to add
// Hyperion to the home screen.
// - My account: a card with the steps for this phone (iPhone/iPad: Share → Add to Home Screen → Add; Android: menu →
//   Install app → Install). Where the browser offers its own install prompt (Chrome, Edge, Samsung Internet), the card
//   also has an "Install app" button that opens it. Hidden once installed or after "Not now".
// - Every public page: "Get the app" in the phone menu opens the same steps in a dialog, even after "Not now".
import { t, esc, onLang } from "./i18n.js";

const DISMISS_KEY = "hx-install-dismissed";

// https only: the local dev server (http) and its browser tests run without a service worker
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } };

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>'),
  addHome: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  done: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  dots: svg('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>'),
  install: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
};
const STEPS = {
  ios: [["share", "app.ios.s1", "app.ios.s1hint"], ["addHome", "app.ios.s2", "app.ios.s2hint"], ["done", "app.ios.s3"]],
  android: [["dots", "app.android.s1"], ["install", "app.android.s2"], ["done", "app.android.s3"]],
};

function stepsHtml(kind) {
  return `<ol class="app-steps">${STEPS[kind].map(([icon, key, hint]) => `
    <li><span class="app-step-ico">${ICON[icon]}</span><span class="app-step-text"><strong>${esc(t(key))}</strong>${hint ? `<small>${esc(t(hint))}</small>` : ""}</span></li>`).join("")}</ol>`;
}

let deferred = null; // the browser's install prompt, kept until a button is pressed
async function promptInstall() {
  const p = deferred; deferred = null;
  await p?.prompt(); await p?.userChoice.catch(() => {});
  render(); renderDialog();
}

// ---------- My account card ----------
let card = null;
function render() {
  const main = document.querySelector(".acct-main");
  const kind = isIOS() ? "ios" : isAndroid() ? "android" : null;
  if (!main || standalone() || dismissed() || (!deferred && !kind)) { card?.remove(); card = null; return; }
  if (!card) { card = document.createElement("div"); card.className = "wrap"; main.appendChild(card); }
  card.innerHTML = `<section class="app-install" aria-labelledby="appInstallTitle">
    <div class="app-install-head">
      <img class="app-install-icon" src="/assets/app/icon-192.png" alt="" width="56" height="56">
      <div class="app-install-text">
        <h2 id="appInstallTitle">${esc(t("app.install.title"))}</h2>
        <p>${esc(t("app.install.lead"))}</p>
      </div>
    </div>
    ${deferred ? "" : stepsHtml(kind)}
    <div class="app-install-actions">
      ${deferred ? `<button type="button" class="app-install-go">${esc(t("app.install.button"))}</button>` : ""}
      <button type="button" class="app-install-later">${esc(t("app.install.dismiss"))}</button>
    </div></section>`;
  card.querySelector(".app-install-go")?.addEventListener("click", promptInstall);
  card.querySelector(".app-install-later").addEventListener("click", () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode: hidden for this visit only */ }
    card.remove(); card = null;
  });
}

// ---------- "Get the app" (phone menu) and its dialog ----------
let dialog = null;
function renderDialog() {
  if (!dialog) return;
  const kind = isIOS() ? "ios" : isAndroid() ? "android" : null;
  // a computer without an install prompt: both sets of phone steps
  const body = deferred ? "" : kind ? stepsHtml(kind)
    : `<h3>${esc(t("app.install.onIphone"))}</h3>${stepsHtml("ios")}<h3>${esc(t("app.install.onAndroid"))}</h3>${stepsHtml("android")}`;
  dialog.innerHTML = `<div class="app-install app-dialog-body">
    <div class="app-install-head">
      <img class="app-install-icon" src="/assets/app/icon-192.png" alt="" width="56" height="56">
      <div class="app-install-text">
        <h2 id="appDialogTitle">${esc(t("app.install.title"))}</h2>
        <p>${esc(t(standalone() ? "app.install.already" : "app.install.lead"))}</p>
      </div>
    </div>
    ${standalone() ? "" : body}
    <div class="app-install-actions">
      ${deferred && !standalone() ? `<button type="button" class="app-install-go">${esc(t("app.install.button"))}</button>` : ""}
      <button type="button" class="app-install-later" data-close>${esc(t("app.install.close"))}</button>
    </div></div>`;
  dialog.querySelector(".app-install-go")?.addEventListener("click", () => { dialog.close(); promptInstall(); });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
}
function openDialog() {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.setAttribute("aria-labelledby", "appDialogTitle");
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // tap outside closes
    document.body.appendChild(dialog);
  }
  renderDialog();
  dialog.showModal();
}
function mountMenuItem() {
  const menu = document.querySelector("[data-site-header] .nav-menu");
  if (!menu || standalone() || menu.querySelector("[data-get-app]")) return;
  menu.insertAdjacentHTML("beforeend", `<li class="nav-app"><a href="#get-app" data-get-app data-i18n="app.install.menu">${esc(t("app.install.menu"))}</a></li>`);
  menu.querySelector("[data-get-app]").addEventListener("click", (e) => { e.preventDefault(); openDialog(); });
}

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; render(); renderDialog(); });
addEventListener("appinstalled", () => { deferred = null; render(); renderDialog(); });
onLang(() => { render(); renderDialog(); });
function init() { mountMenuItem(); render(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
