// Stage illustration for a tracking result. Everything shown is derived from the shipment's real data:
//   stage <- the recorded status code (shared/status.js codes)
//   mode  <- the recorded service type, or a single-mode carrier's catalogue category (shared/mode.js)
// The picture is an illustration of the CURRENT STAGE, never a position: nothing moves along a route, and the caption
// says so. Unknown statuses or modes fall back to a neutral parcel.
import { transportMode } from "../shared/mode.js";

const STAGE_BY_STATUS = {
  CREATED: "registered", PROCESSING: "processing", PICKED_UP: "transit", IN_TRANSIT: "transit",
  AT_FACILITY: "facility", CUSTOMS: "facility", OUT_FOR_DELIVERY: "out-for-delivery", DELIVERED: "delivered",
  DELAYED: "held", EXCEPTION: "held", CANCELLED: "cancelled"
};
const SCENE_MODE = { sea: "ship", air: "plane", road: "truck" }; // shared/mode.js -> drawing / 3D vocabulary

export const STAGE_TEXT = {
  registered: "Shipment registered", processing: "Processing", transit: "In transit", facility: "At a facility",
  "out-for-delivery": "Out for delivery", delivered: "Delivered", held: "On hold", cancelled: "Cancelled", neutral: "Shipment"
};
const MODE_TEXT = { ship: "sea freight", plane: "air freight", truck: "road freight" };

/** Transport mode from recorded data only (shared/mode.js), or null when the data does not say. */
export function shipmentMode(view) {
  const m = transportMode({ serviceType: view?.carrier?.serviceType, carrierName: view?.carrier?.name, custom: view?.carrier?.custom });
  return m ? SCENE_MODE[m] : null;
}

/** { stage, mode, label } for the illustration. */
export function presentation(view) {
  const stage = STAGE_BY_STATUS[view?.status?.code] || "neutral";
  const mode = shipmentMode(view);
  const code = view?.status?.code;
  const label = code === "PICKED_UP" ? "Picked up" : code === "CUSTOMS" ? "In customs"
    : stage === "transit" && mode ? `${STAGE_TEXT.transit} · ${MODE_TEXT[mode]}` : STAGE_TEXT[stage];
  return { stage, mode, label };
}

// ---------- drawing (original artwork; 600×240 viewBox; colours come from CSS classes so both themes work) ----------
const box = (x, y, w, h, d, cls = "") => // isometric box: front, side and top faces give the 3D look
  `<g class="sc-box ${cls}"><path class="f-front" d="M${x} ${y}h${w}v${h}h${-w}z"/><path class="f-side" d="M${x + w} ${y}l${d} ${-d * 0.6}v${h}l${-d} ${d * 0.6}z"/>`
  + `<path class="f-top" d="M${x} ${y}l${d} ${-d * 0.6}h${w}l${-d} ${d * 0.6}z"/></g>`;
