// Public homepage data (command-center globe, activity feed, statistics).
//
// Privacy rules, enforced here on the server:
//   * Individual shipments appear ONLY when an admin opted them in (shipment.publicMap === true), they are not
//     archived, and they are active (or delivered in the last 7 days, labelled as such).
//   * Tracking codes are masked, places are reduced to "City, Country", coordinates are rounded to ~1 km.
//   * Client names, references, notes, addresses, actors, descriptions and audit data are never included.
//   * A current-position marker exists only when the shipment's own client visibility allows map + location
//     and a position was actually recorded. Nothing is interpolated or simulated.
// Statistics use all non-archived records (counts only) with the counting rules documented in `rules`.
import crypto from "node:crypto";
import { transportMode } from "../../shared/mode.js";
import {
  STATUS, STATUS_META, EVENT_SOURCES, IN_TRANSIT_GROUP, resolveShipmentStatus, resolveVisibility, statusLabel, statusTone
} from "../../shared/status.js";
import { countryName } from "../../shared/countries.js";
import { countryFields } from "./store/index.js";

const RECENT_DELIVERY_MS = 7 * 24 * 3600 * 1000;
const isoOk = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const round2 = (n) => Math.round(n * 100) / 100;
const point = (lat, lng) => (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat: round2(lat), lng: round2(lng) } : null);

/** "HY-123456" → "HY-12••56". Enough to recognise your own shipment, not enough to look one up. */
export function maskCode(code) {
  const s = String(code || "");
  const dash = s.indexOf("-");
  const prefix = dash > 0 && dash <= 8 ? s.slice(0, dash + 1) : "";
  const body = s.slice(prefix.length);
  if (body.length < 5) return `${prefix}••••`;
  return `${prefix}${body.slice(0, 2)}••${body.slice(-2)}`;
}

/** Reduce a free-text place to "City, Country" (drops street-level parts). */
export function cityLabel(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const label = parts.length > 2 ? parts.slice(-2).join(", ") : parts.join(", ");
  return label.replace(/\d{2,}/g, "").replace(/\s{2,}/g, " ").trim().slice(0, 60) || null;
}

const isActive = (code) => code && code !== STATUS.DELIVERED && code !== STATUS.CANCELLED;

export function computeStats(summaries) {
  let active = 0; let inTransit = 0; let delivered = 0; let total = 0;
  const activeCountries = new Set(); const allCountries = new Set();
  for (const s of summaries) {
    if (s.archived === true) continue;
    total += 1;
    const code = resolveShipmentStatus(s);
    // derived at read time with the current rule (typed place name first, coordinates second), so records whose
    // stored country came from a mistyped coordinate are counted correctly without rewriting them
    const derived = countryFields(s);
    const countries = [derived.originCountry, derived.destinationCountry, derived.currentCountry].filter(Boolean);
    countries.forEach((c) => allCountries.add(c));
    if (isActive(code)) { active += 1; countries.forEach((c) => activeCountries.add(c)); }
    if (IN_TRANSIT_GROUP.includes(code)) inTransit += 1;
    if (code === STATUS.DELIVERED) delivered += 1;
  }
  const sortCountries = (set) => [...set].sort().map((iso) => ({ iso, name: countryName(iso) || iso }));
  return {
    total, active, inTransit, delivered,
    countriesActive: activeCountries.size, countriesAll: allCountries.size,
    activeCountries: sortCountries(activeCountries),
    rules: {
      total: "Shipment records that are not archived.",
      active: "Not archived and not delivered or cancelled.",
      inTransit: "Picked up, in transit, at a facility, in customs or out for delivery.",
      delivered: "Shipments whose current status is Delivered (all time, not archived).",
      countriesActive: "Distinct countries of origin, destination or recorded position among active shipments.",
      countriesAll: "Distinct countries across all non-archived shipment records (historical)."
    }
  };
}

// Only verified feeds (carrier API, GPS) publish a time; staff-entered milestones and positions are shown without one.
const VERIFIED_SOURCES = new Set(["carrier_api", "gps"]);
const clientTime = (t, source) => (VERIFIED_SOURCES.has(source) ? isoOk(t) : null);

function routeFor(s, now) {
  const code = resolveShipmentStatus(s);
  const deliveredRecently = code === STATUS.DELIVERED && Date.now() - Date.parse(s.statusUpdatedAt || s.updatedAt || 0) < RECENT_DELIVERY_MS;
  if (s.archived === true || s.publicMap !== true) return null;
  if (!isActive(code) && !deliveredRecently) return null;
  const vis = resolveVisibility(s.visibility);
  const origin = point(s.originLat, s.originLng);
  const destination = point(s.destinationLat, s.destinationLng);
  let current = null;
  if (vis.map && vis.location && isoOk(s.locationUpdatedAt)) {
    const p = point(s.latitude, s.longitude);
    if (p) current = { ...p, place: cityLabel(s.location), recordedAt: clientTime(s.locationUpdatedAt, s.locationSource),
      sourceLabel: EVENT_SOURCES[s.locationSource] || EVENT_SOURCES.admin };
  }
  if (!origin && !destination && !current) return null;
  return {
    ref: maskCode(s.id),
    key: crypto.createHash("sha1").update(`route|${s.id}`).digest("hex").slice(0, 12), // stable, non-reversible id for the UI
    status: code ? { code, label: statusLabel(code), tone: statusTone(code) } : { code: null, label: "Status unavailable", tone: "neutral" },
    deliveredRecently,
    originLabel: cityLabel(s.origin), destinationLabel: cityLabel(s.destination),
    ...(({ originCountry, destinationCountry }) => ({ originCountry, destinationCountry }))(countryFields(s)),
    origin, destination, current,
    // derived at read time with the tracking page's rule; null unless the recorded service type or a single-mode
    // carrier says it, and only when the shipment shows its carrier to clients
    mode: vis.carrier ? transportMode({ serviceType: s.serviceType, carrierId: s.courier }) : null,
    sortKey: isoOk(s.updatedAt) || "" // ordering only; removed before the response is sent
  };
}

function activityFor(s, route, events) {
  const vis = resolveVisibility(s.visibility);
  return events
    .filter((e) => e.clientVisible !== false && (e.kind === "manual" ? vis.events : vis.timeline) && isoOk(e.timestamp))
    .slice(0, 5)
    .map((e) => ({
      ref: route.ref, routeKey: route.key,
      title: String(e.title || (e.statusCode ? STATUS_META[e.statusCode]?.event : "Update") || "Update").slice(0, 80),
      tone: e.statusCode ? statusTone(e.statusCode) : "info",
      place: vis.location ? cityLabel(e.location) : null,
      from: route.originLabel, to: route.destinationLabel,
      at: clientTime(e.timestamp, e.source || "admin"),
      sortKey: e.timestamp, // ordering only; removed before the response is sent
      sourceLabel: EVENT_SOURCES[e.source] || EVENT_SOURCES.admin
    }));
}

export function buildPublicOverview({ summaries, publicShipments, eventsByCode, now = new Date() }) {
  const stats = computeStats(summaries);
  const routes = []; let activity = [];
  for (const s of publicShipments) {
    const r = routeFor(s, now);
    if (!r) continue;
    routes.push(r);
    activity = activity.concat(activityFor(s, r, eventsByCode.get(s.id) || []));
  }
  routes.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  activity.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const strip = ({ sortKey, ...rest }) => rest; // edit and entry times never leave the server
  const body = { stats, routes: routes.slice(0, 50).map(strip), activity: activity.slice(0, 20).map(strip) };
  const version = crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { ...body, version, generatedAt: now.toISOString() };
}
