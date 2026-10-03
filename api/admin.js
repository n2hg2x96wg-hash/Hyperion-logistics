// ADMIN API (single function): POST /api/admin  { action, ...params }
// Every action except `login` requires a verified admin identity AND the right permission for the role.
// All mutations flow through lib/service.js (validation, status engine, events, audit log).
import { readJson, send, clientIp, rateLimit, resetRateLimit } from "./_lib/http.js";
import {
  authenticateAdmin, checkPassword, issueSession, sessionCookie, originAllowed, adminConfigured, SESSION_TTL_MS
} from "./_lib/auth.js";
import { can, STATUS_META, EXCEPTION_TYPES, ROLES } from "../shared/status.js";
import { ValidationError } from "./_lib/validate.js";
import * as svc from "./_lib/service.js";
import { getStore } from "./_lib/store/index.js";
import { notificationsConfigured } from "./_lib/notifications.js";
import { listProviders } from "./_lib/providers/index.js";
import { resolveMapConfig } from "./_lib/map-config.js";
import * as couriers from "./_lib/couriers.js";

const PERMISSION = {
  me: "read", logout: "read", stats: "read", list: "read", get: "read", preview: "read", audit: "read", settings: "read",
  create: "write", update: "write", updateLocation: "location", addEvent: "event", setVisibility: "visibility",
  archive: "archive", unarchive: "archive", delete: "delete", migrate: "migrate",
  listCouriers: "read", saveCourier: "couriers", setCourierState: "couriers"
};

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!originAllowed(req)) return send(res, 403, { error: "forbidden" });
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: "bad_request" }); }
  const action = String(body.action || "");

  try {
    if (action === "login") {
      const ip = clientIp(req);
      const rl = rateLimit(`login:${ip}`, { limit: 8, windowMs: 15 * 60_000 });
      if (!rl.ok) return send(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." }, { "Retry-After": String(rl.retryAfter) });
      if (!adminConfigured()) return send(res, 503, { error: "not_configured", message: "Admin access is not configured on the server." });
      if (!checkPassword(body.password)) {
        await new Promise((r) => setTimeout(r, 400));
        return send(res, 401, { error: "invalid_credentials", message: "Access denied." });
      }
      resetRateLimit(`login:${ip}`);
      const token = issueSession({ sub: "admin", role: "admin" });
      return send(res, 200, { ok: true, role: "admin", expiresInMs: SESSION_TTL_MS }, { "Set-Cookie": sessionCookie(token, { secure }) });
    }

    const identity = await authenticateAdmin(req);
    if (!identity) return send(res, 401, { error: "unauthenticated", message: "Session expired. Please sign in again." });
    const needed = PERMISSION[action];
    if (!needed) return send(res, 400, { error: "unknown_action" });
    if (!can(identity.role, needed)) return send(res, 403, { error: "forbidden", message: "You do not have permission for this action." });

    switch (action) {
      case "me": {
        // sliding session: active admins get a fresh cookie when less than half the lifetime remains
        const renew = identity.via === "session" && identity.exp - Date.now() < SESSION_TTL_MS / 2
          ? { "Set-Cookie": sessionCookie(issueSession({ sub: identity.sub, role: identity.role }), { secure }) } : {};
        return send(res, 200, { sub: identity.sub, role: identity.role, permissions: ROLES[identity.role] }, renew);
      }
      case "logout": return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", { clear: true, secure }) });
      case "stats": return send(res, 200, await svc.dashboardStats());
      case "list": return send(res, 200, await svc.listShipments(body));
      case "get": return send(res, 200, await svc.getAdminShipment(body.code));
      case "preview": {
        const view = await svc.getClientView(body.code, { preview: true });
        if (!view) return send(res, 404, { error: "not_found", message: "Shipment not found." });
        return send(res, 200, { shipment: view });
      }
      case "audit": return send(res, 200, { items: await svc.recentAudit({ limit: Number(body.limit) || 100, code: body.code }) });
      case "settings": return send(res, 200, await settings());
      case "create": return send(res, 200, { shipment: await svc.createShipment(identity, body.shipment || {}) });
      case "update": {
        const patch = { ...(body.changes || {}) };
        if (patch.visibility && !can(identity.role, "visibility")) delete patch.visibility;
        return send(res, 200, await svc.updateShipment(identity, body.code, patch));
      }
      case "updateLocation": return send(res, 200, await svc.updateLocation(identity, body.code, body));
      case "addEvent": return send(res, 200, await svc.addTrackingEvent(identity, body.code, body));
      case "setVisibility": return send(res, 200, await svc.updateShipment(identity, body.code, { visibility: body.visibility }));
      case "archive": return send(res, 200, { changed: await svc.setArchived(identity, body.code, true) });
      case "unarchive": return send(res, 200, { changed: await svc.setArchived(identity, body.code, false) });
      case "delete": await svc.deleteShipment(identity, body.code); return send(res, 200, { ok: true });
      case "migrate": return send(res, 200, await svc.runBackfill(identity, { cursor: body.cursor || null }));
      case "listCouriers": return send(res, 200, { couriers: await couriers.listCouriers() });
      case "saveCourier": return send(res, 200, await couriers.saveCourier(identity, body));
      case "setCourierState": return send(res, 200, await couriers.setCourierState(identity, body));
      default: return send(res, 400, { error: "unknown_action" });
    }
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: "validation", message: err.message, field: err.field });
    if (err instanceof svc.ServiceError) return send(res, err.status, { error: err.code, message: err.message });
    console.error("[admin] failure", action, err?.message);
    // Database errors are reported by kind (never with internals) so the admin sees what actually failed.
    const dbCode = String(err?.code ?? "");
    if (dbCode === "7" || /PERMISSION_DENIED/i.test(dbCode)) return send(res, 500, { error: "db_permission", message: "The database refused the write. Check that FIREBASE_SERVICE_ACCOUNT in Vercel belongs to the hyperion-logistics Firebase project." });
    if (["4", "14", "DEADLINE_EXCEEDED", "UNAVAILABLE"].includes(dbCode)) return send(res, 503, { error: "db_unavailable", message: "The database did not respond. Please try again in a moment." });
    return send(res, 500, { error: "internal", message: "The request could not be completed." });
  }
}

async function settings() {
  const store = await getStore();
  return {
    store: store.kind,
    session: { ttlMinutes: SESSION_TTL_MS / 60000 },
    map: (() => { const m = resolveMapConfig(); return { provider: `${m.label} (Leaflet)`, fallbacks: m.tiles.slice(1).map((t) => t.label), customTilesConfigured: m.primary !== "osm", keyConfigured: m.keyConfigured, issues: m.issues }; })(),
    realtime: { sse: process.env.REALTIME_SSE !== "off", fallback: "adaptive polling", pollMs: Number(process.env.CLIENT_POLL_MS) || 20000 },
    notifications: { configured: notificationsConfigured(), providers: process.env.NOTIFY_WEBHOOK_URL ? ["webhook"] : [] },
    providers: listProviders(),
    geocoding: process.env.GEOCODER === "off" ? "off" : "OpenStreetMap Nominatim (server side)",
    statuses: Object.entries(STATUS_META).map(([code, m]) => ({ code, label: m.label })),
    exceptionTypes: Object.entries(EXCEPTION_TYPES).map(([code, label]) => ({ code, label }))
  };
}
