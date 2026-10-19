// Map data for the client tracking map: the server's recorded coordinates first, then — only when the record has no
// coordinates for a place it names — a city-level point from the verified city table (shared/places.js), flagged
// `approx`. Nothing is extrapolated or estimated: no point exists unless the shipment record or a recorded event names it.
import { resolvePlace } from "../shared/places.js";

const valid = (p) => p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

/**
 * view: the client tracking view. Returns the map data the shipment map draws, with:
 *   origin / destination: recorded coordinates, else a city-level point resolved from the label (approx: true)
 *   current: the latest recorded location — the recorded current position, else the newest recorded checkpoint, else
 *            the newest client-visible event whose place resolves in the city table (approx: true); null otherwise
 *   trail: recorded checkpoints with valid coordinates, oldest first
 *   resolved: which parts came from the city table (for the map note)
 */
export function resolveMapData(view) {
  const m = view?.map || {};
  const resolved = { origin: false, destination: false, current: false };
  const fromText = (text, key) => { const p = resolvePlace(text); if (p) resolved[key] = true; return p ? { lat: p.lat, lng: p.lng, approx: true, place: p.name } : null; };
  const origin = valid(m.origin) ? m.origin : fromText(m.originLabel || view?.origin, "origin");
  const destination = valid(m.destination) ? m.destination : fromText(m.destinationLabel || view?.destination, "destination");
  const trail = (Array.isArray(m.trail) ? m.trail : []).filter(valid);
  let current = valid(m.current) ? m.current : null;
  if (!current && trail.length) { const t = trail[trail.length - 1]; current = { lat: t.lat, lng: t.lng, name: t.name || null, state: "last", fromTrail: true, at: t.timestamp || null }; }
  if (!current) {
    // the place shown as the shipment's location on the page, else the newest client-visible event with a place
    // (the API sends the timeline newest first); either only when the city table knows it
    const named = view?.currentLocation?.name;
    const ev = (Array.isArray(view?.timeline) ? view.timeline : []).find((e) => e?.location && resolvePlace(e.location));
    const src = named && resolvePlace(named) ? { text: named, at: null } : ev ? { text: ev.location, at: ev.timestamp || null } : null;
    const p = src && resolvePlace(src.text);
    if (p) { resolved.current = true; current = { lat: p.lat, lng: p.lng, name: src.text, state: "last", approx: true, at: src.at }; }
  }
  return { ...m, origin, destination, current, trail, resolved };
}

/** True when there is anything at all to draw. */
export const hasPoints = (d) => !!(d && (d.origin || d.destination || d.current || d.trail?.length));
