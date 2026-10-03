// Shipment service: the single write path for shipments. Admin API, courier webhooks and any future
// integration all go through here, so status rules, event generation, audit logging and de-duplication
// live in exactly one place.
import crypto from "node:crypto";
import { getStore, derivedFields } from "./store/index.js";
import {
  STATUS, STATUS_META, MANUAL_SOURCES, EXCEPTION_TYPES, resolveShipmentStatus, resolveVisibility, VISIBILITY_KEYS, normalizeStatus
} from "../../shared/status.js";
import {
  ValidationError, cleanText, normalizeTrackingCode, parseCoordinate, parseStatus, parseIsoDateTime,
  parseDateOnly, parseExceptionType, parseVisibility, parsePackage, parseCoordinatePair, parsePastTimestamp
} from "./validate.js";
import { buildClientView } from "./client-view.js";
import { notifyEvents } from "./notifications.js";
import { geocode } from "./geocode.js";
import { mergeCarriers, carrierId } from "../../shared/carriers.js";

export class ServiceError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 24);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const brief = (v) => (typeof v === "string" && v.length > 160 ? v.slice(0, 160) + "…" : v);

export function generateTrackingCode(prefix = "HY") {
  const alphabet = "0123456789";
  let digits = "";
  for (const b of crypto.randomBytes(6)) digits += alphabet[b % 10];
  return `${String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, "") || "HY"}-${digits}`;
}

// ---------- pure change computation ----------

const SIMPLE_TEXT = {
  courier: 60, courierTrackingNumber: 80, serviceType: 80, clientRef: 120, origin: 160, destination: 160,
  distance: 40, fee: 40, notes: 1000, internalNotes: 2000, eta: 80
};

/** Validate an untrusted patch into normalized field changes. Only known fields survive. */
export function parsePatch(input = {}) {
  const p = {};
  for (const [key, max] of Object.entries(SIMPLE_TEXT)) {
    if (key in input) p[key] = cleanText(input[key], { max, field: key });
  }
  if ("location" in input) p.location = cleanText(input.location, { max: 160, field: "location" });
  for (const [k, kind] of [["latitude", "latitude"], ["longitude", "longitude"], ["originLat", "latitude"], ["originLng", "longitude"],
    ["destinationLat", "latitude"], ["destinationLng", "longitude"]]) {
    if (k in input) p[k] = parseCoordinate(input[k], kind);
  }
  if (("latitude" in p) !== ("longitude" in p)) throw new ValidationError("Latitude and longitude must be provided together", "latitude");
  if (("originLat" in p) !== ("originLng" in p)) throw new ValidationError("Origin latitude and longitude must be provided together", "originLat");
  if (("destinationLat" in p) !== ("destinationLng" in p)) throw new ValidationError("Destination latitude and longitude must be provided together", "destinationLat");
  for (const [a, b] of [["latitude", "longitude"], ["originLat", "originLng"], ["destinationLat", "destinationLng"]]) {
    if (p[a] === 0 && p[b] === 0) throw new ValidationError("Coordinates 0, 0 are not a valid position", a);
  }
  if ("statusCode" in input || "status" in input) p.statusCode = parseStatus(input.statusCode ?? input.status);
  if ("etaDate" in input) p.etaDate = parseDateOnly(input.etaDate, "etaDate");
  if ("etaWindowStart" in input) p.etaWindowStart = parseIsoDateTime(input.etaWindowStart, "etaWindowStart");
  if ("etaWindowEnd" in input) p.etaWindowEnd = parseIsoDateTime(input.etaWindowEnd, "etaWindowEnd");
  if (p.etaWindowStart && p.etaWindowEnd && p.etaWindowEnd < p.etaWindowStart) throw new ValidationError("ETA window end must be after start", "etaWindowEnd");
  if (!!p.etaWindowStart !== !!p.etaWindowEnd && ("etaWindowStart" in p) && ("etaWindowEnd" in p)) throw new ValidationError("Provide both ETA window start and end", "etaWindowStart");
  if ("package" in input) p.package = parsePackage(input.package);
  if ("visibility" in input) p.visibility = parseVisibility(input.visibility);
  if ("exception" in input) {
    const ex = input.exception;
    p.exception = ex == null ? null : {
      type: parseExceptionType(ex.type) || (() => { throw new ValidationError("Exception type is required", "exceptionType"); })(),
      note: cleanText(ex.note, { max: 500, field: "exception note" }),
      clientVisible: ex.clientVisible !== false
    };
  }
  return p;
}

