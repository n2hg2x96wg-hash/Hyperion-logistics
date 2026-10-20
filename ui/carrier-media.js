// Pictures for the public carrier cards. Carrier images and shipment-stage images are separate on purpose:
//   - carrier cards read ONLY from assets/carriers/ (this file), keyed by the carrier's stable id;
//   - the tracking result reads ONLY its own stage pictures via stagePhoto() in the tracker, keyed by the shipment's
//     recorded status and transport mode.
// Neither module imports the other. A photo is used only on the carrier it shows. A carrier without its own photo gets
// an original drawn illustration of its transport category (never a photo of somewhere real, never another carrier's
// livery). Sources and rights: assets/carriers/CREDITS.md.

/** Photos that belong to one carrier, by carrier id. Add a carrier here when it has its own photo. */
export const CARRIER_PHOTOS = Object.freeze({
  ups: { base: "assets/carriers/ups", widths: [480, 960], position: "40% 55%", alt: "UPS delivery vehicles parked in a depot" },
  emiratesskycargo: { base: "assets/carriers/emirates", widths: [480, 960], position: "35% 55%", alt: "Emirates SkyCargo Boeing 777 freighter on the apron" },
  maersk: { base: "assets/carriers/maersk", widths: [480, 960], position: "50% 60%", alt: "Maersk container ship at sea" },
});

export const ART_CATEGORIES = Object.freeze(["express", "air", "ocean", "regional", "custom"]);

/**
 * What a carrier card shows: { type: "photo", base, widths, position, alt } for a carrier with its own photo, otherwise
 * { type: "art", category } (drawn category illustration). Looked up by id only, so list order, filters and display
 * names can never move a picture onto another carrier.
 */
export function carrierMedia(c) {
  const photo = Object.hasOwn(CARRIER_PHOTOS, c?.id) ? CARRIER_PHOTOS[c.id] : null;
  if (photo) return { type: "photo", ...photo };
  return { type: "art", category: ART_CATEGORIES.includes(c?.category) ? c.category : "custom" };
}

