// Map colours for the globe and the flat map, following the site theme (html[data-theme]). Markers and routes keep
// the same colours in both themes; only ocean, land and borders change.
export const mapPalette = () => (document.documentElement.dataset.theme === "light"
  ? { ocean: "#cfe2f5", land: "#f7f9fc", border: "#9fb3cf" }
  : { ocean: "#071330", land: "#13254d", border: "#2f4f8f" });

/** Calls fn(palette) now and whenever the visitor switches theme; returns an unsubscribe function. */
export function onPalette(fn) {
  const h = () => fn(mapPalette());
  document.addEventListener("hx-theme", h);
  return () => document.removeEventListener("hx-theme", h);
}
