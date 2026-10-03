// Centralized shipment status engine.
// Isomorphic: imported by the serverless API (lib/*, api/*) AND by browser modules.
// Every status label, tone, ordering and legacy-alias decision lives here so the
// frontend never re-implements status logic.

export const STATUS = Object.freeze({
  CREATED: "CREATED",
  PROCESSING: "PROCESSING",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  AT_FACILITY: "AT_FACILITY",
  CUSTOMS: "CUSTOMS",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  DELAYED: "DELAYED",
  EXCEPTION: "EXCEPTION",
  CANCELLED: "CANCELLED"
});

// order = position on the happy path (used for progress). null = not a progress stage.
export const STATUS_META = Object.freeze({
  CREATED:          { label: "Shipment Registered",    short: "Registered",       order: 0,    tone: "neutral", event: "Shipment Registered" },
  PROCESSING:       { label: "Processing",             short: "Processing",       order: 1,    tone: "info",    event: "Processing" },
  PICKED_UP:        { label: "Picked Up",              short: "Picked Up",        order: 2,    tone: "info",    event: "Picked Up" },
  IN_TRANSIT:       { label: "In Transit",             short: "In Transit",       order: 3,    tone: "info",    event: "In Transit" },
  AT_FACILITY:      { label: "At Facility",            short: "At Facility",      order: 4,    tone: "info",    event: "Facility Arrival" },
  CUSTOMS:          { label: "Customs / Inspection",   short: "Customs",          order: 4.5,  tone: "warn",    event: "Customs / Inspection" },
  OUT_FOR_DELIVERY: { label: "Out for Delivery",       short: "Out for Delivery", order: 5,    tone: "info",    event: "Out for Delivery" },
  DELIVERED:        { label: "Delivered",              short: "Delivered",        order: 6,    tone: "success", event: "Delivered" },
  DELAYED:          { label: "Delayed",                short: "Delayed",          order: null, tone: "warn",    event: "Shipment Delayed" },
  EXCEPTION:        { label: "Exception",              short: "Exception",        order: null, tone: "danger",  event: "Shipment Exception" },
  CANCELLED:        { label: "Cancelled",              short: "Cancelled",        order: null, tone: "danger",  event: "Shipment Cancelled" }
});

export const STATUS_CODES = Object.freeze(Object.keys(STATUS_META));
export const MAX_ORDER = 6;
export const TERMINAL_STATUSES = Object.freeze([STATUS.DELIVERED, STATUS.CANCELLED]);
export const ACTIVE_STATUSES = Object.freeze(STATUS_CODES.filter((c) => !TERMINAL_STATUSES.includes(c)));
export const IN_TRANSIT_GROUP = Object.freeze([STATUS.PICKED_UP, STATUS.IN_TRANSIT, STATUS.AT_FACILITY, STATUS.CUSTOMS, STATUS.OUT_FOR_DELIVERY]);

// Legacy free-text statuses that already exist in the database / admin datalist.
const ALIASES = {
  "pending": STATUS.CREATED,
  "created": STATUS.CREATED,
  "registered": STATUS.CREATED,
  "shipment registered": STATUS.CREATED,
  "processing": STATUS.PROCESSING,
  "shipped": STATUS.PICKED_UP,
  "picked up": STATUS.PICKED_UP,
  "pickedup": STATUS.PICKED_UP,
  "in transit": STATUS.IN_TRANSIT,
  "in-transit": STATUS.IN_TRANSIT,
  "at facility": STATUS.AT_FACILITY,
  "facility arrival": STATUS.AT_FACILITY,
  "under custom review": STATUS.CUSTOMS,
  "under customs review": STATUS.CUSTOMS,
  "customs": STATUS.CUSTOMS,
  "customs / inspection": STATUS.CUSTOMS,
  "out for delivery": STATUS.OUT_FOR_DELIVERY,
  "delivered": STATUS.DELIVERED,
  "delayed": STATUS.DELAYED,
  "on hold": STATUS.EXCEPTION,
  "on-hold": STATUS.EXCEPTION,
  "exception": STATUS.EXCEPTION,
  "cancelled": STATUS.CANCELLED,
  "canceled": STATUS.CANCELLED
};

/** Resolve any code / legacy label to a canonical status code, or null if unknown. */
export function normalizeStatus(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (STATUS_META[upper]) return upper;
  return ALIASES[raw.toLowerCase().replace(/_/g, " ")] || null;
}

export function statusLabel(code) {
  return STATUS_META[code]?.label || "Status unavailable";
}

export function statusTone(code) {
  return STATUS_META[code]?.tone || "neutral";
}

/** Resolve the status for a stored shipment document (statusCode wins, legacy `status` string as fallback). */
export function resolveShipmentStatus(shipment) {
  return normalizeStatus(shipment?.statusCode) || normalizeStatus(shipment?.status);
}