// Drawn category illustrations (original artwork, generic and unbranded). 16:10 view box; colours come from the card
// (--brand for the accent), so the same drawing reads as each carrier's own without imitating any livery.
const ROUTE = '<path d="M-10 150 C 70 60, 210 50, 330 120" fill="none" stroke="#2588ff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="4 7"/>';
const GRID = '<g fill="#9cc4ff" fill-opacity=".14">' + Array.from({ length: 7 }, (_, r) => Array.from({ length: 11 }, (_, c) => `<circle cx="${12 + c * 30}" cy="${10 + r * 30}" r="1.2"/>`).join("")).join("") + "</g>";
const SCENES = {
  air: `${ROUTE}<g transform="translate(70 62) rotate(-12)"><path d="M0 34 C 0 26, 10 22, 30 22 L 150 22 C 166 22, 178 28, 182 34 C 178 40, 166 44, 150 44 L 30 44 C 10 44, 0 40, 0 34 Z" fill="#e8eef8"/>
    <path d="M70 30 L 118 -12 L 132 -12 L 108 30 Z M70 40 L 112 76 L 126 76 L 104 40 Z" fill="#c9d6ea"/><path d="M8 26 L -4 2 L 10 2 L 28 24 Z" fill="var(--brand)"/>
    <path d="M150 27 h 18 c 4 0 6 3 8 7 h -26 Z" fill="#0b1a3d" fill-opacity=".55"/><rect x="40" y="31" width="96" height="3" rx="1.5" fill="var(--brand)"/></g>
    <path d="M0 176 H 320" stroke="#9cc4ff" stroke-opacity=".25"/>`,
  ocean: `${ROUTE}<path d="M0 150 q 20 -6 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 V200 H0 Z" fill="#0b3a6e" fill-opacity=".7"/>
    <g transform="translate(46 92)"><path d="M0 40 L 228 40 L 210 66 L 14 66 Z" fill="#e8eef8"/><path d="M0 40 L 228 40 L 226 46 L 2 46 Z" fill="var(--brand)"/>
    <g>${[[18, "var(--brand)"], [50, "#9cc4ff"], [82, "#5b7fb5"], [114, "var(--brand)"], [146, "#c9d6ea"]].map(([x, f]) => `<rect x="${x}" y="22" width="30" height="17" rx="1.5" fill="${f}"/><rect x="${x}" y="4" width="30" height="17" rx="1.5" fill="${f}" fill-opacity=".75"/>`).join("")}</g>
    <rect x="186" y="6" width="26" height="33" rx="2" fill="#c9d6ea"/><rect x="190" y="11" width="18" height="5" rx="1" fill="#0b1a3d" fill-opacity=".5"/></g>
    <path d="M0 168 q 20 -5 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0" fill="none" stroke="#9cc4ff" stroke-opacity=".35" stroke-width="2"/>`,
  express: `${ROUTE}<g transform="translate(46 70)"><rect x="0" y="40" width="64" height="56" rx="3" fill="#c9a77a"/><rect x="28" y="40" width="8" height="56" fill="var(--brand)"/>
    <rect x="70" y="58" width="48" height="38" rx="3" fill="#d8b98d"/><rect x="90" y="58" width="8" height="38" fill="var(--brand)"/>
    <rect x="12" y="2" width="44" height="38" rx="3" fill="#e2c69e"/><rect x="30" y="2" width="8" height="38" fill="var(--brand)"/></g>
    <g transform="translate(168 96)"><path d="M0 8 h 92 v 52 h -92 Z" fill="#e8eef8"/><path d="M92 22 h 26 l 16 18 v 20 h -42 Z" fill="#c9d6ea"/><path d="M98 27 h 18 l 10 12 h -28 Z" fill="#0b1a3d" fill-opacity=".5"/>
    <rect x="0" y="40" width="134" height="5" fill="var(--brand)"/><circle cx="26" cy="62" r="11" fill="#0b1a3d"/><circle cx="108" cy="62" r="11" fill="#0b1a3d"/><circle cx="26" cy="62" r="4" fill="#9cc4ff"/><circle cx="108" cy="62" r="4" fill="#9cc4ff"/></g>
    <path d="M0 180 H 320" stroke="#9cc4ff" stroke-opacity=".25"/>`,
  regional: `<path d="M-10 190 L 120 104 L 200 104 L 330 190 Z" fill="#0b1a3d" fill-opacity=".6"/><path d="M160 106 V 190" stroke="#e2c69e" stroke-width="3" stroke-dasharray="10 10"/>
    ${[[60, 70], [160, 46], [262, 74]].map(([x, y]) => `<g transform="translate(${x} ${y})"><path d="M0 0 c -9 0 -14 7 -14 13 c 0 10 14 22 14 22 s 14 -12 14 -22 c 0 -6 -5 -13 -14 -13 Z" fill="var(--brand)"/><circle cx="0" cy="13" r="5" fill="#e8eef8"/></g>`).join("")}
    <path d="M60 105 Q 110 60 160 81 T 262 109" fill="none" stroke="#2588ff" stroke-opacity=".6" stroke-width="2" stroke-dasharray="4 7"/>
    <g transform="translate(120 124)"><path d="M0 6 h 58 v 36 h -58 Z" fill="#e8eef8"/><path d="M58 16 h 16 l 10 12 v 14 h -26 Z" fill="#c9d6ea"/><rect x="0" y="28" width="84" height="4" fill="var(--brand)"/>
    <circle cx="16" cy="44" r="8" fill="#0b1a3d"/><circle cx="68" cy="44" r="8" fill="#0b1a3d"/></g>`,
  custom: `${ROUTE}<path d="M0 172 H 320" stroke="#9cc4ff" stroke-opacity=".3" stroke-width="2"/><path d="M0 184 H 320" stroke="#e2c69e" stroke-opacity=".5" stroke-width="2" stroke-dasharray="14 12"/>
    <g transform="translate(34 92)"><rect x="0" y="4" width="170" height="62" rx="3" fill="#e8eef8"/><rect x="0" y="48" width="170" height="5" fill="var(--brand)"/>
    <path d="M176 20 h 40 l 24 22 v 26 h -64 Z" fill="#c9d6ea"/><path d="M184 26 h 28 l 16 15 h -44 Z" fill="#0b1a3d" fill-opacity=".5"/>
    ${[22, 52, 150, 196, 226].map((x) => `<circle cx="${x}" cy="72" r="11" fill="#0b1a3d"/><circle cx="${x}" cy="72" r="4" fill="#9cc4ff"/>`).join("")}</g>`,
};

/** Inline SVG for a category illustration (decorative: the card text names the carrier). */
export function categoryArtSvg(category, uid) {
  const scene = SCENES[category] || SCENES.custom;
  const gid = `cr-glow-${String(uid || category).replace(/[^a-z0-9-]/gi, "")}`; // per card, so each glow takes that card's brand colour
  return `<svg class="cr-art" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs><radialGradient id="${gid}" cx="70%" cy="20%" r="80%"><stop offset="0" stop-color="var(--brand)" stop-opacity=".45"/><stop offset="1" stop-color="#071735" stop-opacity="0"/></radialGradient></defs>
    <rect width="320" height="200" fill="#071735"/><rect width="320" height="200" fill="url(#${gid})"/>${GRID}${scene}</svg>`;
}
