// Admin console as its own home-screen app ("HY Admin", admin.webmanifest): registers the service worker (sw.js,
// network-only apart from an offline page) and adds "Get the admin app" to the console menu, which opens the steps for
// this phone, or the browser's own install prompt where there is one. English only, like the rest of the console.

// https only: the local dev server (http) and its browser tests run without a service worker
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>'),
  addHome: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  done: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  dots: svg('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>'),
  install: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
};
const STEPS = {
  ios: [["share", "Tap the Share button", "At the bottom of Safari. On newer iPhones, tap ⋯ first."],
        ["addHome", "Tap Add to Home Screen", "Scroll down the list if you don't see it."],
        ["done", "Tap Add: HY Admin appears on your home screen"]],
  android: [["dots", "Tap the browser menu ⋮ (top right)"], ["install", "Tap Install app or Add to Home screen"],
            ["done", "Tap Install: HY Admin appears on your home screen"]],
};
const steps = (kind) => `<ol class="aa-steps">${STEPS[kind].map(([icon, text, hint]) =>
  `<li><span class="aa-ico">${ICON[icon]}</span><span class="aa-text"><strong>${text}</strong>${hint ? `<small>${hint}</small>` : ""}</span></li>`).join("")}</ol>`;

let deferred = null; // the browser's install prompt, kept until the button is pressed
let dialog = null;

function render() {
  const kind = isIOS() ? "ios" : isAndroid() ? "android" : null;
  const body = standalone() ? "" : deferred ? ""
    : kind ? steps(kind) : `<h3>On iPhone or iPad</h3>${steps("ios")}<h3>On Android</h3>${steps("android")}`;
  dialog.innerHTML = `<div class="aa-card">
    <div class="aa-head"><img src="/assets/app/admin-icon-192.png" alt="" width="56" height="56">
      <div><h2 id="aaTitle">Get the admin app</h2>
      <p>${standalone() ? "You're using the admin app now." : "Open the admin console in one tap, full screen, from your home screen. It still asks for your admin password."}</p></div></div>
    ${body}
    <div class="aa-actions">
      ${deferred && !standalone() ? '<button type="button" class="btn-action" data-install>Install app</button>' : ""}
      <button type="button" class="aa-close" data-close>Close</button>
    </div></div>`;
  dialog.querySelector("[data-install]")?.addEventListener("click", async () => {
    const p = deferred; deferred = null; dialog.close();
    await p?.prompt(); await p?.userChoice.catch(() => {});
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
}

function open() {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "aa-dialog";
    dialog.setAttribute("aria-labelledby", "aaTitle");
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // tap outside closes
    document.body.appendChild(dialog);
  }
  render();
  dialog.showModal();
}

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; if (dialog?.open) render(); });
addEventListener("appinstalled", () => { deferred = null; if (dialog?.open) render(); });

const btn = document.getElementById("btnGetAdminApp");
if (btn && !standalone()) {
  btn.hidden = false;
  btn.addEventListener("click", () => {
    document.getElementById("consoleNav")?.classList.remove("open"); // the phone menu steps away for the dialog
    document.getElementById("consoleMenu")?.setAttribute("aria-expanded", "false");
    open();
  });
}
