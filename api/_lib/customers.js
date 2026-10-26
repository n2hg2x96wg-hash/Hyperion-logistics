// Customer accounts on the public site: their own shipments and in-app notifications.
//
// Identity: a customer signs in with their existing client account (Firebase Authentication, the same accounts the
// admin Clients tab manages) and sends the Firebase ID token. The server verifies the token (revoked tokens and disabled
// accounts are refused), then requires an active client profile. Every read and write below is keyed by that verified
// uid, never by an id taken from the request, so a customer cannot reach another customer's notifications or shipments:
//   - notifications live under clients/{uid}/notifications, a path built from the verified uid;
//   - a shipment is shown only when its customerId equals the verified uid (otherwise "not found", so codes cannot be probed).
import { getStore } from "./store/index.js";
import { buildViewFor, ServiceError } from "./service.js";
import { normalizeTrackingCode } from "./validate.js";
import { STATUS_META, statusLabel, statusTone, resolveShipmentStatus } from "../../shared/status.js";

const NOTIFICATION_ID = /^nt_[0-9a-f]{24}$/;

/** { uid, name, email } for a valid token of an active customer account; throws ServiceError otherwise. */
export async function authenticateCustomer(req) {
  const authz = req.headers.authorization || "";
  if (!authz.startsWith("Bearer ") || authz.length > 4096) throw new ServiceError("unauthenticated", "Please sign in.", 401);
  const store = await getStore();
  let claims = null;
  try { claims = store.verifyCustomerToken ? await store.verifyCustomerToken(authz.slice(7)) : null; } catch { claims = null; }
  if (!claims?.uid) throw new ServiceError("unauthenticated", "Your session has ended. Please sign in again.", 401);
  const rec = await store.getClientRecord(claims.uid);
  if (!rec || rec.status !== "active" || rec.auth?.disabled) throw new ServiceError("inactive", "This account is not active. Please contact support.", 403);
  return { uid: claims.uid, name: rec.name || "", email: rec.email || claims.email || "" };
}

/** What the customer may see about a notification: no internal ids, no staff names, no notes. */
const notificationView = (n) => ({
  id: n.id, type: n.type || "shipment.status", statusCode: STATUS_META[n.statusCode] ? n.statusCode : null,
  title: String(n.title || ""), shipment: n.shipmentId || null, tone: STATUS_META[n.statusCode] ? statusTone(n.statusCode) : "neutral",
  createdAt: n.createdAt || null, read: !!n.readAt
});

export async function listNotifications(customer, { limit = 50 } = {}) {
  const store = await getStore();
  const { items, unread } = await store.listCustomerNotifications(customer.uid, Math.min(Math.max(Number(limit) || 50, 1), 100));
  return { items: items.map(notificationView), unread };
}

export async function markNotificationRead(customer, id) {
  if (typeof id !== "string" || !NOTIFICATION_ID.test(id)) throw new ServiceError("not_found", "Notification not found.", 404);
  const store = await getStore();
  const r = await store.markCustomerNotificationRead(customer.uid, id, new Date().toISOString());
  if (!r.found) throw new ServiceError("not_found", "Notification not found.", 404);
  return listNotifications(customer);
}

export async function markAllNotificationsRead(customer) {
  const store = await getStore();
  await store.markAllCustomerNotificationsRead(customer.uid, new Date().toISOString());
  return listNotifications(customer);
}

const shipmentRow = (s) => {
  const code = resolveShipmentStatus(s);
  return { code: s.id, status: { code, label: statusLabel(code), tone: statusTone(code) }, origin: s.origin || null, destination: s.destination || null };
};

/** The customer's shipments: code, status and route only (details come from the visibility-filtered client view). */
export async function listShipments(customer) {
  const store = await getStore();
  const rows = await store.listCustomerShipments(customer.uid, 50);
  return rows.map(shipmentRow).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Admin, read-only: one client's linked shipments and the notifications they received (with when each was read), for
 * the client profile in the console. The uid comes from a client record the caller has already looked up.
 */
export async function clientActivity(uid) {
  const store = await getStore();
  const [rows, notes] = await Promise.all([store.listCustomerShipments(uid, 50), store.listCustomerNotifications(uid, 50)]);
  return {
    shipments: rows.map(shipmentRow).sort((a, b) => a.code.localeCompare(b.code)),
    notifications: notes.items.map((n) => ({ ...notificationView(n), readAt: n.readAt || null })),
    unread: notes.unread
  };
}

/** The same client view as the public tracking page, but only for a shipment linked to this customer. */
export async function getShipment(customer, codeInput) {
  const code = normalizeTrackingCode(String(codeInput ?? ""));
  const store = await getStore();
  const s = code ? await store.getShipment(code) : null;
  if (!s || s.customerId !== customer.uid || s.archived === true) throw new ServiceError("not_found", "Shipment not found.", 404);
  return buildViewFor(store, s);
}
