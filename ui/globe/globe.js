// 3D globe renderer (MapLibre GL, globe projection). Loaded only on capable devices; the command center
// falls back to the Leaflet flat map (flatmap.js) if anything here is unsupported, slow or fails.
// No basemap provider: oceans and countries are drawn from Natural Earth 110m (public domain), so there are
// no API keys and no tile requests. Nothing moves along routes; only the camera may rotate (when motion is allowed).
import { loadCountries, routeSegments, TONE_COLORS, prefersReducedMotion } from "./geo.js";

const VERSION = "5.24.0";
const JS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
const CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;

let libPromise = null;
function loadMapLibre(timeoutMs) {
  if (window.maplibregl?.Map) return Promise.resolve(window.maplibregl);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${CSS}"]`)) {
        const l = document.createElement("link"); l.rel = "stylesheet"; l.href = CSS; document.head.appendChild(l);
      }
      const s = document.createElement("script"); s.src = JS; s.async = true; s.crossOrigin = "anonymous";
      const t = setTimeout(() => reject(new Error("maplibre timeout")), timeoutMs);
      s.onload = () => { clearTimeout(t); window.maplibregl?.Map ? resolve(window.maplibregl) : reject(new Error("maplibre")); };
      s.onerror = () => { clearTimeout(t); reject(new Error("maplibre")); };
      document.head.appendChild(s);
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

/** Cheap capability check before downloading anything. `force` comes from ?map=globe for testing. */
export function globeSupported({ force = false } = {}) {
  if (force) return true;
  const c = navigator.connection;
  if (c?.saveData || /(^|-)2g|3g/.test(c?.effectiveType || "")) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 3) return false;
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) return false;
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

/** Measures frame rate for ~1.2s; resolves false when the device cannot keep the globe smooth. */
function smoothEnough() {
  return new Promise((resolve) => {
    let frames = 0; const start = performance.now();
    const tick = (t) => { frames += 1; if (t - start < 1200) requestAnimationFrame(tick); else resolve(frames / ((t - start) / 1000) >= 28); };
    requestAnimationFrame(tick);
  });
}

export async function createGlobe(el, { onSelect, skipProbe = false, timeoutMs = 8000 } = {}) {
  const [lib, countries] = await Promise.all([loadMapLibre(timeoutMs), loadCountries()]);
  const reduced = prefersReducedMotion();
  const map = new lib.Map({
    container: el,
    style: {
      version: 8,
      projection: { type: "globe" },
      sources: { countries: { type: "geojson", data: countries, attribution: "Natural Earth" } },
      layers: [
        { id: "ocean", type: "background", paint: { "background-color": "#071330" } },
        { id: "land", type: "fill", source: "countries", paint: { "fill-color": "#13254d", "fill-opacity": 0.95 } },
        { id: "borders", type: "line", source: "countries", paint: { "line-color": "#2f4f8f", "line-width": 0.5, "line-opacity": 0.7 } }
      ]
    },
    center: [12, 18], zoom: el.clientWidth < 520 ? 1.05 : 1.6, minZoom: 0.6, maxZoom: 6,
    attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: false, cooperativeGestures: false
  });
  map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("globe style timeout")), timeoutMs);
    map.once("load", () => { clearTimeout(t); resolve(); });
    map.once("error", (e) => { if (!map.loaded()) { clearTimeout(t); reject(e.error || new Error("globe")); } });
  });

  if (!skipProbe && !(await smoothEnough())) { map.remove(); throw new Error("globe too slow"); }

  const empty = { type: "FeatureCollection", features: [] };
  map.addSource("routes", { type: "geojson", data: empty });
  map.addSource("points", { type: "geojson", data: empty });
  map.addLayer({ id: "route-glow", type: "line", source: "routes", layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["case", ["boolean", ["get", "selected"], false], 9, 5], "line-opacity": 0.16, "line-blur": 4 } });
  map.addLayer({ id: "route-travelled", type: "line", source: "routes", filter: ["==", ["get", "kind"], "travelled"], layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["case", ["boolean", ["get", "selected"], false], 3.2, 2] } });
  map.addLayer({ id: "route-planned", type: "line", source: "routes", filter: ["!=", ["get", "kind"], "travelled"],
    paint: { "line-color": ["get", "color"], "line-width": ["case", ["boolean", ["get", "selected"], false], 2.4, 1.4], "line-opacity": 0.75, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "pt-halo", type: "circle", source: "points", filter: ["==", ["get", "kind"], "current"],
    paint: { "circle-radius": 9, "circle-color": "#3b82f6", "circle-opacity": 0.25 } });
  map.addLayer({ id: "pt", type: "circle", source: "points",
    paint: {
      "circle-radius": ["match", ["get", "kind"], "current", 5.5, 4],
      "circle-color": ["match", ["get", "kind"], "origin", "#34d399", "destination", "#f87171", "#60a5fa"],
      "circle-stroke-color": "#e2e8f0", "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 2, 1]
    } });

  let routes = []; let selected = null; let interacted = false; let raf = 0; let visible = true; let destroyed = false;
  const setData = () => {
    const lines = []; const pts = [];
    for (const r of routes) {
      const color = TONE_COLORS[r.status?.tone] || TONE_COLORS.info; const sel = r.key === selected;
      for (const s of routeSegments(r)) lines.push({ type: "Feature", properties: { key: r.key, kind: s.kind, color, selected: sel }, geometry: { type: "LineString", coordinates: s.coords } });
      for (const [kind, p] of [["origin", r.origin], ["destination", r.destination], ["current", r.current]]) {
        if (p) pts.push({ type: "Feature", properties: { key: r.key, kind, selected: sel }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } });
      }
    }
    map.getSource("routes")?.setData({ type: "FeatureCollection", features: lines });
    map.getSource("points")?.setData({ type: "FeatureCollection", features: pts });
  };

  const pick = (e) => {
    const f = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ["pt", "route-travelled", "route-planned"] })[0];
    if (f) onSelect?.(f.properties.key);
  };
  map.on("click", pick);
  for (const layer of ["pt", "route-travelled", "route-planned"]) {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
  const stopSpin = () => { interacted = true; };
  ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => map.on(ev, stopSpin));

  // Gentle camera rotation + marker halo pulse, only when motion is allowed and the globe is on screen.
  const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; }) : null;
  io?.observe(el);
  let last = 0;
  const loop = (t) => {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    if (reduced || !visible || document.hidden || t - last < 66) return; // ~15 fps is plenty for ambient motion
    const dt = last ? t - last : 66; last = t;
    if (!interacted && !selected) { const c = map.getCenter(); map.setCenter([c.lng + dt * 0.0018, c.lat]); }
    map.setPaintProperty("pt-halo", "circle-radius", 8 + 5 * (0.5 + 0.5 * Math.sin(t / 420)));
  };
  if (!reduced) raf = requestAnimationFrame(loop);

  return {
    kind: "globe",
    update(next) { routes = next || []; setData(); },
    select(key) {
      selected = key; setData();
      const r = routes.find((x) => x.key === key); if (!r) return;
      const p = r.current || r.origin || r.destination;
      const wide = el.clientWidth > 640;
      if (p) map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 1.8), duration: reduced ? 0 : 900, offset: wide ? [-150, 0] : [0, -110] });
    },
    resize() { map.resize(); },
    destroy() { destroyed = true; cancelAnimationFrame(raf); io?.disconnect(); try { map.remove(); } catch { /* ignore */ } }
  };
}
