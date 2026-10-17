// Point → country lookup over Natural Earth 110m country shapes (public domain), the same file the
// homepage globe draws. Used to derive countries from RECORDED coordinates; never invents locations.
import world from "../../assets/geo/countries-110m.json" with { type: "json" };
import { countryFromText } from "../../shared/countries.js";

const shapes = world.features.map((f) => {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { iso: f.properties.iso, polys, box: [minX, minY, maxX, maxY] };
});

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ISO-2 country containing (lat, lng), or null (ocean / outside the 110m shapes). */
export function countryAt(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  for (const s of shapes) {
    const [a, b, c, d] = s.box;
    if (lng < a || lng > c || lat < b || lat > d || !s.iso) continue;
    for (const poly of s.polys) {
      if (inRing(lng, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lng, lat, hole))) return s.iso;
    }
  }
  return null;
}

/** A usable map point, or null. Rejects missing, non-numeric, out-of-range and (0,0) "null island" values,
 *  which in practice come from empty form fields, never from a real shipment position. */
export function validPoint(lat, lng) {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

/** Country for a place: the country the admin typed ("Lagos, Nigeria") wins; recorded coordinates are the
 *  fallback. Text-first keeps a mistyped or swapped coordinate from relabelling a shipment's country. */
export function deriveCountry(lat, lng, text) {
  return countryFromText(text) || (validPoint(lat, lng) ? countryAt(lat, lng) : null);
}

/** Problems with one stored coordinate pair, judged against its own place text. Read-only: never fixes anything.
 *  Returns null when the pair is fine or absent, else { issue, ... } where issue is one of
 *  "invalid" (non-numeric / out of range), "zero" (0,0), "mismatch" (point is not in the typed country),
 *  "swapped" (point is not in the typed country, but the swapped point is). */
export function coordinateIssue(lat, lng, text) {
  const has = (v) => v !== undefined && v !== null && v !== "";
  if (!has(lat) && !has(lng)) return null;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    const swapOk = typeof lat === "number" && typeof lng === "number" && Math.abs(lng) <= 90 && Math.abs(lat) <= 180;
    return swapOk ? { issue: "swapped", expected: countryFromText(text), found: null } : { issue: "invalid" };
  }
  if (lat === 0 && lng === 0) return { issue: "zero" };
  const expected = countryFromText(text);
  if (!expected) return null;
  const found = countryAt(lat, lng);
  if (found === expected) return null;
  if (Math.abs(lng) <= 90 && countryAt(lng, lat) === expected) return { issue: "swapped", expected, found };
  // ocean / coastline points the 110m shapes miss are not flagged unless clearly elsewhere
  if (!found) return null;
  return { issue: "mismatch", expected, found };
}
