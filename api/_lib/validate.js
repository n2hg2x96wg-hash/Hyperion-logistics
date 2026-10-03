// Input validation / normalization. All admin and provider input passes through here.
import { STATUS_CODES, normalizeStatus, EXCEPTION_TYPES, VISIBILITY_KEYS } from "../../shared/status.js";

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value, { max = 200, field = "field", required = false } = {}) {
  if (value == null) {
    if (required) throw new ValidationError(`${field} is required`, field);
    return "";
  }
  const text = String(value).replace(CONTROL, "").trim();
  if (required && !text) throw new ValidationError(`${field} is required`, field);
  if (text.length > max) throw new ValidationError(`${field} must be at most ${max} characters`, field);
  return text;
}

/** Tracking code: trim, uppercase, strip whitespace. Returns null when it cannot be valid. */
export function normalizeTrackingCode(input) {
  if (typeof input !== "string") return null;
  const code = input.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code) ? code : null;
}

export function parseCoordinate(value, kind, { required = false } = {}) {
  if (value === "" || value == null) {
    if (required) throw new ValidationError(`${kind} is required`, kind);
    return null;
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  const max = kind === "latitude" ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new ValidationError(`${kind} must be between -${max} and ${max}`, kind);
  return Math.round(n * 1e6) / 1e6;
}

/** Both-or-neither coordinate pair. Rejects (0, 0) ("Null Island"), which is almost always a blank form, never a real position. */
export function parseCoordinatePair(lat, lng, { field = "latitude", required = false } = {}) {
  const blank = (v) => v === "" || v == null;
  if (blank(lat) && blank(lng)) {
    if (required) throw new ValidationError("Latitude and longitude are required", field);
    return null;
  }
  if (blank(lat) !== blank(lng)) throw new ValidationError("Latitude and longitude must be provided together", field);
  const a = parseCoordinate(lat, "latitude"); const b = parseCoordinate(lng, "longitude");
  if (a === 0 && b === 0) throw new ValidationError("Coordinates 0, 0 are not a valid shipment position", field);
  return { lat: a, lng: b };
}

/** A recorded time: valid, not in the future (5 min clock-skew allowance). */
export function parsePastTimestamp(value, field = "timestamp") {
  const iso = parseIsoDateTime(value, field);
  if (iso && Date.parse(iso) > Date.now() + 5 * 60 * 1000) throw new ValidationError("Time cannot be in the future", field);
  return iso;
}

export function parseStatus(value, { required = true } = {}) {
  if (value == null || value === "") {
    if (required) throw new ValidationError("status is required", "status");
    return null;
  }
  const code = normalizeStatus(value);
  if (!code || !STATUS_CODES.includes(code)) throw new ValidationError("Unknown shipment status", "status");
  return code;
}

export function parseIsoDateTime(value, field) {
  if (value == null || value === "") return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) throw new ValidationError(`${field} is not a valid date/time`, field);
  return new Date(t).toISOString();
}

export function parseDateOnly(value, field) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + "T00:00:00Z"))) {
    throw new ValidationError(`${field} must be a date (YYYY-MM-DD)`, field);
  }
  return s;
}

export function parseExceptionType(value) {
  if (value == null || value === "") return null;
  const t = String(value).toUpperCase();
  if (!EXCEPTION_TYPES[t]) throw new ValidationError("Unknown exception type", "exceptionType");
  return t;
}

export function parseVisibility(input) {
  if (input == null) return null;
  if (typeof input !== "object") throw new ValidationError("visibility must be an object", "visibility");
  const out = {};
  for (const key of VISIBILITY_KEYS) if (key in input) out[key] = input[key] === true;
  return out;
}

export function parsePackage(input) {
  if (input == null) return null;
  if (typeof input !== "object") throw new ValidationError("package must be an object", "package");
  return {
    description: cleanText(input.description, { max: 300, field: "package description" }),
    weight: cleanText(input.weight, { max: 40, field: "package weight" }),
    dimensions: cleanText(input.dimensions, { max: 60, field: "package dimensions" }),
    pieces: cleanText(input.pieces, { max: 10, field: "package pieces" })
  };
}