/**
 * Progress for a shipment. Exception/delay statuses do not move the bar: they keep the
 * last real stage (`progressCode`) so the bar never jumps backwards or forwards by an exception.
 */
export function computeProgress(statusCode, progressCode) {
  if (statusCode === STATUS.DELIVERED) return { pct: 100, stage: STATUS.DELIVERED, held: false };
  if (statusCode === STATUS.CANCELLED) return { pct: null, stage: null, held: false, cancelled: true };
  let stage = statusCode;
  let held = false;
  if (STATUS_META[statusCode]?.order == null) {
    stage = STATUS_META[progressCode]?.order != null ? progressCode : null;
    held = true;
  }
  if (!stage) return { pct: null, stage: null, held };
  const order = STATUS_META[stage].order;
  return { pct: Math.round((order / MAX_ORDER) * 100), stage, held };
}

/** Steps for the progress indicator (customs only included when it applies). */
export function progressSteps(includeCustoms = false) {
  const base = [STATUS.CREATED, STATUS.PROCESSING, STATUS.PICKED_UP, STATUS.IN_TRANSIT, STATUS.AT_FACILITY];
  if (includeCustoms) base.push(STATUS.CUSTOMS);
  base.push(STATUS.OUT_FOR_DELIVERY, STATUS.DELIVERED);
  return base.map((code) => ({ code, label: STATUS_META[code].short, order: STATUS_META[code].order }));
}

export const EXCEPTION_TYPES = Object.freeze({
  OPERATIONAL_DELAY: "Operational delay",
  ADDRESS_ISSUE: "Address issue",
  CUSTOMS_HOLD: "Customs hold",
  FAILED_DELIVERY: "Failed delivery attempt",
  CARRIER_EXCEPTION: "Carrier exception"
});

export const EVENT_SOURCES = Object.freeze({
  admin: "Operations update",
  system: "System",
  carrier_api: "Carrier API",
  gps: "GPS telemetry"
});

/** Sources that are allowed to claim machine-generated telemetry. Manual entry can never be 'gps'. */
export const MANUAL_SOURCES = Object.freeze(["admin", "system"]);

export const VISIBILITY_KEYS = Object.freeze([
  "map", "location", "timeline", "eta", "carrier", "package", "progress", "notes", "events", "fee"
]);

export const DEFAULT_VISIBILITY = Object.freeze({
  map: true, location: true, timeline: true, eta: true, carrier: true,
  package: true, progress: true, notes: true, events: true, fee: true
});

export function resolveVisibility(stored) {
  const out = { ...DEFAULT_VISIBILITY };
  if (stored && typeof stored === "object") {
    for (const key of VISIBILITY_KEYS) if (typeof stored[key] === "boolean") out[key] = stored[key];
  }
  return out;
}

/** "Updated just now" / "Updated 5 minutes ago" from a real timestamp. */
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, Math.floor((now - t) / 1000));
  if (diff < 45) return "just now";
  const mins = Math.round(diff / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Roles / permissions (admin side)
export const ROLES = Object.freeze({
  admin:    ["read", "write", "location", "event", "visibility", "archive", "delete", "settings", "migrate", "couriers"],
  operator: ["read", "write", "location", "event", "visibility", "archive"],
  viewer:   ["read"]
});
export function can(role, permission) {
  return !!ROLES[role]?.includes(permission);
}

// ---------- location freshness ("Live" honesty) ----------
// "Live" means the system holds a recent, recorded position with coordinates. It never means "the page is open".
export const LOCATION_WINDOWS = Object.freeze({ liveMs: 30 * 60 * 1000, recentMs: 24 * 60 * 60 * 1000 });
export const LOCATION_STATE_LABELS = Object.freeze({
  live: "Live", recent: "Recently updated", last: "Last known location", none: "Awaiting location update"
});

/**
 * @returns "live" | "recent" | "last" | "none"
 *   none   - no location name and no coordinates recorded
 *   live   - coordinates recorded within liveMs, shipment still moving (not delivered/cancelled)
 *   recent - any location recorded within recentMs
 *   last   - older, undated, or the shipment has finished
 */
export function locationFreshness({ updatedAt, hasCoordinates = false, hasName = false, statusCode = null, now = Date.now(), liveMs = LOCATION_WINDOWS.liveMs, recentMs = LOCATION_WINDOWS.recentMs } = {}) {
  if (!hasCoordinates && !hasName) return "none";
  const t = Date.parse(updatedAt || "");
  if (!Number.isFinite(t)) return "last";
  if (TERMINAL_STATUSES.includes(statusCode)) return "last";
  const age = Math.max(0, now - t);
  if (hasCoordinates && age <= liveMs) return "live";
  if (age <= recentMs) return "recent";
  return "last";
}
