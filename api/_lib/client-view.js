// The ONLY place that turns an internal shipment document into data a client may see.
// It is a strict whitelist: anything not copied here (internalNotes, audit data, courier API endpoints,
// raw ids, clientRef...) can never reach the browser, and visibility switches are enforced here on the
// server, not with CSS.
import {
  STATUS, STATUS_META, EVENT_SOURCES, EXCEPTION_TYPES,
  resolveShipmentStatus, resolveVisibility, computeProgress, progressSteps, statusLabel, statusTone
} from "../../shared/status.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isoOrNull = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

function point(lat, lng) {
  const a = num(lat); const b = num(lng);
  return a != null && b != null && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lng: b } : null;
}

export function shipmentVersion(s) {
  return String(s?.rev ?? s?.updatedAt ?? s?.createdAt ?? "0");
}

/** Legacy `updates: [{title, description, location, timestamp}]` -> event objects (read-only). */
function legacyEvents(shipment) {
  if (!Array.isArray(shipment.updates)) return [];
  return shipment.updates.map((u, i) => ({
    id: `legacy-${i}`,
    kind: "status",
    statusCode: null,
    title: String(u?.title || "Update"),
    description: String(u?.description || ""),
    location: String(u?.location || ""),
    timestamp: isoOrNull(u?.timestamp) || isoOrNull(shipment.createdAt),
    seq: -1 - i,
    source: "system",
    clientVisible: true
  })).filter((e) => e.timestamp);
}