const TRACKED = ["courier", "courierTrackingNumber", "serviceType", "clientRef", "origin", "destination", "distance", "fee", "notes",
  "internalNotes", "eta", "originLat", "originLng", "destinationLat", "destinationLng", "etaDate", "etaWindowStart", "etaWindowEnd", "package"];

/**
 * Pure: given the current document and a validated patch, compute the next document plus the events,
 * location records and audit entries to write. Called inside a store transaction (may be retried),
 * so it must stay deterministic for a given (current, patch, ctx).
 */
export function computeChange(current, patch, ctx) {
  const { actor, role, now, source = "admin", code } = ctx;
  const creating = !current;
  const prev = current || {};
  const rev = (Number(prev.rev) || 0) + 1;
  const next = { ...prev, id: code };
  const events = []; const locations = []; const audit = [];
  const base = { at: now, actor, role, via: ctx.via || "admin", shipment: code };
  const isManualSource = MANUAL_SOURCES.includes(source);

  if (creating) {
    next.createdAt = now; next.createdBy = actor; next.archived = false;
    next.statusCode = STATUS.CREATED; next.progressCode = STATUS.CREATED; next.status = STATUS_META.CREATED.label;
    next.statusUpdatedAt = now;
  }

  // plain fields
  const changed = {};
  for (const key of TRACKED) {
    if (key in patch && !same(patch[key], prev[key] ?? (key === "package" ? null : ""))) {
      if (!(creating && (patch[key] === "" || patch[key] == null))) changed[key] = { from: creating ? null : brief(prev[key] ?? null), to: brief(patch[key]) };
      next[key] = patch[key];
    }
  }
  if ("originLat" in changed) next.originCoordsSource = "admin";
  if ("destinationLat" in changed) next.destinationCoordsSource = "admin";
  const etaKeys = ["eta", "etaDate", "etaWindowStart", "etaWindowEnd"].filter((k) => k in changed);
  if (etaKeys.length) next.etaSource = ctx.etaSource || (isManualSource ? "admin" : source);

  // visibility
  let visibilityChange = null;
  if (patch.visibility) {
    const before = resolveVisibility(prev.visibility);
    const after = { ...before, ...patch.visibility };
    if (!same(before, after)) {
      next.visibility = after;
      visibilityChange = Object.fromEntries(VISIBILITY_KEYS.filter((k) => before[k] !== after[k]).map((k) => [k, { from: before[k], to: after[k] }]));
    } else if (creating) next.visibility = after;
  } else if (creating) next.visibility = resolveVisibility(null);

  // location group
  const locChanged = ("location" in patch && (patch.location || "") !== (prev.location || "")) ||
    ("latitude" in patch && (patch.latitude !== (prev.latitude ?? null) || patch.longitude !== (prev.longitude ?? null)));
  if ("location" in patch) next.location = patch.location;
  if ("latitude" in patch) { next.latitude = patch.latitude; next.longitude = patch.longitude; }
  const hasLocationPayload = ("location" in patch && patch.location) || ("latitude" in patch && patch.latitude != null);

  // status
  const prevStatus = creating ? null : resolveShipmentStatus(prev);
  let newStatus = patch.statusCode || prevStatus || STATUS.CREATED;
  const statusChanged = !!patch.statusCode && patch.statusCode !== prevStatus && !(creating && patch.statusCode === STATUS.CREATED);

  // exception handling (only recorded exceptions are ever shown)
  let exceptionChange = null;
  if ("exception" in patch) {
    const before = prev.exception || null;
    if (patch.exception) {
      if (!same(before && { t: before.type, n: before.note, c: before.clientVisible }, { t: patch.exception.type, n: patch.exception.note, c: patch.exception.clientVisible })) {
        next.exception = { ...patch.exception, recordedAt: now, recordedBy: actor };
        exceptionChange = { from: before?.type || null, to: patch.exception.type };
        if (newStatus !== STATUS.DELAYED && newStatus !== STATUS.EXCEPTION && !patch.statusCode) {
          newStatus = patch.exception.type === "OPERATIONAL_DELAY" ? STATUS.DELAYED : STATUS.EXCEPTION;
        }
      }
    } else if (before) { next.exception = null; exceptionChange = { from: before.type, to: null }; }
  }
  if ((newStatus === STATUS.DELAYED || newStatus === STATUS.EXCEPTION) && !next.exception && statusChanged) {
    // Status says delayed/exception but no exception record: do not fabricate a reason.
    next.exception = null;
  }
  if (newStatus !== STATUS.DELAYED && newStatus !== STATUS.EXCEPTION && next.exception && statusChanged) {
    exceptionChange = exceptionChange || { from: next.exception.type, to: null };
    next.exception = null; // recovered
  }

  const effectiveStatusChanged = newStatus !== prevStatus && (statusChanged || (creating && newStatus !== STATUS.CREATED) || !!exceptionChange && newStatus !== prevStatus);
  if (effectiveStatusChanged || creating) {
    next.statusCode = creating && !statusChanged ? STATUS.CREATED : newStatus;
    next.status = STATUS_META[next.statusCode].label; // keep legacy `status` string in sync for older pages
    if (STATUS_META[next.statusCode].order != null) next.progressCode = next.statusCode;
    else next.progressCode = prev.progressCode || (prevStatus && STATUS_META[prevStatus]?.order != null ? prevStatus : null);
    next.statusUpdatedAt = now;
  } else if (!next.statusCode && prevStatus) {
    next.statusCode = prevStatus;
  }

  const eventBase = { clientVisible: patch.eventVisible !== false, source: isManualSource ? source : source, actor, createdAt: now };
  const occurredAt = ctx.occurredAt || now;
  const where = next.location || "";

  if (creating) {
    events.push({ ...eventBase, id: `ev_${sha(`${code}|created`)}`, kind: "status", statusCode: STATUS.CREATED, title: STATUS_META.CREATED.event,
      description: "Shipment registered in the Hyperion system.", location: patch.origin || where, timestamp: now, seq: rev * 10 });
  }
  if ((statusChanged || (creating && newStatus !== STATUS.CREATED)) && newStatus !== (creating ? STATUS.CREATED : prevStatus)) {
    const noteBit = cleanNote(ctx.statusNote);
    events.push({ ...eventBase, id: `ev_${sha(`${code}|status|${newStatus}|${rev}`)}`, kind: "status", statusCode: newStatus,
      title: STATUS_META[newStatus].event,
      description: noteBit || (next.exception && (newStatus === STATUS.DELAYED || newStatus === STATUS.EXCEPTION)
        ? `${EXCEPTION_TYPES[next.exception.type]}${next.exception.note ? `: ${next.exception.note}` : ""}`
        : `Status updated to ${STATUS_META[newStatus].label}.`),
      location: where, timestamp: occurredAt, seq: rev * 10 + 1 });
  } else if (exceptionChange && exceptionChange.to) {
    events.push({ ...eventBase, id: `ev_${sha(`${code}|exception|${exceptionChange.to}|${rev}`)}`, kind: "status", statusCode: next.statusCode,
      title: STATUS_META[next.statusCode].event, description: `${EXCEPTION_TYPES[exceptionChange.to]}${next.exception.note ? `: ${next.exception.note}` : ""}`,
      location: where, timestamp: occurredAt, seq: rev * 10 + 1 });
  }
  if (!creating && locChanged && hasLocationPayload) {
    const lat = next.latitude ?? null; const lng = next.longitude ?? null;
    events.push({ ...eventBase, id: `ev_${sha(`${code}|loc|${lat}|${lng}|${where}|${rev}`)}`, kind: "location", statusCode: null, title: "Location Updated",
      description: where ? `Shipment location updated to ${where}.` : "Shipment location updated.", location: where, lat, lng, timestamp: occurredAt, seq: rev * 10 + 2 });
  }
  if (locChanged && hasLocationPayload) {
    const lat = next.latitude ?? null; const lng = next.longitude ?? null;
    next.locationUpdatedAt = occurredAt; next.locationSource = isManualSource ? "admin" : source;
    locations.push({ id: `loc_${sha(`${code}|${lat}|${lng}|${where}|${rev}`)}`, lat, lng, name: where, timestamp: occurredAt,
      source: next.locationSource, statusCode: next.statusCode || null, actor, clientVisible: true });
  }

  // audit entries (admin-only)
  if (creating) audit.push({ ...base, action: "shipment.created", previous: null, next: { status: next.statusCode, origin: next.origin || null, destination: next.destination || null } });
  const editedKeys = Object.keys(changed).filter((k) => !creating && !k.startsWith("eta"));
  if (editedKeys.length) audit.push({ ...base, action: "shipment.edited", previous: Object.fromEntries(editedKeys.map((k) => [k, changed[k].from])), next: Object.fromEntries(editedKeys.map((k) => [k, changed[k].to])) });
  if (etaKeys.length && !creating) audit.push({ ...base, action: "eta.changed", previous: Object.fromEntries(etaKeys.map((k) => [k, changed[k].from])), next: Object.fromEntries(etaKeys.map((k) => [k, changed[k].to])) });
  if (!creating && next.statusCode !== prevStatus) audit.push({ ...base, action: "status.changed", previous: { status: prevStatus }, next: { status: next.statusCode } });
  if (locChanged && !creating) audit.push({ ...base, action: "location.changed", previous: { location: prev.location || null, latitude: prev.latitude ?? null, longitude: prev.longitude ?? null }, next: { location: next.location || null, latitude: next.latitude ?? null, longitude: next.longitude ?? null, source: next.locationSource || null } });
  if (visibilityChange) audit.push({ ...base, action: "visibility.changed", previous: Object.fromEntries(Object.entries(visibilityChange).map(([k, v]) => [k, v.from])), next: Object.fromEntries(Object.entries(visibilityChange).map(([k, v]) => [k, v.to])) });
  if (exceptionChange) audit.push({ ...base, action: exceptionChange.to ? "exception.recorded" : "exception.cleared", previous: { exception: exceptionChange.from }, next: { exception: exceptionChange.to } });

  const nothingChanged = !creating && !events.length && !locations.length && !audit.length &&
    !("statusCode" in patch && patch.statusCode !== prevStatus);
  if (nothingChanged) return null;

  next.rev = rev; next.updatedAt = now; next.updatedBy = actor;
  Object.assign(next, derivedFields(next));
  return { next, events, locations, audit };
}

