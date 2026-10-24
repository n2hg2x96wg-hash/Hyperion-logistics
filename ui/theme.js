// Light/dark theme toggle for the public pages and the admin console. Dark is the default; a visitor's choice is
// remembered on this device only (localStorage "hx-theme"), never sent anywhere. A small inline script in each
// page's <head> applies a saved choice before the stylesheets load, so the page never flashes the wrong theme.
import { t } from "./i18n.js"; // English unless a public page turned translations on

const KEY = "hx-theme";
const COLORS = { dark: "#030712", light: "#f5f8fe" };

export const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function save(theme) { try { localStorage.setItem(KEY, theme); } catch { /* private mode: the choice lasts for this page only */ } }

function labelToggles(th) {
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-pressed", String(th === "light"));
    b.setAttribute("aria-label", t(th === "light" ? "theme.toDark" : "theme.toLight"));
    b.title = t(th === "light" ? "theme.dark" : "theme.light");
  });
}

export function applyTheme(theme) {
  const th = theme === "light" ? "light" : "dark";
  const html = document.documentElement;
  if (th === "light") html.dataset.theme = "light"; else delete html.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[th]);
  labelToggles(th);
  document.dispatchEvent(new CustomEvent("hx-theme", { detail: th }));
  return th;
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
  document.addEventListener("hx-lang", () => labelToggles(currentTheme())); // relabel the button in the new language
}

initThemeToggle();
