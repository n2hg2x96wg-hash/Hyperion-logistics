// Built-in carrier catalog. Isomorphic: used by the admin UI (courier picker) and by the server (client view).
//
// Adding a carrier = adding one entry here (or a document in the Firestore `couriers` collection, which
// overrides the built-in entry with the same id). Nothing else in the tracking system needs to change.
//
// Fields
//   id           stable lowercase id stored on shipments (`shipment.courier`)
//   name         display name
//   prefix       tracking-code prefix used when an admin auto-generates a code
//   type         "carrier" = public carrier/postal service, "custom" = internal/custom arrangement
//   category     "express" (express & parcel / postal), "ocean" (ocean freight), "regional", "custom"
//   description  short factual description of the service (no performance or partnership claims)
//   coverage     plain-language service area as published by the carrier (no invented country counts)
//   logo         emoji (admin picker only) or an https:// image URL of an APPROVED logo; public pages show a
//                wordmark tile unless an https logo is configured
//   website      official public website (no fabricated support numbers or API endpoints)
//   integration  null until a real carrier API is connected (see api/_lib/providers). Never faked.
//
// "Tesla Transport" is deliberately type "custom": it is an internal/custom carrier option, NOT an official
// Tesla logistics service. It has no website or integration and is labelled as custom to clients.

export const CARRIER_TYPES = Object.freeze({ carrier: "Carrier", custom: "Custom / internal" });

export const CARRIER_CATEGORIES = Object.freeze({
  express: "Express & Parcel",
  ocean: "Ocean Freight",
  regional: "Regional Logistics",
  custom: "Custom Transport"
});

export const CARRIERS = Object.freeze([
  { id: "2goexpress", name: "2GoExpress", prefix: "2GO", logo: "🚢", brandColor: "#0ea5e9", type: "carrier", category: "regional", website: "https://www.2go.com.ph", phone: "+63-2-877-99-222",
    description: "Philippine logistics group offering parcel and freight services.", coverage: "Philippines" },
  { id: "fedex", name: "FedEx", prefix: "FEDEX", logo: "✈️", brandColor: "#4d148c", type: "carrier", category: "express", website: "https://www.fedex.com", phone: "+1-800-463-3339",
    description: "International express, ground parcel and freight services.", coverage: "International" },
  { id: "dhl", name: "DHL", prefix: "DHL", logo: "🚚", brandColor: "#ffcc00", type: "carrier", category: "express", website: "https://www.dhl.com", phone: "+1-800-225-5345",
    description: "International express parcel and document delivery.", coverage: "International" },
  { id: "ups", name: "UPS", prefix: "UPS", logo: "📦", brandColor: "#7a4a1e", type: "carrier", category: "express", website: "https://www.ups.com", phone: "+1-800-742-5877",
    description: "Domestic and international parcel delivery and freight.", coverage: "International" },
  { id: "usps", name: "USPS", prefix: "USPS", logo: "🇺🇸", brandColor: "#1d4ed8", type: "carrier", category: "express", website: "https://www.usps.com",
    description: "United States Postal Service mail and parcel delivery.", coverage: "United States (international via postal partners)" },
  { id: "royalmail", name: "Royal Mail", prefix: "RM", logo: "🇬🇧", brandColor: "#da291c", type: "carrier", category: "express", website: "https://www.royalmail.com",
    description: "UK postal service for letters and parcels.", coverage: "United Kingdom (international via postal partners)" },
  { id: "aramex", name: "Aramex", prefix: "ARX", logo: "🟥", brandColor: "#e1251b", type: "carrier", category: "express", website: "https://www.aramex.com",
    description: "Express parcel, freight and e-commerce logistics.", coverage: "International, strongest in the Middle East, Africa and Asia" },
  { id: "sfexpress", name: "SF Express", prefix: "SF", logo: "🐦", brandColor: "#111827", type: "carrier", category: "express", website: "https://www.sf-express.com",
    description: "Express parcel delivery from China and Asia.", coverage: "China and international" },
  { id: "canadapost", name: "Canada Post", prefix: "CP", logo: "🇨🇦", brandColor: "#ef4444", type: "carrier", category: "express", website: "https://www.canadapost-postescanada.ca",
    description: "Canadian postal service for mail and parcels.", coverage: "Canada (international via postal partners)" },
  { id: "auspost", name: "Australia Post", prefix: "AP", logo: "🇦🇺", brandColor: "#dc2626", type: "carrier", category: "express", website: "https://auspost.com.au",
    description: "Australian postal service for mail and parcels.", coverage: "Australia (international via postal partners)" },
  { id: "japanpost", name: "Japan Post", prefix: "JP", logo: "🇯🇵", brandColor: "#b91c1c", type: "carrier", category: "express", website: "https://www.post.japanpost.jp",
    description: "Japanese postal service for mail and parcels.", coverage: "Japan (international via postal partners)" },
  { id: "correios", name: "Correios", prefix: "COR", logo: "🇧🇷", brandColor: "#0057a8", type: "carrier", category: "express", website: "https://www.correios.com.br",
    description: "Brazilian postal service for mail and parcels.", coverage: "Brazil (international via postal partners)" },
  { id: "ems", name: "EMS (Express Mail Service)", prefix: "EMS", logo: "📮", brandColor: "#0369a1", type: "carrier", category: "express", website: "https://www.ems.post",
    description: "International express mail run by national postal operators.", coverage: "International postal network" },
  { id: "maersk", name: "Maersk", prefix: "MSK", logo: "🚢", brandColor: "#42b0d5", type: "carrier", category: "ocean", website: "https://www.maersk.com",
    description: "Container shipping and integrated ocean logistics.", coverage: "Global ocean routes" },
  { id: "msc", name: "MSC", prefix: "MSC", logo: "🚢", brandColor: "#c9a227", type: "carrier", category: "ocean", website: "https://www.msc.com",
    description: "Mediterranean Shipping Company container shipping.", coverage: "Global ocean routes" },
  { id: "cmacgm", name: "CMA CGM", prefix: "CMA", logo: "🚢", brandColor: "#0b2a6f", type: "carrier", category: "ocean", website: "https://www.cma-cgm.com",
    description: "Container shipping and ocean logistics.", coverage: "Global ocean routes" },
  { id: "giglogistics", name: "GIG Logistics", prefix: "GIG", logo: "📦", brandColor: "#e6007e", type: "carrier", category: "regional", website: "https://giglogistics.com",
    description: "Parcel delivery and logistics services.", coverage: "Nigeria and selected international lanes" },
  { id: "redstarexpress", name: "Red Star Express", prefix: "RSE", logo: "📦", brandColor: "#d71920", type: "carrier", category: "regional", website: "https://www.redstarplc.com",
    description: "Courier, freight and logistics services.", coverage: "Nigeria" },
  { id: "tesla-transport", name: "Tesla Transport", prefix: "TSL", logo: "⚡", brandColor: "#64748b", type: "custom", category: "custom",
    description: "Hyperion-arranged custom transport option.", coverage: "Arranged per shipment",
    note: "Internal/custom carrier option. Not an official Tesla logistics service." }
].map((c) => Object.freeze({ email: "", apiEndpoint: "", phone: "", website: "", trackingUrl: "", region: "", note: "", description: "", coverage: "", integration: null, ...c })));