const parcel = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${box(-34, -40, 68, 52, 26, "parcel")}<path class="tape" d="M-6 -40v52M7 -55.6 -6 -40"/></g>`;
const SUBJECT = {
  ship: () => `<g class="sc-ship"><path class="hull" d="M150 168h300l-26 30H178z"/><path class="hull-band" d="M160 180h282l-6 8H168z"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => box(196 + i * 34, 140, 30, 28, 10, `c${i % 4}`)).join("")}${[0, 1, 2, 3].map((i) => box(214 + i * 34, 112, 30, 28, 10, `c${(i + 2) % 4}`)).join("")}
    <path class="bridge" d="M406 120h26v48h-26z"/><path class="win" d="M410 128h18v5h-18z"/><path class="mast" d="M418 120v-18"/></g>`,
  plane: () => `<g class="sc-plane" transform="rotate(-6 300 130)"><path class="body" d="M150 136c40-14 250-18 300-12 22 3 30 10 18 16-36 14-250 12-318 4z"/>
    <path class="wing" d="M280 132 240 200h26l70-64z"/><path class="wing" d="M290 124 262 78h20l52 44z"/><path class="tail" d="M160 132 140 90h18l30 40z"/>
    <path class="win" d="M440 126h12v6h-12z"/>${[0, 1, 2, 3, 4, 5].map((i) => `<circle class="port" cx="${250 + i * 26}" cy="134" r="3"/>`).join("")}</g>`,
  truck: () => `<g class="sc-truck">${box(150, 110, 210, 66, 18, "trailer")}<path class="cab" d="M372 128h52l26 26v22h-78z"/><path class="win" d="M384 136h34l16 16h-50z"/>
    ${[190, 230, 330, 404].map((cx) => `<circle class="wheel" cx="${cx}" cy="182" r="13"/><circle class="hub" cx="${cx}" cy="182" r="5"/>`).join("")}</g>`,
  van: () => `<g class="sc-van">${box(200, 112, 140, 64, 16, "trailer")}<path class="cab" d="M352 126h42l24 24v26h-66z"/><path class="win" d="M362 134h28l14 14h-42z"/>
    ${[236, 316, 392].map((cx) => `<circle class="wheel" cx="${cx}" cy="182" r="12"/><circle class="hub" cx="${cx}" cy="182" r="4"/>`).join("")}</g>`,
  warehouse: () => `<g class="sc-warehouse">${box(170, 96, 230, 92, 40, "building")}<path class="roof" d="M164 98l40-24h236l-40 24z"/>
    ${[0, 1, 2].map((i) => `<path class="door" d="M${190 + i * 70} 132h50v56h-50z"/><path class="door-line" d="M${190 + i * 70} 146h50M${190 + i * 70} 160h50M${190 + i * 70} 174h50"/>`).join("")}
    ${parcel(470, 178, 0.55)}${parcel(510, 186, 0.45)}</g>`,
  house: () => `<g class="sc-house">${box(330, 104, 150, 84, 30, "building")}<path class="roof" d="M322 108l45-46h120l-45 46z"/><path class="door" d="M390 140h32v48h-32z"/><circle class="knob" cx="416" cy="166" r="2.5"/>
    <path class="win" d="M346 124h30v22h-30zM436 124h30v22h-30z"/></g>`,
  parcel: () => parcel(300, 178, 1.2)
};
const BADGE = {
  held: '<g class="sc-badge warn"><circle cx="512" cy="56" r="22"/><path d="M505 46v20M519 46v20"/></g>',
  cancelled: '<g class="sc-badge bad"><circle cx="512" cy="56" r="22"/><path d="M503 47l18 18M521 47l-18 18"/></g>',
  delivered: '<g class="sc-badge ok"><circle cx="512" cy="56" r="22"/><path d="M501 57l8 8 14-16"/></g>'
};

function composition(stage, mode) {
  const vehicle = SUBJECT[mode || "parcel"];
  switch (stage) {
    case "registered": case "processing": case "facility": return SUBJECT.warehouse();
    case "transit": return vehicle();
    case "out-for-delivery": return SUBJECT.house() + `<g transform="translate(-130 0)">${SUBJECT.van()}</g>`;
    case "delivered": return SUBJECT.house() + parcel(370, 196, 0.5);
    case "held": return vehicle();
    default: return SUBJECT.parcel();
  }
}

/** Inline SVG for the stage illustration (decorative: the text next to it carries the information). */
export function sceneSvg({ stage, mode }) {
  return `<svg class="hx-scene-svg" viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs><linearGradient id="hxSky" x1="0" y1="0" x2="0" y2="1"><stop class="s1" offset="0"/><stop class="s2" offset="1"/></linearGradient>
      <radialGradient id="hxGlow" cx=".5" cy=".55" r=".5"><stop class="g1" offset="0"/><stop class="g2" offset="1"/></radialGradient></defs>
    <rect width="600" height="240" fill="url(#hxSky)"/><ellipse cx="300" cy="150" rx="300" ry="120" fill="url(#hxGlow)"/>
    <g class="sc-grid">${[0, 1, 2, 3, 4].map((i) => `<path d="M0 ${200 + i * 9}H600"/>`).join("")}${[-3, -2, -1, 0, 1, 2, 3].map((i) => `<path d="M${300 + i * 40} 200 ${300 + i * 140} 240"/>`).join("")}</g>
    <ellipse class="sc-shadow" cx="300" cy="200" rx="190" ry="14"/>
    <g transform="translate(300 200) scale(${stage === "transit" || stage === "held" ? 1.3 : 1.12}) translate(-300 -200)"><g class="hx-scene-subject ${stage === "cancelled" ? "is-muted" : ""}">${composition(stage, mode)}</g></g>
    ${BADGE[stage] || ""}</svg>`;
}

/**
 * Recorded route, oldest first: origin, the places named in recorded events (consecutive repeats merged), destination.
 * Text only: no coordinates are made up, and an event without a recorded place never becomes a stop.
 * Each stop has state done | current | upcoming; the destination stays upcoming until the shipment is delivered.
 */
export function routeStops(view) {
  const v = view || {};
  const events = (v.timeline || []).filter((t) => t && t.location).slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const mid = [];
  for (const e of events) if (!mid.length || !same(mid[mid.length - 1].place, e.location)) mid.push({ place: e.location, title: e.title, at: e.timestamp });
  const delivered = v.status?.code === "DELIVERED";
  if (mid.length && same(mid[0].place, v.origin)) mid.shift();
  if (mid.length && same(mid[mid.length - 1].place, v.destination) && delivered) mid.pop();
  const stops = [];
  if (v.origin) stops.push({ kind: "origin", place: v.origin, title: "Origin" });
  mid.forEach((m) => stops.push({ kind: "event", ...m }));
  if (v.destination) stops.push({ kind: "destination", place: v.destination, title: delivered ? "Delivered" : "Destination" });
  let current = stops.length - 1;
  if (!delivered) while (current > 0 && stops[current].kind === "destination") current--;
  return stops.map((x, i) => ({ ...x, state: i < current ? "done" : i === current ? "current" : "upcoming" }));
}

// ---------- owner's stage photos (assets/stages, see CREDITS.md) and the optional 3D model per stage ----------
// Photos illustrate the kind of place or vehicle for the recorded stage; they never claim to show the actual facility,
// vessel or parcel. Stages without a fitting photo keep the drawn illustration above.
const PHOTOS = {
  dock: { file: "dock", widths: [720, 1179], w: 1179, h: 784, alt: "Illustration: a distribution warehouse with trucks at its loading docks at dusk" },
  aerial: { file: "aerial", widths: [720, 1179], w: 1179, h: 664, alt: "Illustration: aerial view of a large distribution centre with trailers at its loading bays" },
  campus: { file: "campus", widths: [720, 1099], w: 1099, h: 638, alt: "Illustration: a secured logistics campus with a gated entrance" },
  ship: { file: "ship", widths: [342], w: 342, h: 250, alt: "Illustration: a container ship at sea, seen from above" },
  air: { file: "air", widths: [342], w: 342, h: 250, alt: "Illustration: a cargo aircraft being loaded at an airport" },
  dusk: { file: "dusk", widths: [720, 1179], w: 1179, h: 664, alt: "Illustration: a distribution warehouse with a delivery van in front" }
};
const PHOTO_BY_STATUS = { CREATED: "dock", PROCESSING: "dock", AT_FACILITY: "aerial", CUSTOMS: "campus", OUT_FOR_DELIVERY: "dusk" };

/** Photo for the recorded stage, or null when the drawn illustration should be used. */
export function stagePhoto(view) {
  const code = view?.status?.code;
  const { stage, mode } = presentation(view);
  let key = PHOTO_BY_STATUS[code] || null;
  if (stage === "transit" && mode === "ship") key = "ship";
  if (stage === "transit" && mode === "plane") key = "air";
  return key ? { key, ...PHOTOS[key] } : null;
}

// ---------- plain-language meaning of each recorded status (general; never a claim about a specific shipment) ----------
export const STATUS_HELP = {
  CREATED: "The shipment has been registered with Hyperion. It may not have been collected yet.",
  PROCESSING: "The shipment is being prepared for dispatch, for example documentation or booking with a carrier.",
  PICKED_UP: "The shipment has been collected and handed over for transport.",
  IN_TRANSIT: "The shipment is moving between recorded places. Positions are updated when a new milestone is recorded.",
  AT_FACILITY: "The shipment is at a warehouse, hub or terminal between transport legs.",
  CUSTOMS: "The shipment is going through customs or an inspection process. Timing depends on the authorities.",
  OUT_FOR_DELIVERY: "The shipment is on its final delivery leg to the destination.",
  DELIVERED: "The shipment has been recorded as delivered.",
  DELAYED: "A delay has been recorded. Any explanation provided by our team is shown above; contact support for details.",
  EXCEPTION: "An issue that needs attention has been recorded. Our team will follow up; contact support for details.",
  CANCELLED: "The shipment has been cancelled and will not continue."
};

// ---------- 3D scene for the recorded stage (tracker/3d/scenes) ----------
const SCENE_BY_STATUS = { CREATED: "processing", PROCESSING: "processing", PICKED_UP: "collection", AT_FACILITY: "facility", CUSTOMS: "customs",
  OUT_FOR_DELIVERY: "delivery", DELIVERED: "delivered" };
const SCENE_BY_MODE = { ship: "ship", plane: "air", truck: "road" };
const SCENE_TEXT = { processing: "warehouse where shipments are prepared", collection: "dispatch dock where shipments are collected", ship: "container vessel at sea",
  air: "cargo aircraft at an airport", road: "freight truck on a highway", neutral: "pallet of parcels", facility: "distribution centre",
  customs: "cargo customs inspection area", delivery: "delivery van on a residential street", delivered: "parcel on a front porch",
  delayed: "truck staging yard where loads wait", hold: "cargo hold bay where shipments wait for attention", cancelled: "closed loading dock" };

function sceneFor(code, view) {
  if (code === "IN_TRANSIT") return SCENE_BY_MODE[shipmentMode(view)] || "neutral"; // no recorded mode: no vehicle is implied
  return SCENE_BY_STATUS[code] || null;
}

/**
 * { scene, animate, state } for the recorded status. The paused statuses each get their own still scene so they can't
 * be mistaken for normal movement: delayed → a staging yard, exception (on hold) → a hold bay, cancelled → a closed
 * dock. Unknown statuses get the neutral scene, also still.
 */
export function stageScene(view) {
  const code = view?.status?.code;
  if (code === "CANCELLED") return { scene: "cancelled", animate: false, state: "cancelled" };
  if (code === "DELAYED") return { scene: "delayed", animate: false, state: "held" };
  if (code === "EXCEPTION") return { scene: "hold", animate: false, state: "held" };
  const direct = sceneFor(code, view);
  if (direct) return { scene: direct, animate: true, state: "normal" };
  return { scene: "neutral", animate: false, state: "unknown" };
}
export function modelCaption(scene, state = "normal") {
  const base = `3D illustration of a typical ${SCENE_TEXT[scene] || SCENE_TEXT.neutral} for this stage — not the actual facility, vehicle or parcel.`;
  return state === "held" ? `${base} Shown without movement while the shipment is on hold.` : state === "cancelled" ? `${base} Shown without movement: the shipment is cancelled.` : base;
}

/** <picture> markup for a stage photo; fixed width/height so nothing shifts while it loads. */
export function stagePhotoHtml(p) {
  const set = (ext) => p.widths.map((w) => `/assets/stages/${p.file}-${w}.${ext} ${w}w`).join(", ");
  const largest = p.widths[p.widths.length - 1];
  return `<picture class="hx-scene-photo is-${p.key}"><source type="image/avif" srcset="${set("avif")}" sizes="(max-width: 720px) 100vw, 600px">`
    + `<source type="image/webp" srcset="${set("webp")}" sizes="(max-width: 720px) 100vw, 600px">`
    + `<img src="/assets/stages/${p.file}-${largest}.jpg" srcset="${set("jpg")}" sizes="(max-width: 720px) 100vw, 600px" width="${p.w}" height="${p.h}" alt="${p.alt}" decoding="async" onerror="this.closest('picture').classList.add('is-missing')"></picture>`;
}

/**
 * Recorded checkpoints drawn over the ship photo: a schematic left-to-right line (never geography), completed solid,
 * still-to-come dashed, the current checkpoint highlighted. At most 4 labels; a "+N" marker stands for the rest.
 */
export function routeOverlaySvg(view) {
  const stops = routeStops(view);
  if (stops.length < 2) return "";
  const MAX = 4; const hidden = Math.max(0, stops.length - MAX);
  const shown = hidden ? [stops[0], ...stops.slice(-(MAX - 1))] : stops;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = (s) => { const t = String(s).split(",")[0].trim(); return t.length > 16 ? `${t.slice(0, 15)}…` : t; };
  const n = shown.length; const x = (i) => 40 + (i * 520) / (n - 1); const y = (i) => 150 - Math.sin((i / (n - 1)) * Math.PI) * 70;
  let path = ""; let dashed = "";
  for (let i = 1; i < n; i++) {
    const seg = `M${x(i - 1).toFixed(1)} ${y(i - 1).toFixed(1)} Q${((x(i - 1) + x(i)) / 2).toFixed(1)} ${(Math.min(y(i - 1), y(i)) - 22).toFixed(1)} ${x(i).toFixed(1)} ${y(i).toFixed(1)}`;
    if (shown[i].state === "upcoming") dashed += seg; else path += seg;
  }
  const dots = shown.map((s, i) => `<g class="ro-stop is-${s.state}"><circle cx="${x(i).toFixed(1)}" cy="${y(i).toFixed(1)}" r="${s.state === "current" ? 9 : 6}"/>`
    + `<text x="${x(i).toFixed(1)}" y="${(y(i) + 26).toFixed(1)}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(short(s.place))}</text></g>`).join("");
  return `<svg class="hx-route-overlay" viewBox="0 0 600 240" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Recorded checkpoints: ${esc(shown.map((s) => s.place).join(", then "))}">
    <path class="ro-done" d="${path}"/><path class="ro-next" d="${dashed}"/>${dots}
    ${hidden ? `<text class="ro-more" x="300" y="226" text-anchor="middle">+${hidden} earlier checkpoint${hidden === 1 ? "" : "s"}</text>` : ""}</svg>`;
}