function cleanNote(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 600) : ""; }

// ---------- public operations ----------

function ctxFor(identity, extra = {}) {
  return { actor: identity.sub, role: identity.role, via: identity.via || "admin", now: new Date().toISOString(), ...extra };
}

async function resolveCode(input) {
  const code = normalizeTrackingCode(String(input ?? ""));
  if (!code) throw new ServiceError("invalid_code", "Invalid tracking code", 400);
  return code;
}

async function finish(store, result, code) {
  if (result?.written?.events?.length) await notifyEvents(store, result.shipment, result.written.events).catch(() => {});
  return result;
}

export async function createShipment(identity, input) {
  const store = await getStore();
  const patch = parsePatch(input);
  if (!patch.origin) throw new ValidationError("Origin is required", "origin");
  if (!patch.destination) throw new ValidationError("Destination is required", "destination");

  // coordinates: only geocode when admin did not supply them (geocoded values are labelled as such)
  const geo = {};
  if (!("originLat" in patch)) { const g = await geocode(patch.origin); if (g) { geo.originLat = g.lat; geo.originLng = g.lng; } }
  if (!("destinationLat" in patch)) { const g = await geocode(patch.destination); if (g) { geo.destinationLat = g.lat; geo.destinationLng = g.lng; } }
  Object.assign(patch, geo);

  let code = input.trackingCode ? normalizeTrackingCode(String(input.trackingCode)) : null;
  if (input.trackingCode && !code) throw new ValidationError("Tracking code may contain letters, numbers, - and _ (3-40 chars)", "trackingCode");
  const courier = patch.courier ? await resolveCourier(store, patch.courier) : null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = code || generateTrackingCode(courier?.prefix || "HY");
    const ctx = ctxFor(identity, { code: candidate, statusNote: input.statusNote });
    try {
      const result = await store.mutateShipment(candidate, (current) => {
        if (current) throw new ServiceError("exists", "A shipment with this tracking code already exists", 409);
        const c = computeChange(null, { ...patch, ...(patch.latitude != null ? { latitude: patch.latitude, longitude: patch.longitude } : {}) }, ctx);
        if (geo.originLat != null && c) c.next.originCoordsSource = "geocoded";
        if (geo.destinationLat != null && c) c.next.destinationCoordsSource = "geocoded";
        if (patch.latitude != null && c) { c.next.locationUpdatedAt = ctx.now; c.next.locationSource = "admin"; }
        return c;
      });
      await finish(store, result, candidate);
      return result.shipment;
    } catch (err) {
      if (err instanceof ServiceError && err.code === "exists" && !code) continue; // generated code collided: retry
      throw err;
    }
  }
  throw new ServiceError("code_generation", "Could not generate a unique tracking code", 500);
}

