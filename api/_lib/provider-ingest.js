// Applies normalized provider updates through the same service path as admin edits.
import { updateShipment, ServiceError } from "./service.js";
import { ValidationError } from "./validate.js";

export async function ingestProviderUpdates(adapter, updates) {
  const results = [];
  for (const u of updates) {
    try {
      const patch = {};
      if (u.statusCode) patch.statusCode = u.statusCode;
      if (u.location != null) patch.location = u.location;
      if (u.latitude != null && u.longitude != null) { patch.latitude = u.latitude; patch.longitude = u.longitude; }
      if (u.etaDate != null) patch.etaDate = u.etaDate;
      if (u.etaWindowStart != null) { patch.etaWindowStart = u.etaWindowStart; patch.etaWindowEnd = u.etaWindowEnd; }
      if (u.description) patch.statusNote = u.description;
      const identity = { sub: `provider:${adapter.id}`, role: "operator", via: "provider" };
      const out = await updateShipment(identity, u.trackingCode, patch, {
        source: adapter.source, etaSource: adapter.source, occurredAt: u.timestamp ? new Date(u.timestamp).toISOString() : undefined
      });
      results.push({ trackingCode: String(u.trackingCode), ok: true, unchanged: !!out.unchanged });
    } catch (err) {
      const known = err instanceof ServiceError || err instanceof ValidationError || err instanceof RangeError;
      results.push({ trackingCode: String(u?.trackingCode), ok: false, error: known ? err.message : "internal_error" });
    }
  }
  return results;
}
