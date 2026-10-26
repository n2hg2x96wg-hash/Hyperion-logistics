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

/** Optional customer e-mail for milestone notifications: "" clears it. Lower-cased; one plain address only. */
export function parseEmail(value, field = "notifyEmail") {
  const text = cleanText(value, { max: 254, field }).toLowerCase();
  if (!text) return "";
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/.test(text)) throw new ValidationError("Enter a valid e-mail address", field);
  return text;
}

/**
 * Optional customer account linked to a shipment (the client's account id, i.e. their Firebase Auth uid).
 * "" unlinks. Shape only: whether the account exists is checked by the service.
 */
export function parseCustomerId(value, field = "customerId") {
  const text = cleanText(value, { max: 128, field });
  if (!text) return "";
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(text)) throw new ValidationError("Choose a customer account from the list", field);
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

// ---------- shipment charges ----------
// Amounts are kept as whole cents (integers), so totals never pick up floating-point error. One currency per shipment:
// nothing is converted, and the total is always computed here from the lines (never taken from the client).
export const CHARGE_LINES = ["shipping", "customs", "handling", "insurance", "other"];
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];
const CURRENCIES = (() => { try { return new Set(Intl.supportedValuesOf("currency")); } catch { return null; } })();
const MAX_CENTS = 100_000_000_000; // 1,000,000,000.00

/** "1,234.5" / 1234.5 / "" -> cents (integer) or 0. At most 2 decimals; never negative. */
export function parseMoney(value, field) {
  if (value == null || value === "") return 0;
  const text = String(value).replace(/[\s,]/g, "");
  const m = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(text);
  if (!m) throw new ValidationError("Enter an amount like 1250 or 1250.50 (no currency symbols, at most 2 decimals)", field);
  const cents = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"));
  if (cents > MAX_CENTS) throw new ValidationError("Amount is too large", field);
  return cents;
}

/** Validated charges, or null to clear them. */
export function parseCharges(input) {
  if (input == null) return null;
  if (typeof input !== "object") throw new ValidationError("charges must be an object", "charges");
  const lines = Object.fromEntries(CHARGE_LINES.map((k) => [k, parseMoney(input[k], `fee_${k}`)]));
  const total = CHARGE_LINES.reduce((sum, k) => sum + lines[k], 0);
  const currency = cleanText(input.currency, { max: 3, field: "currency" }).toUpperCase();
  if (total > 0 && !currency) throw new ValidationError("Choose the currency for these charges", "currency");
  if (currency && (!/^[A-Z]{3}$/.test(currency) || (CURRENCIES && !CURRENCIES.has(currency)))) throw new ValidationError("Choose a valid currency code, e.g. USD, EUR or NGN", "currency");
  const paymentStatus = input.paymentStatus == null || input.paymentStatus === "" ? "unpaid" : String(input.paymentStatus);
  if (!PAYMENT_STATUSES.includes(paymentStatus)) throw new ValidationError("Choose Unpaid, Partially paid or Paid", "paymentStatus");
  const otherLabel = cleanText(input.otherLabel, { max: 80, field: "other charge description" });
  if (lines.other > 0 && !otherLabel) throw new ValidationError("Describe the other charge", "otherLabel");
  return { currency: currency || null, ...lines, otherLabel: lines.other > 0 ? otherLabel : "", total, paymentStatus,
    note: cleanText(input.note, { max: 500, field: "fee note" }) };
}

/** cents -> "1234.50" (plain, for forms and exports). */
export const centsToAmount = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
