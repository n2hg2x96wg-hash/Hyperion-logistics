// CUSTOMER API: POST /api/customer { action, ... } with "Authorization: Bearer <Firebase ID token>".
// Every action except `mode` requires a verified, active customer account; all data is scoped to that account
// on the server (see api/_lib/customers.js). Nothing here can change shipments: customers only read their own
// shipments and mark their own notifications as read.
import { readJson, send, clientIp, rateLimit } from "./_lib/http.js";
import { originAllowed } from "./_lib/auth.js";
import { ServiceError } from "./_lib/service.js";
import { getStore } from "./_lib/store/index.js";
import * as customers from "./_lib/customers.js";

// Local development and automated tests run on the in-memory store, which has no Firebase Authentication. There (and
// only there) the page signs in with the in-memory client accounts. Never available in production or on Firestore.
const devSignIn = () => process.env.STORE === "memory" && process.env.NODE_ENV !== "production";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!originAllowed(req)) return send(res, 403, { error: "forbidden" });
  const rl = rateLimit(`customer:${clientIp(req)}`, { limit: 240, windowMs: 60_000 });
  if (!rl.ok) return send(res, 429, { error: "rate_limited", message: "Too many requests. Please wait a moment." }, { "Retry-After": String(rl.retryAfter) });

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: "bad_request" }); }
  const action = String(body.action || "");

  try {
    if (action === "mode") return send(res, 200, { signIn: devSignIn() ? "dev" : "firebase" });
    if (action === "devLogin") {
      if (!devSignIn()) return send(res, 404, { error: "not_found" });
      const lim = rateLimit(`customer-login:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60_000 });
      if (!lim.ok) return send(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
      const store = await getStore();
      const r = store.__issueCustomerToken(String(body.email || "").trim().toLowerCase(), String(body.password || ""));
      if (r.error) return send(res, 401, { error: "invalid_credentials", message: "Incorrect email or password." });
      return send(res, 200, { token: r.token });
    }

    const customer = await customers.authenticateCustomer(req);
    switch (action) {
      case "me": return send(res, 200, { name: customer.name, email: customer.email });
      case "notifications": return send(res, 200, await customers.listNotifications(customer, { limit: body.limit }));
      case "markRead": return send(res, 200, await customers.markNotificationRead(customer, body.id));
      case "markAllRead": return send(res, 200, await customers.markAllNotificationsRead(customer));
      case "shipments": return send(res, 200, { shipments: await customers.listShipments(customer) });
      case "shipment": return send(res, 200, { shipment: await customers.getShipment(customer, body.code) });
      default: return send(res, 400, { error: "unknown_action" });
    }
  } catch (err) {
    if (err instanceof ServiceError) return send(res, err.status, { error: err.code, message: err.message });
    console.error("[customer] failure", action, err?.message);
    return send(res, 500, { error: "internal", message: "The request could not be completed. Please try again." });
  }
}
