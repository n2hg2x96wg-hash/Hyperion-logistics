// In-memory store: used for local development (npm run dev) and automated tests.
// Implements exactly the same contract as the Firestore store.
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { ACTIVE_STATUSES, STATUS_CODES, resolveShipmentStatus } from "../../../shared/status.js";

const clone = (v) => (v == null ? v : structuredClone(v));

export function createMemoryStore(seed = {}) {
  const shipments = new Map(Object.entries(seed.shipments || {}).map(([k, v]) => [k, clone({ ...v, id: k })]));
  const events = new Map();     // code -> Map(id -> event)
  const locations = new Map();  // code -> Map(id -> loc)
  const audit = [];
  const notified = new Set();
  const couriers = new Map(Object.entries(seed.couriers || {}));
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  const sub = (map, code) => { if (!map.has(code)) map.set(code, new Map()); return map.get(code); };

  return {
    kind: "memory",
    async getShipment(code) { const s = shipments.get(code); return s ? clone(s) : null; },

    async mutateShipment(code, fn) {
      const current = shipments.get(code) ? clone(shipments.get(code)) : null;
      const result = fn(current);
      if (!result) return null;
      const written = { events: [], locations: [] };
      shipments.set(code, clone({ ...result.next, id: code }));
      for (const e of result.events || []) {
        const m = sub(events, code);
        if (!m.has(e.id)) { m.set(e.id, clone(e)); written.events.push(clone(e)); }
      }
      for (const l of result.locations || []) {
        const m = sub(locations, code);
        if (!m.has(l.id)) { m.set(l.id, clone(l)); written.locations.push(clone(l)); }
      }
      for (const a of result.audit || []) audit.push({ id: crypto.randomUUID(), ...clone(a) });
      bus.emit(`ship:${code}`, clone(shipments.get(code)));
      return { shipment: clone(shipments.get(code)), written };
    },

    async listEvents(code, limit = 100) {
      return [...(events.get(code)?.values() || [])].map(clone)
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")).slice(0, limit);
    },
    async listLocations(code, limit = 50) {
      return [...(locations.get(code)?.values() || [])].map(clone)
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")).slice(0, limit);
    },

    async listShipments({ prefix, statusCode, destination, location, clientRef, limit = 25, cursor, includeArchived = false }) {
      const lc = (s) => (s || "").toLowerCase();
      let rows = [...shipments.values()].map(clone).sort((a, b) => a.id.localeCompare(b.id));
      rows = rows.filter((s) => {
        if (!includeArchived && s.archived === true) return false;
        if (prefix && !s.id.startsWith(prefix)) return false;
        if (statusCode && resolveShipmentStatus(s) !== statusCode) return false;
        if (destination && !lc(s.destination).startsWith(lc(destination))) return false;
        if (location && !lc(s.location || s.currentLocation).startsWith(lc(location))) return false;
        if (clientRef && !lc(s.clientRef).startsWith(lc(clientRef))) return false;
        return true;
      });
      if (cursor) rows = rows.filter((s) => s.id > cursor);
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
    },

    async stats() {
      const byStatus = {}; let total = 0; let archived = 0; let unmigrated = 0;
      for (const s of shipments.values()) {
        total += 1;
        if (s.archived === true) { archived += 1; continue; }
        const code = resolveShipmentStatus(s) || "UNKNOWN";
        byStatus[code] = (byStatus[code] || 0) + 1;
        if (!s.statusCode || s.archived !== false) unmigrated += 1;
      }
      return { total, archived, byStatus, unmigrated };
    },

    async recentShipments(limit = 8) {
      return [...shipments.values()].map(clone)
        .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")).slice(0, limit);
    },

    async listAudit({ limit = 50, code } = {}) {
      return audit.filter((a) => !code || a.shipment === code).map(clone)
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    },

    async deleteShipment(code, auditEntry) {
      shipments.delete(code); events.delete(code); locations.delete(code);
      if (auditEntry) audit.push({ id: crypto.randomUUID(), ...clone(auditEntry) });
      bus.emit(`ship:${code}`, null);
    },

    watchShipment(code, cb) {
      const handler = (s) => cb(s ? clone(s) : null);
      bus.on(`ship:${code}`, handler);
      return () => bus.off(`ship:${code}`, handler);
    },

    async claimNotification(key) {
      if (notified.has(key)) return false;
      notified.add(key); return true;
    },

    async backfillPage({ cursor, limit = 200, apply }) {
      const rows = [...shipments.values()].sort((a, b) => a.id.localeCompare(b.id)).filter((s) => !cursor || s.id > cursor).slice(0, limit);
      let changed = 0;
      for (const s of rows) {
        const patch = apply(clone(s));
        if (patch) { shipments.set(s.id, { ...s, ...patch }); changed += 1; }
      }
      return { scanned: rows.length, changed, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null };
    },

    async getCourier(id) { return id ? clone(couriers.get(String(id).toLowerCase())) || null : null; },
    async verifyIdToken() { return null; },
    __dump() { return { shipments, events, locations, audit }; }
  };
}
