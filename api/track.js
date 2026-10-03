// PUBLIC tracking lookup: GET /api/track?code=XXXX[&v=<version>]
// Returns only the whitelisted, visibility-filtered client view (see lib/client-view.js).
import { send, clientIp, rateLimit } from "./_lib/http.js";
import { normalizeTrackingCode } from "./_lib/validate.js";
import { getStore } from "./_lib/store/index.js";
import { buildViewFor } from "./_lib/service.js";
import { shipmentVersion } from "./_lib/client-view.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
  const url = new URL(req.url, "http://localhost");
  const rl = rateLimit(`track:${clientIp(req)}`, { limit: 90, windowMs: 60_000 });
  if (!rl.ok) return send(res, 429, { error: "rate_limited", message: "Too many requests. Please wait a moment and try again." }, { "Retry-After": String(rl.retryAfter) });

  const raw = url.searchParams.get("code") || "";
  const code = normalizeTrackingCode(raw);
  if (!code) return send(res, 400, { error: "invalid_code", message: "Please enter a valid tracking number." });

  try {
    const store = await getStore();
    let shipment = await store.getShipment(code);
    if (!shipment && raw.trim() !== code) shipment = await store.getShipment(raw.trim()); // legacy mixed-case ids
    if (!shipment || shipment.archived === true) return send(res, 404, { error: "not_found", message: "Tracking number not found." });

    const known = url.searchParams.get("v");
    if (known && known === shipmentVersion(shipment)) return send(res, 200, { unchanged: true, version: known, serverTime: new Date().toISOString() });

    return send(res, 200, { shipment: await buildViewFor(store, shipment) });
  } catch (err) {
    console.error("[track] failure", err?.message);
    return send(res, 503, { error: "unavailable", message: "Tracking is temporarily unavailable. Please try again shortly." });
  }
}
