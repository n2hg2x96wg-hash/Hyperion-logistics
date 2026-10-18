// Shared public header behaviour (homepage + tracking pages): the mobile menu, and same-page section links.
import "./theme.js";
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
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (open) { lastFocus = document.activeElement; panel.querySelector("a")?.focus({ preventScroll: true }); }
    else if (lastFocus && header.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  scrim.addEventListener("click", () => setOpen(false));
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") { setOpen(false); toggle.focus(); return; }
    if (e.key === "Tab") { // keep focus inside the open menu
      const items = [toggle, ...panel.querySelectorAll("a")];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });
  const onMq = () => { if (!mq.matches) setOpen(false); };
  mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener(onMq);
  window.addEventListener("pagehide", () => setOpen(false));

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
