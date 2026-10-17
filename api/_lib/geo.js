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

/** Country for a place: recorded coordinates first, then the place text ("Lagos, Nigeria"). */
export function deriveCountry(lat, lng, text) {
  return countryAt(lat, lng) || countryFromText(text);
}
