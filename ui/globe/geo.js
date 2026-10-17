// Shared geometry for the command-center globe and flat map. Routes drawn here are PLANNED paths
// (great-circle between recorded/known points); they are never presented as GPS tracks.
export const COUNTRIES_URL = "/assets/geo/countries-110m.json";

let countriesPromise = null;
export function loadCountries() {
  if (!countriesPromise) {
    countriesPromise = fetch(COUNTRIES_URL).then((r) => { if (!r.ok) throw new Error("countries"); return r.json(); })
      .then((fc) => ({ ...fc, features: fc.features.filter((f) => f.properties.iso !== "AQ") })); // Antarctica: no shipping, edge artifacts
    countriesPromise.catch(() => { countriesPromise = null; });
  }
  return countriesPromise;
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Great-circle points between a and b ({lat,lng}); longitudes are unwrapped so the line is continuous. */
export function greatCircle(a, b, steps = 48) {
  const φ1 = rad(a.lat); const λ1 = rad(a.lng); const φ2 = rad(b.lat); const λ2 = rad(b.lng);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (!d) return [[a.lng, a.lat], [b.lng, b.lat]];
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d); const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  for (let i = 1; i < out.length; i++) { // unwrap across the antimeridian
    while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360;
    while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360;
  }
  return out;
}

/** Segments for one route: travelled (origin → recorded position) and remaining/planned (dashed). */
export function routeSegments(r) {
  const segs = [];
  if (r.origin && r.current) segs.push({ kind: "travelled", coords: greatCircle(r.origin, r.current) });
  if (r.current && r.destination) segs.push({ kind: "remaining", coords: greatCircle(r.current, r.destination) });
  if (!r.current && r.origin && r.destination) segs.push({ kind: "planned", coords: greatCircle(r.origin, r.destination) });
  return segs;
}

export const TONE_COLORS = { info: "#60a5fa", success: "#34d399", warn: "#fbbf24", danger: "#f87171", neutral: "#94a3b8" };

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