export async function updateShipment(identity, codeInput, input, opts = {}) {
  const store = await getStore();
  const code = await resolveCode(codeInput);
  const patch = parsePatch(input);
  const ctx = ctxFor(identity, { code, statusNote: input.statusNote, source: opts.source || "admin", occurredAt: opts.occurredAt, etaSource: opts.etaSource });
  // Geocode origin/destination when the text changed and no explicit coordinates were provided.
  const existing = await store.getShipment(code);
  if (!existing) throw new ServiceError("not_found", "Shipment not found", 404);
  if (patch.origin && patch.origin !== existing.origin && !("originLat" in patch)) {
    const g = await geocode(patch.origin); if (g) { patch.originLat = g.lat; patch.originLng = g.lng; patch.__originGeo = true; }
  }
  if (patch.destination && patch.destination !== existing.destination && !("destinationLat" in patch)) {
    const g = await geocode(patch.destination); if (g) { patch.destinationLat = g.lat; patch.destinationLng = g.lng; patch.__destGeo = true; }
  }
  const { __originGeo, __destGeo, ...clean } = patch;
  const result = await store.mutateShipment(code, (current) => {
    if (!current) throw new ServiceError("not_found", "Shipment not found", 404);
    const c = computeChange(current, clean, ctx);
    if (c && __originGeo) c.next.originCoordsSource = "geocoded";
    if (c && __destGeo) c.next.destinationCoordsSource = "geocoded";
    return c;
  });
  if (!result) return { shipment: existing, unchanged: true };
  await finish(store, result, code);
  return { shipment: result.shipment, unchanged: false, events: result.written.events };
}

