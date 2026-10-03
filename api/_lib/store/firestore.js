// Firestore (firebase-admin) store. Runs ONLY on the server; admin SDK bypasses security rules,
// so every authorization decision is made in lib/ + api/ before reaching this layer.
//
// Collections:
//   shipments/{TRACKING_CODE}                (existing; extended with additive fields)
//   shipments/{code}/events/{eventId}        tracking events (deterministic ids => dedupe)
//   shipments/{code}/locations/{locationId}  location history (source-tagged)
//   audit_logs/{id}                          admin-only audit trail
//   notification_log/{key}                   notification de-duplication markers
import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { resolveShipmentStatus, STATUS_CODES } from "../../../shared/status.js";

function credentials() {
  if (process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_SERVICE_ACCOUNT) return undefined; // emulator needs no credentials
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return applicationDefault();
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return cert(JSON.parse(text));
}

export function createFirestoreStore() {
  const app = getApps()[0] || initializeApp({ ...(credentials() ? { credential: credentials() } : {}), projectId: process.env.FIREBASE_PROJECT_ID || "hyperion-logistics" });
  const db = getFirestore(app);
  try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already initialised */ }
  const shipments = db.collection("shipments");
  const stripId = (snap) => ({ ...snap.data(), id: snap.id });

  return {
    kind: "firestore",

    async getShipment(code) {
      const snap = await shipments.doc(code).get();
      return snap.exists ? stripId(snap) : null;
    },

    /**
     * Atomic read-modify-write. `fn(current)` MUST be pure (transactions may retry). It returns
     * { next, events, locations, audit } or null for "no change". Events/locations use deterministic
     * ids and are skipped when they already exist, which is what prevents duplicates.
     */
    async mutateShipment(code, fn) {
      const ref = shipments.doc(code);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? stripId(snap) : null;
        const result = fn(current);
        if (!result) return null;
        const evRefs = (result.events || []).map((e) => ref.collection("events").doc(e.id));
        const locRefs = (result.locations || []).map((l) => ref.collection("locations").doc(l.id));
        const existing = await Promise.all([...evRefs, ...locRefs].map((r) => tx.get(r)));
        const written = { events: [], locations: [] };
        const { id: _drop, ...nextData } = result.next;
        tx.set(ref, nextData);
        (result.events || []).forEach((e, i) => {
          if (!existing[i].exists) { tx.set(evRefs[i], e); written.events.push(e); }
        });
        (result.locations || []).forEach((l, i) => {
          if (!existing[evRefs.length + i].exists) { tx.set(locRefs[i], l); written.locations.push(l); }
        });
        for (const a of result.audit || []) tx.set(db.collection("audit_logs").doc(), a);
        return { shipment: { ...nextData, id: code }, written };
      });
    },

    async listEvents(code, limit = 100) {
      const q = await shipments.doc(code).collection("events").orderBy("timestamp", "desc").limit(limit).get();
      return q.docs.map(stripId);
    },
    async listLocations(code, limit = 50) {
      const q = await shipments.doc(code).collection("locations").orderBy("timestamp", "desc").limit(limit).get();
      return q.docs.map(stripId);
    },

    /**
     * Paginated, index-friendly listing. Exactly ONE server-side filter is used (the most selective one,
     * all of which are served by automatic single-field indexes); remaining filters apply in memory.
     */
    async listShipments({ prefix, statusCode, destination, location, clientRef, limit = 25, cursor, includeArchived = false }) {
      const lc = (s) => (s || "").toLowerCase();
      const range = (q, field, value) => q.orderBy(field).where(field, ">=", value).where(field, "<=", value + "");
      const items = [];
      let nextCursor = null;
      let after = cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString()) : null;
      let guard = 0;

      while (items.length < limit && guard++ < 6) {
        let q = shipments;
        let orderField = null;
        if (prefix) {
          q = q.orderBy(FieldPath.documentId()).where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<=", prefix + "");
        } else if (destination) { q = range(q, "destinationLower", lc(destination)); orderField = "destinationLower"; }
        else if (location) { q = range(q, "locationLower", lc(location)); orderField = "locationLower"; }
        else if (clientRef) { q = range(q, "clientRefLower", lc(clientRef)); orderField = "clientRefLower"; }
        else if (statusCode) { q = q.where("statusCode", "==", statusCode).orderBy(FieldPath.documentId()); }
        else { q = q.orderBy(FieldPath.documentId()); }
        if (orderField) q = q.orderBy(FieldPath.documentId());
        if (after) q = orderField ? q.startAfter(after.v, after.id) : q.startAfter(after.id);
        const snap = await q.limit(limit * 2).get();
        if (snap.empty) { nextCursor = null; break; }

        let exhausted = snap.size < limit * 2;
        for (const d of snap.docs) {
          const s = stripId(d);
          after = { id: d.id, v: orderField ? d.get(orderField) : undefined };
          if (!includeArchived && s.archived === true) continue;
          if (prefix && !d.id.startsWith(prefix)) continue;
          if (statusCode && resolveShipmentStatus(s) !== statusCode) continue;
          if (destination && !lc(s.destination).startsWith(lc(destination))) continue;
          if (location && !lc(s.location || s.currentLocation).startsWith(lc(location))) continue;
          if (clientRef && !lc(s.clientRef).startsWith(lc(clientRef))) continue;
          items.push(s);
          if (items.length >= limit) { exhausted = false; break; }
        }
        nextCursor = exhausted ? null : Buffer.from(JSON.stringify(after)).toString("base64url");
        if (exhausted) break;
      }
      return { items, nextCursor };
    },

    async stats() {
      const count = async (q) => (await q.count().get()).data().count;
      const [total, archived, ...per] = await Promise.all([
        count(shipments),
        count(shipments.where("archived", "==", true)),
        ...STATUS_CODES.map((c) => count(shipments.where("archived", "==", false).where("statusCode", "==", c)))
      ]);
      const byStatus = {};
      let migrated = 0;
      STATUS_CODES.forEach((c, i) => { if (per[i]) byStatus[c] = per[i]; migrated += per[i]; });
      return { total, archived, byStatus, unmigrated: Math.max(0, total - archived - migrated) };
    },

    async recentShipments(limit = 8) {
      const q = await shipments.orderBy("updatedAt", "desc").limit(limit).get();
      if (!q.empty) return q.docs.map(stripId);
      const fallback = await shipments.orderBy("createdAt", "desc").limit(limit).get().catch(() => ({ docs: [] }));
      return fallback.docs.map(stripId);
    },

    async listAudit({ limit = 50, code } = {}) {
      let q = db.collection("audit_logs");
      if (code) q = q.where("shipment", "==", code);
      else q = q.orderBy("at", "desc");
      const snap = await q.limit(code ? Math.max(limit, 200) : limit).get();
      const rows = snap.docs.map(stripId).sort((a, b) => b.at.localeCompare(a.at));
      return rows.slice(0, limit);
    },

    async deleteShipment(code, auditEntry) {
      const ref = shipments.doc(code);
      await db.recursiveDelete(ref);
      if (auditEntry) await db.collection("audit_logs").add(auditEntry);
    },

    watchShipment(code, cb) {
      return shipments.doc(code).onSnapshot(
        (snap) => cb(snap.exists ? stripId(snap) : null),
        () => cb(undefined) // listener error => caller closes stream, client falls back to polling
      );
    },

    async claimNotification(key) {
      try { await db.collection("notification_log").doc(key).create({ at: new Date().toISOString() }); return true; }
      catch (err) { if (err.code === 6) return false; throw err; }
    },

    async backfillPage({ cursor, limit = 200, apply }) {
      let q = shipments.orderBy(FieldPath.documentId());
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.limit(limit).get();
      const batch = db.batch();
      let changed = 0;
      for (const d of snap.docs) {
        const patch = apply(stripId(d));
        if (patch) { batch.set(d.ref, patch, { merge: true }); changed += 1; }
      }
      if (changed) await batch.commit();
      return { scanned: snap.size, changed, nextCursor: snap.size === limit ? snap.docs[snap.size - 1].id : null };
    },

    async getCourier(id) {
      if (!id) return null;
      const snap = await db.collection("couriers").doc(String(id).toLowerCase()).get();
      if (snap.exists) return snap.data();
      const q = await db.collection("couriers").where("id", "==", String(id)).limit(1).get();
      return q.empty ? null : q.docs[0].data();
    },

    // Courier directory (admin-managed). Writes only add or merge fields; records are never deleted here.
    async listCouriers() {
      const snap = await db.collection("couriers").get();
      return snap.docs.map((d) => ({ ...d.data(), docId: d.id }));
    },
    async findCourierDoc(id) {
      if (!id) return null;
      const key = String(id).trim();
      const direct = await db.collection("couriers").doc(key.toLowerCase()).get();
      if (direct.exists) return { ...direct.data(), docId: direct.id };
      const q = await db.collection("couriers").where("id", "==", key).limit(1).get();
      return q.empty ? null : { ...q.docs[0].data(), docId: q.docs[0].id };
    },
    async createCourier(docId, data, auditEntry) {
      const ref = db.collection("couriers").doc(docId);
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) throw Object.assign(new Error("exists"), { code: "courier_exists" });
        tx.set(ref, data);
        if (auditEntry) tx.set(db.collection("audit_logs").doc(), auditEntry);
      });
    },
    async updateCourier(docId, patch, auditEntry) {
      const ref = db.collection("couriers").doc(docId);
      await db.runTransaction(async (tx) => {
        if (!(await tx.get(ref)).exists) throw Object.assign(new Error("missing"), { code: "courier_missing" });
        tx.set(ref, patch, { merge: true });
        if (auditEntry) tx.set(db.collection("audit_logs").doc(), auditEntry);
      });
    },

    async addAuditEntry(entry) { await db.collection("audit_logs").add(entry); },

    // ---------- registered clients (portfolio accounts) ----------
    // Schema (existing): Firebase Auth user uid  <->  clients/{uid}  (+ portfolio_history/{uid}/history/{date}).
    // Shipments are NOT linked to client accounts (only a free-text clientRef), so client operations never touch them.
    async listClientRecords() {
      const snap = await db.collection("clients").get();
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const meta = new Map();
      const auth = getAuth(app);
      for (let i = 0; i < rows.length; i += 100) {
        const res = await auth.getUsers(rows.slice(i, i + 100).map((r) => ({ uid: r.id }))).catch(() => ({ users: [] }));
        for (const u of res.users) meta.set(u.uid, { disabled: u.disabled, createdAt: u.metadata.creationTime || null, lastSignInAt: u.metadata.lastSignInTime || null, lastActiveAt: u.metadata.lastRefreshTime || null });
      }
      return rows.map((r) => ({ ...r, auth: meta.get(r.id) || null }));
    },
    async getClientRecord(uid) {
      const snap = await db.collection("clients").doc(uid).get();
      if (!snap.exists) return null;
      const user = await getAuth(app).getUser(uid).catch(() => null);
      return { ...snap.data(), id: snap.id, auth: user ? { disabled: user.disabled, admin: user.customClaims?.admin === true } : null };
    },
    async createClientAccount({ email, password, displayName }, profile, history, auditEntry) {
      const auth = getAuth(app);
      const user = await auth.createUser({ email, password, displayName });
      try {
        const batch = db.batch();
        batch.set(db.collection("clients").doc(user.uid), { ...profile, created_at: new Date(), updated_at: new Date() });
        if (history) batch.set(db.collection("portfolio_history").doc(user.uid).collection("history").doc(history.dateKey), { ...history.values, timestamp: new Date() }, { merge: true });
        if (auditEntry) batch.set(db.collection("audit_logs").doc(), { ...auditEntry, client: user.uid });
        await batch.commit();
      } catch (err) {
        await auth.deleteUser(user.uid).catch(() => {}); // never leave a sign-in account without a profile
        throw err;
      }
      return user.uid;
    },
    async updateClientRecord(uid, patch, { password, history, auditEntry, disabled } = {}) {
      const ref = db.collection("clients").doc(uid);
      if (!(await ref.get()).exists) throw Object.assign(new Error("missing"), { code: "client_missing" });
      const auth = getAuth(app);
      if (password || disabled !== undefined) {
        await auth.updateUser(uid, { ...(password ? { password } : {}), ...(disabled !== undefined ? { disabled } : {}) }).catch((err) => { if (err?.code !== "auth/user-not-found") throw err; });
      }
      const batch = db.batch();
      batch.set(ref, { ...patch, updated_at: new Date() }, { merge: true });
      if (history) batch.set(db.collection("portfolio_history").doc(uid).collection("history").doc(history.dateKey), { ...history.values, timestamp: new Date() }, { merge: true });
      if (auditEntry) batch.set(db.collection("audit_logs").doc(), auditEntry);
      await batch.commit();
    },
    /**
     * Permanent deletion of ONE client, keyed by uid. Order keeps the system consistent:
     *   1. disable the sign-in account (reversible) so the client cannot act mid-delete,
     *   2. delete clients/{uid} + portfolio_history/{uid}/** in one atomic batch,
     *   3. delete the sign-in account.
     * If step 2 fails, step 1 is undone and nothing was removed. If step 3 fails, the account stays disabled
     * (it cannot sign in) and the caller is told so.
     */
    async deleteClientPermanently(uid, { onAuditEntry } = {}) {
      const auth = getAuth(app);
      const ref = db.collection("clients").doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw Object.assign(new Error("missing"), { code: "client_missing" });
      const user = await auth.getUser(uid).catch((err) => { if (err?.code === "auth/user-not-found") return null; throw err; });
      if (user?.customClaims?.admin === true) throw Object.assign(new Error("admin"), { code: "client_is_admin" });
      const wasDisabled = !!user?.disabled;
      if (user && !wasDisabled) await auth.updateUser(uid, { disabled: true });
      const historyRefs = await db.collection("portfolio_history").doc(uid).collection("history").listDocuments();
      const parent = db.collection("portfolio_history").doc(uid);
      const removed = { profile: 1, history: historyRefs.length };
      try {
        if (historyRefs.length > 450) throw Object.assign(new Error("too many history records for one atomic delete"), { code: "client_history_too_large" });
        const batch = db.batch();
        historyRefs.forEach((r) => batch.delete(r));
        batch.delete(parent);
        batch.delete(ref);
        if (onAuditEntry) batch.set(db.collection("audit_logs").doc(), onAuditEntry({ removed, result: "success" }));
        await batch.commit();
      } catch (err) {
        if (user && !wasDisabled) await auth.updateUser(uid, { disabled: false }).catch(() => {});
        throw err;
      }
      let authDeleted = !user;
      if (user) { try { await auth.deleteUser(uid); authDeleted = true; } catch { authDeleted = false; } }
      return { removed, authDeleted, authExisted: !!user };
    },

    async verifyIdToken(token) { return getAuth(app).verifyIdToken(token); }
  };
}