export function buildClientView({ shipment, events = [], locations = [], courier = null, now = new Date(), preview = false }) {
  const vis = resolveVisibility(shipment.visibility);
  const statusCode = resolveShipmentStatus(shipment);
  const progressCode = shipment.progressCode || null;
  const view = {
    trackingCode: shipment.id,
    version: shipmentVersion(shipment),
    serverTime: now.toISOString(),
    preview: !!preview,
    status: statusCode
      ? { code: statusCode, label: statusLabel(statusCode), tone: statusTone(statusCode) }
      : { code: null, label: shipment.status ? String(shipment.status).slice(0, 60) : "Status unavailable", tone: "neutral" },
    origin: shipment.origin ? String(shipment.origin) : null,
    destination: shipment.destination ? String(shipment.destination) : null,
    lastUpdated: [shipment.locationUpdatedAt, shipment.statusUpdatedAt, shipment.updatedAt, shipment.createdAt]
      .map(isoOrNull).filter(Boolean).sort().pop() || null,
    createdAt: isoOrNull(shipment.createdAt)
  };

  // Exception: only if actually recorded on the shipment.
  const ex = shipment.exception;
  if (ex && ex.type && ex.clientVisible !== false && (statusCode === STATUS.DELAYED || statusCode === STATUS.EXCEPTION)) {
    view.exception = {
      type: ex.type,
      label: EXCEPTION_TYPES[ex.type] || "Shipment exception",
      note: ex.note ? String(ex.note).slice(0, 500) : "",
      recordedAt: isoOrNull(ex.recordedAt)
    };
  }

  if (vis.progress) {
    const p = computeProgress(statusCode, progressCode);
    const withCustoms = statusCode === STATUS.CUSTOMS || progressCode === STATUS.CUSTOMS ||
      events.some((e) => e.statusCode === STATUS.CUSTOMS && e.clientVisible !== false);
    view.progress = {
      pct: p.pct, stage: p.stage, held: !!p.held, cancelled: !!p.cancelled,
      steps: progressSteps(withCustoms)
    };
  }

  if (vis.location && shipment.location) {
    view.currentLocation = {
      name: String(shipment.location),
      updatedAt: isoOrNull(shipment.locationUpdatedAt),
      source: shipment.locationSource || "admin",
      sourceLabel: EVENT_SOURCES[shipment.locationSource] || EVENT_SOURCES.admin
    };
  }

  if (vis.eta) {
    if (statusCode === STATUS.DELIVERED) {
      const delivered = events.filter((e) => e.statusCode === STATUS.DELIVERED && e.clientVisible !== false)
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))[0];
      view.eta = { state: "delivered", deliveredAt: isoOrNull(delivered?.timestamp) || isoOrNull(shipment.statusUpdatedAt) };
    } else if (statusCode === STATUS.CANCELLED) {
      view.eta = { state: "unavailable", text: "Delivery estimate unavailable." };
    } else if (isoOrNull(shipment.etaWindowStart) && isoOrNull(shipment.etaWindowEnd)) {
      view.eta = { state: "window", start: shipment.etaWindowStart, end: shipment.etaWindowEnd, source: shipment.etaSource || "admin" };
    } else if (shipment.etaDate) {
      view.eta = {
        state: "date", date: String(shipment.etaDate), source: shipment.etaSource || "admin",
        overdue: String(shipment.etaDate) < now.toISOString().slice(0, 10)
      };
    } else if (shipment.eta && String(shipment.eta).trim() && !/^tbd$/i.test(String(shipment.eta).trim())) {
      view.eta = { state: "text", text: String(shipment.eta).slice(0, 80), source: "admin" };
    } else {
      view.eta = { state: "unavailable", text: "Delivery estimate unavailable." };
    }
  }

  if (vis.carrier && (shipment.courier || courier)) {
    view.carrier = {
      name: courier?.name || String(shipment.courier || "").slice(0, 60),
      trackingNumber: shipment.courierTrackingNumber ? String(shipment.courierTrackingNumber).slice(0, 80) : null,
      serviceType: shipment.serviceType ? String(shipment.serviceType).slice(0, 80) : null,
      phone: courier?.phone && courier.phone !== "--" ? courier.phone : null,
      website: courier?.website && /^https?:\/\//i.test(courier.website) ? courier.website : null
    };
  }
  if (vis.package) {
    const pkg = shipment.package || {};
    view.package = {
      description: pkg.description || null, weight: pkg.weight || null,
      dimensions: pkg.dimensions || null, pieces: pkg.pieces || null,
      distance: shipment.distance ? String(shipment.distance).slice(0, 40) : null
    };
  }
  if (vis.notes && shipment.notes) view.notes = String(shipment.notes).slice(0, 1000);
  if (vis.fee && shipment.fee) view.fee = String(shipment.fee).slice(0, 40);

  if (vis.map) {
    const map = {
      origin: point(shipment.originLat, shipment.originLng),
      destination: point(shipment.destinationLat, shipment.destinationLng),
      current: null,
      trail: []
    };
    if (vis.location) {
      map.current = point(shipment.latitude, shipment.longitude);
      if (map.current) {
        map.current.updatedAt = isoOrNull(shipment.locationUpdatedAt);
        map.current.name = shipment.location ? String(shipment.location) : null;
        map.current.source = shipment.locationSource || "admin";
        map.current.sourceLabel = EVENT_SOURCES[map.current.source] || EVENT_SOURCES.admin;
      }
      map.trail = locations
        .filter((l) => l.clientVisible !== false && point(l.lat, l.lng))
        .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""))
        .slice(-25)
        .map((l) => ({ ...point(l.lat, l.lng), timestamp: l.timestamp, name: l.name || null, source: l.source }));
    }
    map.originLabel = view.origin; map.destinationLabel = view.destination;
    view.map = map;
  }

  if (vis.timeline || vis.events) {
    const all = [...events, ...legacyEvents(shipment)]
      .filter((e) => e.clientVisible !== false)
      .filter((e) => (e.kind === "manual" ? vis.events : vis.timeline));
    // Hide location text in timeline entries when current location is hidden.
    view.timeline = all
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "") || (b.seq ?? 0) - (a.seq ?? 0))
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        statusCode: e.statusCode || null,
        title: String(e.title || (e.statusCode ? STATUS_META[e.statusCode]?.event : "Update") || "Update").slice(0, 120),
        description: e.description ? String(e.description).slice(0, 600) : "",
        location: vis.location && e.location ? String(e.location).slice(0, 120) : "",
        timestamp: e.timestamp,
        tone: e.statusCode ? statusTone(e.statusCode) : "neutral",
        source: e.source || "admin",
        sourceLabel: EVENT_SOURCES[e.source] || EVENT_SOURCES.admin
      }));
  }
  return view;
}

/** What the admin preview needs to show which switches are active (admin only, never in public responses). */
export function visibilityOf(shipment) { return resolveVisibility(shipment.visibility); }