/** Category for any (built-in or stored) carrier record. */
export function carrierCategory(c) {
  if (c?.category && CARRIER_CATEGORIES[c.category]) return c.category;
  return c?.type === "custom" ? "custom" : "express";
}

/** https image URL from the logo field, or null (emoji logos are only used in the admin picker). */
export function carrierLogoUrl(c) {
  return typeof c?.logo === "string" && /^https:\/\/[^\s]+$/i.test(c.logo) ? c.logo : null;
}

/**
 * Honest integration status:
 *   live    – a provider adapter with this carrier's id is configured AND has delivered a signed update
 *   link    – an official tracking URL template is configured
 *   manual  – updates are entered by Hyperion operations
 */
export function carrierIntegration(c, { configuredProviders = [] } = {}) {
  if (configuredProviders.includes(c?.id) && c?.lastProviderUpdateAt) return { status: "live", label: "Live API connected" };
  if (c?.trackingUrl) return { status: "link", label: "Official tracking link" };
  return { status: "manual", label: "Manual updates by Hyperion" };
}

const BY_ID = new Map(CARRIERS.map((c) => [c.id, c]));

export function carrierId(input) {
  return String(input ?? "").trim().toLowerCase();
}

/** Built-in entry for an id, or null. */
export function builtInCarrier(id) {
  return BY_ID.get(carrierId(id)) || null;
}

/**
 * Merge stored courier records (e.g. Firestore `couriers`) over the built-in catalog.
 * Stored records win field-by-field for their id; built-ins missing from storage are still offered.
 * Nothing is written anywhere; this is a read-time merge.
 */
export function mergeCarriers(stored = []) {
  const out = new Map(CARRIERS.map((c) => [c.id, { ...c, stored: false, builtIn: true }]));
  for (const rec of stored) {
    const id = carrierId(rec?.id);
    if (!id) continue;
    const base = out.get(id) || { id, type: "carrier", integration: null };
    const clean = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "--"));
    out.set(id, { ...base, ...clean, id, type: clean.type === "custom" ? "custom" : base.type || "carrier", stored: true, builtIn: BY_ID.has(id) });
  }
  return [...out.values()];
}
