// Homepage "global network" map for the freight section. It reuses the public overview the Global activity map already
// loads (masked, city-level routes that operations chose to publish) and draws them on a flat world map:
//   origin -> last recorded position (solid) -> destination (dashed), with de-duplicated city labels.
// When nothing is published it shows an ILLUSTRATIVE, unlabelled network and says so; when the data can't be loaded it
// says that instead. It never calls anything live, active or GPS, and it never invents ports, stops or times.
import { loadCountries, greatCircle, prefersReducedMotion } from "./globe/geo.js";

const W = 1000; const H = 470; const TOP = 78; const BOTTOM = -56;
const px = (lng) => ((lng + 180) / 360) * W;
const py = (lat) => ((TOP - Math.max(BOTTOM, Math.min(TOP, lat))) / (TOP - BOTTOM)) * H;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pt = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;

// Generic ocean-region anchors for the illustrative state only (never labelled, never presented as shipments).
const ILLUSTRATIVE = [[[31, 122], [52, 4]], [[1.3, 104], [25, 55]], [[40, -74], [-23, -43]], [[51, 0], [40, -74]], [[-34, 18], [-23, -43]], [[22, 114], [-34, 151]], [[25, 55], [6, 3]]];

function linePath(coords) { // [[lng, lat]...] -> SVG path, broken where it wraps around the map edge
  let d = ""; let prev = null;
  for (const [lng0, lat] of coords) {
    const lng = ((lng0 + 540) % 360) - 180; const x = px(lng); const y = py(lat);
    d += `${prev === null || Math.abs(x - prev) > W / 2 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`; prev = x;
  }
  return d;
}
function landPath(fc) {
  let d = "";
  for (const f of fc.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      let prev = null; let part = "";
      for (const [lng, lat] of ring) { const x = px(lng); part += `${prev === null || Math.abs(x - prev) > W / 2 ? "M" : "L"}${x.toFixed(1)} ${py(lat).toFixed(1)}`; prev = x; }
      d += `${part}Z`;
    }
  }
  return d;
}

export function mountNetwork(root) {
  const svg = root.querySelector("svg"); const lands = svg.querySelector(".nw-land"); const layer = svg.querySelector(".nw-routes");
  const tag = root.querySelector("[data-slot='nwtag']"); const note = root.querySelector("[data-slot='nwnote']"); const legend = root.querySelector(".nw-legend");
  let shown = "loading"; let animated = false;
  loadCountries().then((fc) => { lands.setAttribute("d", landPath(fc)); }).catch(() => { root.classList.add("no-land"); });

  function animateOnce() {
    if (animated || prefersReducedMotion()) return; animated = true;
    root.classList.add("is-drawing");
  }
  function setState(state, text, sub) {
    shown = state; root.dataset.state = state;
    tag.textContent = text; note.textContent = sub || ""; note.hidden = !sub;
    legend.hidden = state !== "routes";
  }

  function illustrative(reason) {
    layer.innerHTML = ILLUSTRATIVE.map(([a, b]) => `<path class="nw-arc is-illustrative" pathLength="1" d="${linePath(greatCircle({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }, 40))}"/>`).join("")
      + ILLUSTRATIVE.flat().map(([lat, lng]) => `<circle class="nw-dot is-illustrative" cx="${px(lng).toFixed(1)}" cy="${py(lat).toFixed(1)}" r="3"/>`).join("");
    setState(reason === "error" ? "error" : "illustrative", "Illustrative network — not shipment data",
      reason === "error" ? "Route data is temporarily unavailable. No shipments are shown." : "No shipments are published to the homepage right now.");
    animateOnce();
  }

  function render(data) {
    const routes = (Array.isArray(data?.routes) ? data.routes : []).filter((r) => pt(r.origin) || pt(r.destination));
    if (!routes.length) { illustrative("empty"); return; }
    const arcs = []; const marks = new Map(); // de-duplicate places by label + rounded position
    const mark = (p, label, kind) => { if (!pt(p)) return; const key = `${kind}|${label || ""}|${p.lat.toFixed(1)},${p.lng.toFixed(1)}`; if (!marks.has(key)) marks.set(key, { p, label, kind }); };
    for (const r of routes.slice(0, 12)) {
      const o = pt(r.origin); const c = pt(r.current); const dst = pt(r.destination);
      if (o && c) arcs.push({ kind: "travelled", coords: greatCircle(o, c, 40) });
      if (c && dst) arcs.push({ kind: "remaining", coords: greatCircle(c, dst, 40) });
      if (!c && o && dst) arcs.push({ kind: "planned", coords: greatCircle(o, dst, 40) });
      mark(o, r.originLabel, "origin"); mark(dst, r.destinationLabel, "destination"); mark(c, r.current?.place, "current");
    }
    // labels: one per place name, nudged up/down to avoid overlaps, dropped if there is no room
    const placed = []; const labels = []; const seen = new Set();
    for (const { p, label } of marks.values()) {
      if (!label || seen.has(label)) continue; seen.add(label);
      const x = px(p.lng); const w = Math.min(160, label.length * 6.4 + 8);
      for (const dy of [-10, 16, -24, 30]) {
        const y = py(p.lat) + dy; const left = x + w > W ? x - w - 6 : x + 6;
        const box = { l: left, r: left + w, t: y - 10, b: y + 3 };
        if (placed.some((q) => !(box.r < q.l || box.l > q.r || box.b < q.t || box.t > q.b))) continue;
        placed.push(box); labels.push(`<text class="nw-label" x="${left.toFixed(1)}" y="${y.toFixed(1)}">${esc(label)}</text>`); break;
      }
    }
    layer.innerHTML = arcs.map((a) => `<path class="nw-arc is-${a.kind}" pathLength="1" d="${linePath(a.coords)}"/>`).join("")
      + [...marks.values()].map(({ p, kind }) => `<circle class="nw-dot is-${kind}" cx="${px(p.lng).toFixed(1)}" cy="${py(p.lat).toFixed(1)}" r="${kind === "current" ? 5 : 4}"/>`).join("")
      + labels.join("");
    // no update time here: the overview's lastUpdated is when a record was last edited, not a shipment event time
    setState("routes", `${routes.length} published shipment${routes.length === 1 ? "" : "s"} · city level · tracking numbers masked`, "Lines are drawn between recorded places; dashed sections are the planned remainder, not a tracked path.");
    animateOnce();
  }

  return {
    render,
    /** The request failed: keep routes already shown, otherwise show the illustrative map and say data is unavailable. */
    error() { if (shown !== "routes") illustrative("error"); }
  };
}
