// Firestore (firebase-admin) store. Runs ONLY on the server; admin SDK bypasses security rules,
// so every authorization decision is made in lib/ + api/ before reaching this layer.
//
// Collections:
//   shipments/{TRACKING_CODE}                (existing; extended with additive fields)
//   shipments/{code}/events/{eventId}        tracking events (deterministic ids => dedupe)
//   shipments/{code}/locations/{locationId}  location history (source-tagged)
//   audit_logs/{id}                          admin-only audit trail
//   notification_log/{key}                   notification de-duplication markers
//   clients/{uid}/notifications/{id}         in-app customer notifications (server-only; written in the shipment
//                                            transaction, deterministic ids => no duplicates)
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

    /** Whether client sign-in accounts can be created: "ok", "not_configured" (Authentication not set up in the Firebase
     *  project) or "error". Reads one account at most; reports no account data. */
    async clientSignInStatus() {
      try { await getAuth(app).listUsers(1); return "ok"; }
      catch (err) { return err?.code === "auth/configuration-not-found" ? "not_configured" : "error"; }
    },

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
        const ntRefs = (result.notifications || []).map((n) => db.collection("clients").doc(n.customerId).collection("notifications").doc(n.id));
        const existing = await Promise.all([...evRefs, ...locRefs, ...ntRefs].map((r) => tx.get(r)));
        const written = { events: [], locations: [], notifications: [] };
        const { id: _drop, ...nextData } = result.next;
        tx.set(ref, nextData);
        (result.events || []).forEach((e, i) => {
          if (!existing[i].exists) { tx.set(evRefs[i], e); written.events.push(e); }
        });
        (result.locations || []).forEach((l, i) => {
          if (!existing[evRefs.length + i].exists) { tx.set(locRefs[i], l); written.locations.push(l); }
        });
        // a notification belongs to a milestone that is new in this transaction, and is never written twice
        const newEvents = new Set(written.events.map((e) => e.id));
        (result.notifications || []).forEach((n, i) => {
          if (newEvents.has(n.eventId) && !existing[evRefs.length + locRefs.length + i].exists) {
            const { id: _nid, ...data } = n; tx.set(ntRefs[i], data); written.notifications.push(n);
          }
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

    // Public homepage: field-masked scan for statistics (reads only these fields) and opted-in shipments
    // (single-field equality index, created automatically by Firestore).
    async scanShipmentSummaries(limit = 5000) {
      const snap = await shipments.select(...["statusCode", "status", "archived", "originCountry", "destinationCountry", "currentCountry", "origin", "destination", "location", "currentLocation", "originLat", "originLng", "destinationLat", "destinationLng", "latitude", "longitude", "updatedAt", "createdAt", "locationUpdatedAt", "locationSource", "publicMap", "statusUpdatedAt", "originCoordsSource", "destinationCoordsSource", "courier"]).limit(limit).get();
      return snap.docs.map(stripId);
    },
    // Full, paged export for backups (shipment documents + their events and location history). Read-only.
    async exportPage({ cursor = null, limit = 50 } = {}) {
      let q = shipments.orderBy(FieldPath.documentId());
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.limit(limit).get();
      const items = await Promise.all(snap.docs.map(async (d) => {
        const [ev, loc] = await Promise.all([d.ref.collection("events").get(), d.ref.collection("locations").get()]);
        return { id: d.id, data: stripId(d), events: ev.docs.map(stripId), locations: loc.docs.map(stripId) };
      }));
      return { items, nextCursor: snap.size === limit ? snap.docs[snap.size - 1].id : null };
    },
    async listPublicShipments(limit = 100) {
      const snap = await shipments.where("publicMap", "==", true).limit(limit).get();
      return snap.docs.map(stripId);
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
      const [snap, priv] = await Promise.all([db.collection("clients").get(), db.collection("client_private").get()]);
      const notes = new Map(priv.docs.map((d) => [d.id, d.get("admin_notes") || ""]));
      const rows = snap.docs.map((d) => ({ ...d.data(), admin_notes: notes.get(d.id) || "", id: d.id }));
      const meta = new Map();
      const auth = getAuth(app);
      for (let i = 0; i < rows.length; i += 100) {
        const res = await auth.getUsers(rows.slice(i, i + 100).map((r) => ({ uid: r.id }))).catch(() => ({ users: [] }));
        for (const u of res.users) meta.set(u.uid, { disabled: u.disabled, createdAt: u.metadata.creationTime || null, lastSignInAt: u.metadata.lastSignInTime || null, lastActiveAt: u.metadata.lastRefreshTime || null });
      }
      return rows.map((r) => ({ ...r, auth: meta.get(r.id) || null }));
    },
    /** Sign-in accounts (Firebase Auth, not admins) that have no clients/{uid} profile, e.g. left by the old browser-side signup. Count only. */
    async countAccountsWithoutProfile() {
      const ids = new Set((await db.collection("clients").select().get()).docs.map((d) => d.id));
      const auth = getAuth(app); let n = 0; let token;
      do {
        const page = await auth.listUsers(1000, token);
        for (const u of page.users) if (u.customClaims?.admin !== true && !ids.has(u.uid)) n += 1;
        token = page.pageToken;
      } while (token);
      return n;
    },
    async getClientRecord(uid) {
      const [snap, priv] = await Promise.all([db.collection("clients").doc(uid).get(), db.collection("client_private").doc(uid).get()]);
      if (!snap.exists) return null;
      const user = await getAuth(app).getUser(uid).catch(() => null);
      return { ...snap.data(), admin_notes: priv.exists ? priv.get("admin_notes") || "" : "", id: snap.id, auth: user ? { disabled: user.disabled, admin: user.customClaims?.admin === true } : null };
    },
    async createClientAccount({ email, password, displayName, disabled = false }, profile, history, auditEntry) {
      const auth = getAuth(app);
      const user = await auth.createUser({ email, password, displayName, disabled: !!disabled });
      try {
        const batch = db.batch();
        // admin notes live in client_private/{uid}: the customer can read their own clients/{uid} document
        const { admin_notes: notes, ...pub } = profile;
        batch.set(db.collection("clients").doc(user.uid), { ...pub, created_at: new Date(), updated_at: new Date() });
        if (notes) batch.set(db.collection("client_private").doc(user.uid), { admin_notes: notes });
        if (history) batch.set(db.collection("portfolio_history").doc(user.uid).collection("history").doc(history.dateKey), { ...history.values, timestamp: new Date() }, { merge: true });
        if (auditEntry) batch.set(db.collection("audit_logs").doc(), { ...auditEntry, client: user.uid });
        await batch.commit();
      } catch (err) {
        await auth.deleteUser(user.uid).catch(() => {}); // never leave a sign-in account without a profile
        throw err;
      }
      return user.uid;
    },
    /** Map customerId -> number of shipments linked to it (one indexed query; ids only). */
    async countShipmentsByCustomer() {
      const snap = await shipments.where("customerId", ">", "").select("customerId").get();
      const counts = new Map();
      snap.forEach((d) => { const id = d.get("customerId"); if (id) counts.set(id, (counts.get(id) || 0) + 1); });
      return counts;
    },
    // admin registrations (customer + shipment): one per submission id, so a repeated click or a retry never saves twice
    async claimRegistration(id, at) {
      const ref = db.collection("registrations").doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? snap.data() : null;
        if (cur?.state === "done") return { state: "done", result: cur.result };
        if (cur?.state === "pending" && Date.parse(at) - Date.parse(cur.at) < 120000) return { state: "pending" };
        tx.set(ref, { state: "pending", at });
        return { state: "new" };
      });
    },
    async completeRegistration(id, result) { await db.collection("registrations").doc(id).set({ state: "done", result, at: new Date().toISOString() }); },
    async releaseRegistration(id) { await db.collection("registrations").doc(id).delete(); },
    async updateClientRecord(uid, patch, { password, history, auditEntry, disabled, email, previousEmail } = {}) {
      const ref = db.collection("clients").doc(uid);
      if (!(await ref.get()).exists) throw Object.assign(new Error("missing"), { code: "client_missing" });
      const auth = getAuth(app);
      if (password || disabled !== undefined || email) {
        // a new sign-in email is checked by Firebase (unique, valid) before the profile changes
        await auth.updateUser(uid, { ...(password ? { password } : {}), ...(disabled !== undefined ? { disabled } : {}), ...(email ? { email } : {}) })
          .catch((err) => { if (err?.code !== "auth/user-not-found") throw err; });
      }
      const batch = db.batch();
      const { admin_notes: notes, ...pub } = patch; // admin notes go to the admin-only client_private/{uid}
      batch.set(ref, { ...pub, updated_at: new Date() }, { merge: true });
      if (notes !== undefined) batch.set(db.collection("client_private").doc(uid), { admin_notes: notes }, { merge: true });
      if (history) batch.set(db.collection("portfolio_history").doc(uid).collection("history").doc(history.dateKey), { ...history.values, timestamp: new Date() }, { merge: true });
      if (auditEntry) batch.set(db.collection("audit_logs").doc(), auditEntry);
      try { await batch.commit(); }
      catch (err) {
        // the profile did not change: put sign-in back the way it was, so status, email and sign-in never disagree
        if (disabled !== undefined || (email && previousEmail)) {
          await auth.updateUser(uid, { ...(disabled !== undefined ? { disabled: !disabled } : {}), ...(email && previousEmail ? { email: previousEmail } : {}) }).catch(() => {});
        }
        throw err;
      }
    },
    /**
     * Permanent deletion of ONE client, keyed by its document ID. Order keeps the system consistent:
     *   1. disable the sign-in account (reversible) so the client cannot act mid-delete,
     *   2. in ONE atomic batch: write a recovery copy to deleted_clients/{uid} (admin-only, no password data),
     *      delete clients/{uid} + portfolio_history/{uid}/history/*, and write the audit entry,
     *   3. delete the sign-in account.
     * If step 2 fails, step 1 is undone and nothing was removed. If the sign-in account cannot be disabled or
     * removed (e.g. missing Firebase Auth permission), the data is still removed and the caller is told exactly why.
     */
    async deleteClientPermanently(uid, { onAuditEntry } = {}) {
      const auth = getAuth(app);
      const ref = db.collection("clients").doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw Object.assign(new Error("missing"), { code: "client_missing" });
      const authText = (err) => [err?.code, String(err?.message || "").split("\n")[0].slice(0, 120)].filter(Boolean).join(": ");
      let authError = null;
      const user = await auth.getUser(uid).catch((err) => { if (err?.code !== "auth/user-not-found") authError = authText(err); return null; });
      if (user?.customClaims?.admin === true) throw Object.assign(new Error("admin"), { code: "client_is_admin" });
      let disabledNow = false;
      if (user && !user.disabled) {
        try { await auth.updateUser(uid, { disabled: true }); disabledNow = true; } catch (err) { authError = authText(err); }
      }
      const parent = db.collection("portfolio_history").doc(uid);
      const historySnap = await parent.collection("history").get();
      const removed = { profile: 1, history: historySnap.size };
      try {
        if (historySnap.size > 450) throw Object.assign(new Error("too many history records for one atomic delete"), { code: "client_history_too_large" });
        const entry = onAuditEntry ? onAuditEntry({ removed, result: "SUCCESS" }) : null;
        const { password_hash, ...profile } = snap.data();
        const batch = db.batch();
        batch.set(db.collection("deleted_clients").doc(uid), {
          id: uid, profile, history: Object.fromEntries(historySnap.docs.map((d) => [d.id, d.data()])),
          deleted_at: entry?.at || new Date().toISOString(), deleted_by: entry?.actor || null
        });
        historySnap.docs.forEach((d) => batch.delete(d.ref));
        batch.delete(parent);
        batch.delete(ref);
        batch.delete(db.collection("client_private").doc(uid));
        if (entry) batch.set(db.collection("audit_logs").doc(), entry);
        await batch.commit();
      } catch (err) {
        if (disabledNow) await auth.updateUser(uid, { disabled: false }).catch(() => {});
        throw err;
      }
      let authDeleted = !user && !authError;
      if (user) { try { await auth.deleteUser(uid); authDeleted = true; } catch (err) { if (err?.code === "auth/user-not-found") authDeleted = true; else authError = authText(err); } }
      return { removed, authDeleted, authDisabled: !!user?.disabled || disabledNow, authError: authDeleted ? null : authError, authExisted: !!user };
    },

    async verifyIdToken(token) { return getAuth(app).verifyIdToken(token); },

    // ---------- customer accounts: their shipments and in-app notifications (server-only) ----------
    /** Verifies a customer's Firebase ID token, rejecting revoked tokens and disabled accounts. */
    async verifyCustomerToken(token) { return getAuth(app).verifyIdToken(token, true); },
    async listCustomerShipments(uid, limit = 50) {
      const q = await shipments.where("customerId", "==", uid).limit(limit).get();
      return q.docs.map(stripId).filter((s) => s.archived !== true);
    },
    async listCustomerNotifications(uid, limit = 50) {
      const col = db.collection("clients").doc(uid).collection("notifications");
      const [items, unread] = await Promise.all([
        col.orderBy("createdAt", "desc").limit(limit).get(),
        col.where("readAt", "==", null).count().get()
      ]);
      return { items: items.docs.map(stripId), unread: unread.data().count };
    },
    /** Marks one of THIS customer's notifications read. The path is built from the verified uid, so another customer's id is simply not found. */
    async markCustomerNotificationRead(uid, id, at) {
      const ref = db.collection("clients").doc(uid).collection("notifications").doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { found: false };
        if (!snap.data().readAt) tx.update(ref, { readAt: at });
        return { found: true };
      });
    },
    async markAllCustomerNotificationsRead(uid, at) {
      const col = db.collection("clients").doc(uid).collection("notifications");
      let changed = 0;
      for (;;) { // in pages of 400 (a write batch holds at most 500 writes)
        const snap = await col.where("readAt", "==", null).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch(); snap.docs.forEach((d) => batch.update(d.ref, { readAt: at }));
        await batch.commit(); changed += snap.size;
        if (snap.size < 400) break;
      }
      return { changed };
    }
  };
}