/** Dedicated location update (admin form, carrier API, GPS). Idempotent: identical input is a no-op. */
export async function updateLocation(identity, codeInput, input, opts = {}) {
  const { locationName, latitude, longitude, statusCode, statusNote } = input;
  const patch = {
    location: locationName ?? input.location,
    latitude, longitude,
    ...(statusCode ? { statusCode } : {}),
    ...(statusNote ? { statusNote } : {})
  };
  if (patch.location == null && latitude == null) throw new ValidationError("Provide a location name and/or coordinates", "location");
  if ((latitude == null) !== (longitude == null)) throw new ValidationError("Latitude and longitude must be provided together", "latitude");
  if (latitude == null) { delete patch.latitude; delete patch.longitude; }
  else parseCoordinatePair(latitude, longitude);
  // Admin-supplied observation time ("when was the shipment here?"). Providers pass opts.occurredAt instead.
  if (!opts.occurredAt && input.timestamp) {
    const at = parsePastTimestamp(input.timestamp, "timestamp");
    const store = await getStore();
    const existing = await store.getShipment(await resolveCode(codeInput));
    if (!notOlder(at, existing?.locationUpdatedAt)) {
      throw new ValidationError("This time is earlier than the current recorded position. Add it as a tracking event to record past history.", "timestamp");
    }
    opts = { ...opts, occurredAt: at };
  }
  return updateShipment(identity, codeInput, patch, opts);
}

