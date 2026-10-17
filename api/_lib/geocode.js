// Best-effort server-side geocoding for origin/destination labels (OpenStreetMap Nominatim by default).
// Geocoded points are stored with originCoordsSource/destinationCoordsSource = "geocoded" so they are never
// confused with real telemetry. Disabled with GEOCODER=off. Never throws.
import { countryFromText } from "../../shared/countries.js";

const cache = new Map();

export async function geocode(text) {
  const q = String(text || "").trim();
  if (!q || process.env.GEOCODER === "off" || process.env.STORE === "memory" && process.env.GEOCODER !== "on") return null;
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  try {
    // When the text names a country ("Kano, Nigeria"), restrict matches to it so an ambiguous name
    // cannot resolve to a same-named place elsewhere.
    const cc = countryFromText(q);
    const url = `${process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org/search"}?q=${encodeURIComponent(q)}&format=json&limit=1${cc ? `&countrycodes=${cc.toLowerCase()}` : ""}`;
    const res = await fetch(url, {
      headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "HyperionLogistics/2.0 (ops@hyperion-logistics.example)", "Accept-Language": "en" },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null;
    const ok = hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) && !(hit.lat === 0 && hit.lng === 0) ? hit : null;
    cache.set(key, ok);
    return ok;
  } catch { return null; }
}
