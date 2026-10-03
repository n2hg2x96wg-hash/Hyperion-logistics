// Generic JSON webhook provider. Body: { "updates": [ { trackingCode, statusCode?, location?, latitude?, longitude?,
// timestamp?, description?, etaDate? } ] }  Header: X-Hyperion-Signature = hex HMAC-SHA256(rawBody, PROVIDER_GENERIC_SECRET)
import crypto from "node:crypto";

export const genericProvider = {
  id: "generic",
  source: "carrier_api",
  verify(rawBody, req) {
    const secret = process.env.PROVIDER_GENERIC_SECRET;
    const given = String(req.headers["x-hyperion-signature"] || "");
    if (!secret || !given) return false;
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(given); const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  normalize(json) {
    const list = Array.isArray(json?.updates) ? json.updates : [];
    return list.slice(0, 100).map((u) => ({
      trackingCode: u.trackingCode, statusCode: u.statusCode, location: u.location, latitude: u.latitude, longitude: u.longitude,
      timestamp: u.timestamp, description: u.description, etaDate: u.etaDate, etaWindowStart: u.etaWindowStart, etaWindowEnd: u.etaWindowEnd
    }));
  }
};
