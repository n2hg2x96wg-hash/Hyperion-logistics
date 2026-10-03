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
//   website      official public website (no fabricated support numbers or API endpoints)
//   integration  null until a real carrier API is connected (see api/_lib/providers). Never faked.
//
// "Tesla Transport" is deliberately type "custom": it is an internal/custom carrier option, NOT an official
// Tesla logistics service. It has no website or integration and is labelled as custom to clients.

export const CARRIER_TYPES = Object.freeze({ carrier: "Carrier", custom: "Custom / internal" });

export const CARRIERS = Object.freeze([
  { id: "2goexpress", name: "2GoExpress", prefix: "2GO", logo: "🚢", brandColor: "#0ea5e9", type: "carrier", website: "https://www.2go.com.ph", phone: "+63-2-877-99-222" },
  { id: "fedex", name: "FedEx", prefix: "FEDEX", logo: "✈️", brandColor: "#7c3aed", type: "carrier", website: "https://www.fedex.com", phone: "+1-800-463-3339" },
  { id: "dhl", name: "DHL", prefix: "DHL", logo: "🚚", brandColor: "#eab308", type: "carrier", website: "https://www.dhl.com", phone: "+1-800-225-5345" },
  { id: "ups", name: "UPS", prefix: "UPS", logo: "📦", brandColor: "#92400e", type: "carrier", website: "https://www.ups.com", phone: "+1-800-742-5877" },
  { id: "usps", name: "USPS", prefix: "USPS", logo: "🇺🇸", brandColor: "#1d4ed8", type: "carrier", website: "https://www.usps.com" },
  { id: "royalmail", name: "Royal Mail", prefix: "RM", logo: "🇬🇧", brandColor: "#dc2626", type: "carrier", website: "https://www.royalmail.com" },
  { id: "aramex", name: "Aramex", prefix: "ARX", logo: "🟥", brandColor: "#e11d48", type: "carrier", website: "https://www.aramex.com" },
  { id: "sfexpress", name: "SF Express", prefix: "SF", logo: "🐦", brandColor: "#111827", type: "carrier", website: "https://www.sf-express.com" },
  { id: "canadapost", name: "Canada Post", prefix: "CP", logo: "🇨🇦", brandColor: "#ef4444", type: "carrier", website: "https://www.canadapost-postescanada.ca" },
  { id: "auspost", name: "Australia Post", prefix: "AP", logo: "🇦🇺", brandColor: "#dc2626", type: "carrier", website: "https://auspost.com.au" },
  { id: "japanpost", name: "Japan Post", prefix: "JP", logo: "🇯🇵", brandColor: "#b91c1c", type: "carrier", website: "https://www.post.japanpost.jp" },
  { id: "ems", name: "EMS (Express Mail Service)", prefix: "EMS", logo: "📮", brandColor: "#0369a1", type: "carrier", website: "https://www.ems.post" },
  { id: "tesla-transport", name: "Tesla Transport", prefix: "TSL", logo: "⚡", brandColor: "#64748b", type: "custom",
    note: "Internal/custom carrier option. Not an official Tesla logistics service." }
].map((c) => Object.freeze({ email: "", apiEndpoint: "", phone: "", website: "", note: "", integration: null, ...c })));

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
