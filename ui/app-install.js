// Installable app: registers the service worker (sw.js, network-only apart from an offline page) and, on the
// "My account" page, offers to add Hyperion to the home screen. Browsers that support an install prompt (Chrome, Edge,
// Samsung Internet on Android and desktop) get an "Install app" button; iPhone and iPad get the Share → Add to Home
// Screen steps, since Safari has no prompt. Nothing is shown once the app is installed or after "Not now".
import { t, esc, onLang } from "./i18n.js";

const DISMISS_KEY = "hx-install-dismissed";

// https only: the local dev server (http) and its browser tests run without a service worker
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } };

let deferred = null; // the browser's install prompt, kept until the button is pressed
let card = null;

function render() {
  const main = document.querySelector(".acct-main");
  if (!main || standalone() || dismissed() || (!deferred && !isIOS())) { card?.remove(); card = null; return; }
  if (!card) { card = document.createElement("div"); card.className = "wrap"; main.appendChild(card); }
  card.innerHTML = `<section class="app-install" aria-labelledby="appInstallTitle">
    <img class="app-install-icon" src="/assets/app/icon-192.png" alt="" width="56" height="56">
    <div class="app-install-text">
      <h2 id="appInstallTitle">${esc(t("app.install.title"))}</h2>
      <p>${esc(t(deferred ? "app.install.body" : "app.install.ios"))}</p>
    </div>
    <div class="app-install-actions">
      ${deferred ? `<button type="button" class="app-install-go">${esc(t("app.install.button"))}</button>` : ""}
      <button type="button" class="app-install-later">${esc(t("app.install.dismiss"))}</button>
    </div></section>`;
  card.querySelector(".app-install-go")?.addEventListener("click", async () => {
    const p = deferred; deferred = null;
    await p?.prompt(); await p?.userChoice.catch(() => {});
    render();
  });
  card.querySelector(".app-install-later").addEventListener("click", () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode: hidden for this visit only */ }
    card.remove(); card = null;
  });
}

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; render(); });
addEventListener("appinstalled", () => { deferred = null; render(); });
onLang(render);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
