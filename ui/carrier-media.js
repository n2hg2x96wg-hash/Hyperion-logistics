// Pictures for the public carrier cards (presentation only; carrier records are untouched). Photos that show a
// carrier's own livery are used only on that carrier's card. Every other card uses an unbranded transport picture
// already on the site, with its own crop and zoom so cards sharing a picture still look distinct. A carrier with no
// entry (e.g. one an admin adds later) gets its category's picture. Sources and rights: assets/carriers/CREDITS.md.

// base path + the widths available as .avif/.webp/.jpg
const SRC = {
  ups: { base: "assets/carriers/ups", widths: [480, 960], brand: "ups" },
  emirates: { base: "assets/carriers/emirates", widths: [480, 960], brand: "emiratesskycargo" },
  maersk: { base: "assets/carriers/maersk", widths: [480, 960], brand: "maersk" },
  ship: { base: "assets/freight/ship", widths: [960, 1179] },
  air: { base: "assets/stages/air", widths: [342] },
  handover: { base: "assets/journey/handover", widths: [720, 1179] },
  dusk: { base: "assets/stages/dusk", widths: [720, 1179] },
  dock: { base: "assets/stages/dock", widths: [720, 1179] },
  aerial: { base: "assets/stages/aerial", widths: [720, 1179] },
  dc: { base: "assets/stages/dc", widths: [720, 1179] },
  bays: { base: "assets/stages/bays", widths: [720, 1179] },
  campus: { base: "assets/stages/campus", widths: [720, 1099] },
};

// carrier id -> [picture, object-position, zoom]
const BY_ID = {
  fedex: ["dock", "30% 60%", 1], dhl: ["dusk", "20% 70%", 1], ups: ["ups", "40% 55%", 1], usps: ["handover", "80% 50%", 1],
  royalmail: ["aerial", "50% 60%", 1], aramex: ["dc", "60% 50%", 1], sfexpress: ["bays", "40% 50%", 1], canadapost: ["campus", "30% 50%", 1],
  auspost: ["dock", "85% 60%", 1.25], japanpost: ["dusk", "75% 60%", 1.2], correios: ["aerial", "15% 40%", 1.3], ems: ["handover", "20% 40%", 1.15],
  emiratesskycargo: ["emirates", "35% 55%", 1], qatarcargo: ["air", "50% 50%", 1], lufthansacargo: ["air", "25% 40%", 1.3], ethiopiancargo: ["air", "75% 70%", 1.3],
  maersk: ["maersk", "50% 60%", 1], msc: ["ship", "30% 50%", 1], cmacgm: ["ship", "75% 50%", 1.25],
  "2goexpress": ["handover", "50% 50%", 1], giglogistics: ["dc", "20% 70%", 1.2], redstarexpress: ["bays", "80% 40%", 1.2],
  "tesla-transport": ["dock", "60% 50%", 1.4],
};
const BY_CATEGORY = { express: ["handover", "50% 50%", 1], air: ["air", "50% 50%", 1], ocean: ["ship", "50% 50%", 1], regional: ["dusk", "50% 50%", 1], custom: ["dock", "50% 50%", 1] };

/** The picture for a carrier card: { key, base, widths, position, zoom }. A livery photo never goes on another carrier. */
export function carrierMedia(c) {
  let pick = BY_ID[c?.id];
  if (!pick || (SRC[pick[0]].brand && SRC[pick[0]].brand !== c.id)) pick = BY_CATEGORY[c?.category] || BY_CATEGORY.express;
  const [key, position, zoom] = pick;
  return { key, ...SRC[key], position, zoom };
}

export const CARRIER_MEDIA_SOURCES = SRC;