/** Admin forms record times to the minute, so "now" must not lose against a write made seconds earlier. */
const notOlder = (ts, than) => !than || ts.slice(0, 16) >= String(than).slice(0, 16);

/** Manually entered tracking event (admin Event Manager). Duplicate submissions collapse to one event. */
export async function addTrackingEvent(identity, codeInput, input) {
  const store = await getStore();
  const code = await resolveCode(codeInput);
  const statusCode = parseStatus(input.statusCode ?? input.status);
  const location = cleanText(input.location, { max: 160, field: "location" });
  const description = cleanText(input.description, { max: 600, field: "description", required: true });
  const timestamp = input.timestamp ? parseIsoDateTime(input.timestamp, "timestamp") : new Date().toISOString();
  if (Date.parse(timestamp) > Date.now() + 5 * 60 * 1000) throw new ValidationError("Event time cannot be in the future", "timestamp");
  const clientVisible = input.clientVisible !== false;
  const pair = parseCoordinatePair(input.latitude, input.longitude);
  const lat = pair?.lat ?? null; const lng = pair?.lng ?? null;
  // When set, the event also becomes the shipment's current status/position (only if it is the newest information).
  const apply = input.applyToShipment === true;
  const now = new Date().toISOString();
  const minute = timestamp.slice(0, 16);
  const id = `ev_${sha(`${code}|manual|${statusCode}|${location.toLowerCase()}|${minute}|${description.toLowerCase()}`)}`;

  const known = await store.getShipment(code);
  if (!known) throw new ServiceError("not_found", "Shipment not found", 404);
  if ((await store.listEvents(code, 200)).some((e) => e.id === id)) return { duplicate: true, id };

  const result = await store.mutateShipment(code, (current) => {
    if (!current) throw new ServiceError("not_found", "Shipment not found", 404);
    const rev = (Number(current.rev) || 0) + 1;
    const event = { id, kind: "manual", statusCode, title: STATUS_META[statusCode].event, description, location, lat, lng, timestamp,
      createdAt: now, source: "admin", actor: identity.sub, clientVisible, seq: rev * 10 + 3 };
    const base = { at: now, actor: identity.sub, role: identity.role, via: identity.via || "admin", shipment: code };
    const next = { ...current, rev, updatedAt: now, updatedBy: identity.sub };
    const audit = [{ ...base, action: "event.added", previous: null, next: { status: statusCode, location, latitude: lat, longitude: lng, description: brief(description), timestamp, clientVisible, applied: apply } }];
    // Coordinates on an event are a recorded route point (history), whether or not they become "current".
    const locations = lat != null ? [{ id: `loc_${sha(`${code}|event|${id}`)}`, lat, lng, name: location, timestamp, source: "admin",
      statusCode, actor: identity.sub, clientVisible, eventId: id }] : [];
    if (apply && clientVisible) {
      const prevStatus = resolveShipmentStatus(current);
      if (statusCode !== prevStatus && notOlder(timestamp, current.statusUpdatedAt)) {
        next.statusCode = statusCode; next.status = STATUS_META[statusCode].label; next.statusUpdatedAt = timestamp;
        if (STATUS_META[statusCode].order != null) next.progressCode = statusCode;
        if (statusCode !== STATUS.DELAYED && statusCode !== STATUS.EXCEPTION && next.exception) next.exception = null;
        audit.push({ ...base, action: "status.changed", previous: { status: prevStatus }, next: { status: statusCode } });
      }
      if ((location || lat != null) && notOlder(timestamp, current.locationUpdatedAt)) {
        if (location) next.location = location;
        if (lat != null) { next.latitude = lat; next.longitude = lng; }
        next.locationUpdatedAt = timestamp; next.locationSource = "admin";
        audit.push({ ...base, action: "location.changed", previous: { location: current.location || null, latitude: current.latitude ?? null, longitude: current.longitude ?? null },
          next: { location: next.location || null, latitude: next.latitude ?? null, longitude: next.longitude ?? null, source: "admin" } });
      }
      Object.assign(next, derivedFields(next));
    }
    return { next, events: [event], locations, audit };
  });
  if (!result.written.events.length) return { duplicate: true, id }; // lost a race with an identical submission
  await finish(store, result, code);
  return { duplicate: false, id, event: result.written.events[0] };
}

