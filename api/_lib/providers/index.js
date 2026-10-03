// Tracking-provider architecture.
//
//   COURIER / GPS PROVIDER -> (webhook or poller) -> provider adapter.normalize() -> service.updateShipment()
//                          -> DATABASE -> realtime layer -> CLIENT DASHBOARD
//
// A provider adapter implements:
//   id                     unique id used in /api/provider?provider=<id> and PROVIDER_<ID>_SECRET
//   source                 'carrier_api' | 'gps'  (stored on events/locations; manual entry can never claim these)
//   verify(rawBody, req)   -> boolean, authenticates the delivery
//   normalize(json)        -> [{ trackingCode, statusCode?, location?, latitude?, longitude?, timestamp?, description?,
//                                etaDate?, etaWindowStart?, etaWindowEnd? }]
// To add FedEx/DHL/etc.: create lib/providers/<name>.js exporting an adapter and register it here. Nothing
// in the client dashboard or the service layer needs to change.
import { genericProvider } from "./generic.js";

const registry = new Map([[genericProvider.id, genericProvider]]);

export function registerProvider(adapter) { registry.set(adapter.id, adapter); }
export function getProvider(id) { return registry.get(String(id || "").toLowerCase()) || null; }
export function listProviders() {
  return [...registry.values()].map((p) => ({ id: p.id, source: p.source, configured: !!process.env[`PROVIDER_${p.id.toUpperCase()}_SECRET`] }));
}
