// Shared public header behaviour (homepage + tracking pages): the mobile menu, the language selector, and same-page
// section links.
import "./theme.js";
import "./app-install.js";
import { LANGUAGES, initI18n, setLang, getLang, t, onLang } from "./i18n.js";

// ---------- language selector ----------
// A native <select> (keyboard, screen readers and phone pickers work as usual). In the header it shows the short code
// of the current language; the mobile menu has a full-width copy with the language names. Both stay in sync.
const GLOBE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/></svg>';
function langSelect(id, cls) {
  const opts = LANGUAGES.map((l) => `<option value="${l.code}" lang="${l.code}"${l.dir === "rtl" ? ' dir="rtl"' : ""}>${l.name}</option>`).join("");
  return `<div class="${cls}">${cls === "lang-pick" ? `${GLOBE}<span class="lang-code" data-lang-current aria-hidden="true">EN</span>` : `<span class="lang-row-label">${GLOBE}<span data-i18n="lang.label">Language</span></span>`}
    <select id="${id}" data-lang-select aria-label="Language" data-i18n-attr="aria-label:lang.label">${opts}</select></div>`;
}
function mountLanguageSelector(header) {
  if (!header || header.querySelector("[data-lang-select]")) return;
  // The selector brings its own styles: a page (or an old saved copy of one) that doesn't link ui/i18n.css would otherwise
  // show a bare, full-width dropdown in the header.
  if (!document.querySelector('link[href$="i18n.css"]')) {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = new URL("./i18n.css", import.meta.url).href;
    document.head.appendChild(css);
  }
  header.querySelector("[data-theme-toggle]")?.insertAdjacentHTML("beforebegin", langSelect("hxLang", "lang-pick"));
  // "My account" on desktop: a person icon next to the language button (phones use the menu item instead)
  if (header.querySelector('.nav-menu a[href="/account.html"]')) {
    header.querySelector(".lang-pick")?.insertAdjacentHTML("beforebegin", `<a class="acct-link" href="/account.html" data-i18n-attr="aria-label:nav.account; title:nav.account" aria-label="My account" title="My account"${location.pathname === "/account.html" ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></a>`);
  }
  header.querySelector(".nav-panel")?.insertAdjacentHTML("beforeend", langSelect("hxLangMenu", "lang-row"));
  header.querySelectorAll("[data-lang-select]").forEach((sel) => {
    sel.value = getLang();
    // The page is never reloaded or redirected: form fields, an open tracking result and the session stay as they are.
    sel.addEventListener("change", () => { setLang(sel.value); });
  });
}
const shellHeader = document.querySelector("[data-site-header]");
mountLanguageSelector(shellHeader);
initI18n();
// The menu is a solid sheet with a scrim; it closes on link tap, scrim tap, Escape and when the viewport grows
// past the breakpoint, and the page behind it cannot scroll while it is open.
const header = document.querySelector("[data-site-header]");
if (header) {
  const toggle = header.querySelector(".nav-toggle");
  const panel = header.querySelector(".nav-panel");
  const scrim = document.createElement("div");
  scrim.className = "nav-scrim"; scrim.hidden = true;
  header.after(scrim);
  const mq = window.matchMedia("(max-width: 900px)");
  let lastFocus = null;

  const isOpen = () => panel.classList.contains("open");
  function setOpen(open) {
    if (open === isOpen()) return;
    panel.classList.toggle("open", open);
    scrim.hidden = !open;
    document.documentElement.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? t("nav.closeMenu") : t("nav.openMenu"));
    if (open) { lastFocus = document.activeElement; panel.querySelector("a")?.focus({ preventScroll: true }); }
    else if (lastFocus && header.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  scrim.addEventListener("click", () => setOpen(false));
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  // choosing a language from the mobile menu keeps the menu open, so the visitor sees the change and closes it themselves
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") { setOpen(false); toggle.focus(); return; }
    if (e.key === "Tab") { // keep focus inside the open menu
      const items = [toggle, ...panel.querySelectorAll("a, select")];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });
  const onMq = () => { if (!mq.matches) setOpen(false); };
  mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener(onMq);
  window.addEventListener("pagehide", () => setOpen(false));
  onLang(() => toggle.setAttribute("aria-label", isOpen() ? t("nav.closeMenu") : t("nav.openMenu")));

  // Mark the current page's link.
  const here = location.pathname.replace(/\/index\.html$/, "/");
  header.querySelectorAll(".nav-menu a").forEach((a) => {
    const u = new URL(a.href, location.href);
    if (!u.hash && u.pathname.replace(/\/index\.html$/, "/") === here) a.setAttribute("aria-current", "page");
  });
}

// "/#services" from the homepage (served at "/" or "/index.html") scrolls in place instead of reloading.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="/#"], a[href^="#"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const onHome = /^\/(index\.html)?$/.test(location.pathname);
  const id = a.getAttribute("href").split("#")[1];
  const target = id && document.getElementById(id);
  if (!target || (!onHome && a.getAttribute("href").startsWith("/"))) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  if (target.matches("#track")) document.getElementById("trackingInput")?.focus({ preventScroll: true });
});