export async function setArchived(identity, codeInput, archived) {
  const store = await getStore();
  const code = await resolveCode(codeInput);
  const now = new Date().toISOString();
  const result = await store.mutateShipment(code, (current) => {
    if (!current) throw new ServiceError("not_found", "Shipment not found", 404);
    if ((current.archived === true) === archived) return null;
    return {
      next: { ...current, archived, archivedAt: archived ? now : null, rev: (Number(current.rev) || 0) + 1, updatedAt: now, updatedBy: identity.sub },
      events: [],
      audit: [{ at: now, actor: identity.sub, role: identity.role, via: identity.via || "admin", shipment: code, action: archived ? "shipment.archived" : "shipment.unarchived", previous: { archived: !archived }, next: { archived } }]
    };
  });
  return !!result;
}

export async function deleteShipment(identity, codeInput) {
  const store = await getStore();
  const code = await resolveCode(codeInput);
  const current = await store.getShipment(code);
  if (!current) throw new ServiceError("not_found", "Shipment not found", 404);
  await store.deleteShipment(code, {
    at: new Date().toISOString(), actor: identity.sub, role: identity.role, via: identity.via || "admin", shipment: code,
    action: "shipment.deleted", previous: { status: resolveShipmentStatus(current), origin: current.origin || null, destination: current.destination || null }, next: null
  });
}

/** Additive, idempotent migration: adds derived/default fields to legacy documents. Never removes anything. */
export async function runBackfill(identity, { cursor = null, limit = 200 } = {}) {
  const store = await getStore();
  const now = new Date().toISOString();
  const page = await store.backfillPage({ cursor, limit, apply: (s) => {
    const patch = {};
    const code = resolveShipmentStatus(s);
    if (!s.statusCode && code) { patch.statusCode = code; patch.progressCode = STATUS_META[code].order != null ? code : null; }
    if (s.archived == null) patch.archived = false;
    if (!s.updatedAt && s.createdAt) patch.updatedAt = s.createdAt;
    if (s.rev == null) patch.rev = 1;
    if (s.location == null && s.currentLocation) patch.location = s.currentLocation;
    if (s.destination && s.destinationLower == null) Object.assign(patch, { destinationLower: String(s.destination).toLowerCase() });
    if ((s.location || s.currentLocation) && s.locationLower == null) patch.locationLower = String(s.location || s.currentLocation).toLowerCase();
    if (s.origin && s.originLower == null) patch.originLower = String(s.origin).toLowerCase();
    if (s.clientRef && s.clientRefLower == null) patch.clientRefLower = String(s.clientRef).toLowerCase();
    if (s.latitude != null && !s.locationUpdatedAt) patch.locationUpdatedAt = s.updatedAt || s.createdAt || now;
    return Object.keys(patch).length ? patch : null;
  } });
  return page;
}

// ---------- read operations ----------

export async function getClientView(codeInput, { preview = false } = {}) {
  const store = await getStore();
  const code = normalizeTrackingCode(String(codeInput ?? ""));
  if (!code) return null;
  let shipment = await store.getShipment(code);
  if (!shipment && typeof codeInput === "string" && codeInput.trim() !== code) shipment = await store.getShipment(codeInput.trim());
  if (!shipment || (shipment.archived === true && !preview)) return null;
  return buildViewFor(store, shipment, { preview });
}

/** Stored courier record (Firestore) overrides the built-in catalog entry for the same id. */
function mergedCourier(courierInput, stored) {
  const id = carrierId(courierInput);
  return id ? mergeCarriers(stored ? [{ ...stored, id }] : []).find((c) => c.id === id) || null : null;
}
async function resolveCourier(store, courierInput) {
  return mergedCourier(courierInput, await store.getCourier(courierInput).catch(() => null));
}

