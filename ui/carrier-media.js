// Pictures for the public carrier cards. Carrier images and shipment-stage images are separate on purpose:
//   - carrier cards read ONLY from assets/carriers/ (this file), keyed by the carrier's stable id;
//   - the tracking result reads ONLY its own stage pictures via stagePhoto() in the tracker, keyed by the shipment's
//     recorded status and transport mode.
// Neither module imports the other. A photo is used only on the carrier it shows. A carrier without its own photo gets a
// name-led card (its name as the visual, in its brand colour): never a stock or stage photo, never another carrier's
// photo, never a drawing standing in for a picture. Sources and rights: assets/carriers/CREDITS.md.

/** Photos that belong to one carrier, by carrier id. Add a carrier here when the owner supplies its photo. */
export const CARRIER_PHOTOS = Object.freeze({
  ups: { base: "assets/carriers/ups", widths: [480, 960], position: "40% 55%", alt: "UPS delivery vehicles parked in a depot" },
  emiratesskycargo: { base: "assets/carriers/emirates", widths: [480, 960], position: "35% 55%", alt: "Emirates SkyCargo Boeing 777 freighter on the apron" },
  maersk: { base: "assets/carriers/maersk", widths: [480, 960], position: "50% 60%", alt: "Maersk container ship at sea" },
});

export const CARD_CATEGORIES = Object.freeze(["express", "air", "ocean", "regional", "custom"]);

/**
 * What a carrier card shows: { type: "photo", base, widths, position, alt } for a carrier with its own photo, otherwise
 * { type: "name", category } (name-led card). Looked up by id only, so list order, filters and display names can never
 * move a picture onto another carrier.
 */
export function carrierMedia(c) {
  const photo = Object.hasOwn(CARRIER_PHOTOS, c?.id) ? CARRIER_PHOTOS[c.id] : null;
  if (photo) return { type: "photo", ...photo };
  return { type: "name", category: CARD_CATEGORIES.includes(c?.category) ? c.category : "custom" };
}
