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
  const clients = new Map(Object.entries(seed.clients || {}).map(([k, v]) => [k, clone(v)]));
  const portfolioHistory = new Map(Object.entries(seed.portfolioHistory || {}).map(([k, v]) => [k, new Map(Object.entries(clone(v)))]));
  const authUsers = new Map(Object.entries(seed.authUsers || {}).map(([k, v]) => [k, clone(v)]));
  const idTokens = new Map(Object.entries(seed.idTokens || {}));
  const deletedClients = new Map(); // recovery copies of permanently deleted clients (admin-only)
  const faults = new Set(); // test hook: simulate failures ("clientDeleteBatch")
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
    async listCouriers() { return [...couriers.entries()].map(([docId, c]) => ({ ...clone(c), docId })); },
    async findCourierDoc(id) {
      if (!id) return null;
      const key = String(id).trim();
      if (couriers.has(key.toLowerCase())) return { ...clone(couriers.get(key.toLowerCase())), docId: key.toLowerCase() };
      for (const [docId, c] of couriers) if (c.id === key) return { ...clone(c), docId };
      return null;
    },
    async createCourier(docId, data, auditEntry) {
      if (couriers.has(docId)) throw Object.assign(new Error("exists"), { code: "courier_exists" });
      couriers.set(docId, clone(data)); if (auditEntry) audit.push(clone(auditEntry));
    },
    async updateCourier(docId, patch, auditEntry) {
      if (!couriers.has(docId)) throw Object.assign(new Error("missing"), { code: "courier_missing" });
      couriers.set(docId, { ...couriers.get(docId), ...clone(patch) }); if (auditEntry) audit.push(clone(auditEntry));
    },
    async addAuditEntry(entry) { audit.push(clone(entry)); },

    // ---------- registered clients (same contract as the Firestore store) ----------
    async listClientRecords() {
      return [...clients.entries()].map(([id, c]) => { const u = authUsers.get(id); return { ...clone(c), id, auth: u ? { disabled: !!u.disabled, createdAt: u.createdAt || null, lastSignInAt: u.lastSignInAt || null, lastActiveAt: null } : null }; });
    },
    async getClientRecord(uid) {
      if (!clients.has(uid)) return null;
      const u = authUsers.get(uid);
      return { ...clone(clients.get(uid)), id: uid, auth: u ? { disabled: !!u.disabled, admin: u.admin === true } : null };
    },
    async createClientAccount({ email, password }, profile, history, auditEntry) {
      if ([...authUsers.values()].some((u) => u.email === email)) throw Object.assign(new Error("exists"), { code: "auth/email-already-exists" });
      const uid = `uid_${crypto.randomBytes(6).toString("hex")}`;
      authUsers.set(uid, { email, password, disabled: false, createdAt: new Date().toISOString() });
      clients.set(uid, { ...clone(profile), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (history) { if (!portfolioHistory.has(uid)) portfolioHistory.set(uid, new Map()); portfolioHistory.get(uid).set(history.dateKey, clone(history.values)); }
      if (auditEntry) audit.push({ ...clone(auditEntry), client: uid });
      return uid;
    },
    async updateClientRecord(uid, patch, { password, history, auditEntry, disabled } = {}) {
      if (!clients.has(uid)) throw Object.assign(new Error("missing"), { code: "client_missing" });
      const u = authUsers.get(uid);
      if (u && password) u.password = password;
      if (u && disabled !== undefined) u.disabled = disabled;
      const cur = clients.get(uid);
      clients.set(uid, { ...cur, ...clone(patch), updated_at: new Date().toISOString() });
      if (history) { if (!portfolioHistory.has(uid)) portfolioHistory.set(uid, new Map()); portfolioHistory.get(uid).set(history.dateKey, clone(history.values)); }
      if (auditEntry) audit.push(clone(auditEntry));
    },
    async deleteClientPermanently(uid, { onAuditEntry } = {}) {
      if (!clients.has(uid)) throw Object.assign(new Error("missing"), { code: "client_missing" });
      const user = authUsers.get(uid) || null;
      if (user?.admin === true) throw Object.assign(new Error("admin"), { code: "client_is_admin" });
      const authBroken = faults.has("clientAuthUnavailable");
      let disabledNow = false;
      if (user && !user.disabled && !authBroken) { user.disabled = true; disabledNow = true; }
      const removed = { profile: 1, history: portfolioHistory.get(uid)?.size || 0 };
      if (faults.has("clientDeleteBatch")) { if (disabledNow) user.disabled = false; throw new Error("simulated database failure"); }
      const entry = onAuditEntry ? onAuditEntry({ removed, result: "SUCCESS" }) : null;
      const { password_hash, ...profile } = clone(clients.get(uid));
      deletedClients.set(uid, { id: uid, profile, history: Object.fromEntries(portfolioHistory.get(uid) || []), deleted_at: entry?.at || new Date().toISOString(), deleted_by: entry?.actor || null });
      clients.delete(uid); portfolioHistory.delete(uid);
      if (entry) audit.push(entry);
      if (user && authBroken) return { removed, authDeleted: false, authDisabled: !!user.disabled, authError: "auth/insufficient-permission: simulated", authExisted: true };
      if (user) authUsers.delete(uid);
      return { removed, authDeleted: true, authDisabled: true, authError: null, authExisted: !!user };
    },
    /** Test helper: sign in as a client with the in-memory auth store (mirrors Firebase Auth behaviour). */
    __clientSignIn(email, password) {
      for (const [uid, u] of authUsers) if (u.email === email && u.password === password) return u.disabled ? { error: "auth/user-disabled" } : { uid };
      return { error: "auth/user-not-found" };
    },
    __fault(name, on = true) { if (on) faults.add(name); else faults.delete(name); },

    async verifyIdToken(token) { return idTokens.get(token) || null; },
    __dump() { return { shipments, events, locations, audit, clients, portfolioHistory, authUsers, couriers, deletedClients }; }
  };
}