export async function buildViewFor(store, shipment, { preview = false } = {}) {
  const [events, locations, stored] = await Promise.all([
    store.listEvents(shipment.id, 100), store.listLocations(shipment.id, 40), store.getCourier(shipment.courier).catch(() => null)
  ]);
  return buildClientView({ shipment, events, locations, courier: mergedCourier(shipment.courier, stored), preview });
}

export async function getAdminShipment(codeInput) {
  const store = await getStore();
  const code = await resolveCode(codeInput);
  const shipment = await store.getShipment(code);
  if (!shipment) throw new ServiceError("not_found", "Shipment not found", 404);
  const [events, locations] = await Promise.all([store.listEvents(code, 200), store.listLocations(code, 100)]);
  return { shipment: { ...shipment, statusCode: resolveShipmentStatus(shipment), visibility: resolveVisibility(shipment.visibility) }, events, locations };
}

export async function dashboardStats() {
  const store = await getStore();
  const [stats, recent, audit] = await Promise.all([store.stats(), store.recentShipments(8), store.listAudit({ limit: 60 })]);
  const by = stats.byStatus;
  const n = (...codes) => codes.reduce((a, c) => a + (by[c] || 0), 0);
  const nonArchivedTotal = Object.values(by).reduce((a, b) => a + b, 0);
  const pick = (types) => audit.filter((a) => types.includes(a.action)).slice(0, 8);
  return {
    totals: {
      total: stats.total,
      active: nonArchivedTotal - n(STATUS.DELIVERED, STATUS.CANCELLED),
      inTransit: n(STATUS.PICKED_UP, STATUS.IN_TRANSIT, STATUS.AT_FACILITY, STATUS.CUSTOMS, STATUS.OUT_FOR_DELIVERY),
      delivered: n(STATUS.DELIVERED),
      delayed: n(STATUS.DELAYED),
      exceptions: n(STATUS.EXCEPTION),
      cancelled: n(STATUS.CANCELLED),
      archived: stats.archived,
      unclassified: stats.unmigrated
    },
    byStatus: by,
    needsMigration: stats.unmigrated > 0,
    unmigrated: stats.unmigrated,
    recentShipments: recent.map((s) => ({ id: s.id, status: resolveShipmentStatus(s), statusLabel: s.status, origin: s.origin, destination: s.destination, location: s.location || null, updatedAt: s.updatedAt || s.createdAt || null })),
    recentLocationUpdates: pick(["location.changed"]),
    recentTrackingEvents: pick(["event.added", "status.changed"]),
    recentActivity: audit.slice(0, 12),
    storeKind: store.kind,
    generatedAt: new Date().toISOString()
  };
}

export async function listShipments(filters) {
  const store = await getStore();
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 25, 1), 100);
  const status = filters.status ? normalizeStatus(filters.status) : null;
  const q = filters.q ? String(filters.q).trim().toUpperCase().replace(/\s+/g, "") : "";
  const page = await store.listShipments({
    prefix: q || undefined,
    statusCode: status || undefined,
    destination: filters.destination ? String(filters.destination).trim().toLowerCase() : undefined,
    location: filters.location ? String(filters.location).trim().toLowerCase() : undefined,
    clientRef: filters.clientRef ? String(filters.clientRef).trim().toLowerCase() : undefined,
    includeArchived: !!filters.includeArchived,
    limit, cursor: filters.cursor || undefined
  });
  return {
    items: page.items.map((s) => ({
      id: s.id, statusCode: resolveShipmentStatus(s), status: s.status, courier: s.courier || null, origin: s.origin || null,
      destination: s.destination || null, location: s.location || s.currentLocation || null, clientRef: s.clientRef || null,
      archived: s.archived === true, updatedAt: s.updatedAt || s.createdAt || null, hasCoordinates: typeof s.latitude === "number" && typeof s.longitude === "number"
    })),
    nextCursor: page.nextCursor
  };
}

export async function recentAudit({ limit = 100, code } = {}) {
  const store = await getStore();
  return store.listAudit({ limit: Math.min(limit, 200), code: code ? normalizeTrackingCode(code) || undefined : undefined });
}
