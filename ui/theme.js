// Light/dark theme toggle for the public pages and the admin console. Dark is the default; a visitor's choice is
// remembered on this device only (localStorage "hx-theme"), never sent anywhere. A small inline script in each
// page's <head> applies a saved choice before the stylesheets load, so the page never flashes the wrong theme.
const KEY = "hx-theme";
const COLORS = { dark: "#030712", light: "#f5f8fe" };

export const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function save(theme) { try { localStorage.setItem(KEY, theme); } catch { /* private mode: the choice lasts for this page only */ } }

export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  const html = document.documentElement;
  if (t === "light") html.dataset.theme = "light"; else delete html.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[t]);
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-pressed", String(t === "light"));
    b.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme");
    b.title = t === "light" ? "Dark theme" : "Light theme";
  });
  document.dispatchEvent(new CustomEvent("hx-theme", { detail: t }));
  return t;
}

export function initThemeToggle() {
  if (window.__hxTheme) return;
  window.__hxTheme = true;
  applyTheme(currentTheme());
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-toggle]")) return;
    save(applyTheme(currentTheme() === "light" ? "dark" : "light"));
  });
  // another tab changed the theme
  window.addEventListener("storage", (e) => { if (e.key === KEY) applyTheme(e.newValue); });
}

initThemeToggle();
