// Dark flat world map (Leaflet). The reliable fallback for the 3D globe: same Natural Earth country shapes,
// same planned-route arcs and recorded-position markers, no tile provider needed.
import { loadLeaflet } from "../../tracker/map.js";
import { loadCountries, routeSegments, TONE_COLORS } from "./geo.js";

/** Leaflet draws polygons that span the antimeridian as world-wide stripes: drop Antarctica and unwrap the rest. */
function forFlatMap(fc) {
  const unwrap = (ring) => {
    let min = 180, max = -180; for (const [x] of ring) { if (x < min) min = x; if (x > max) max = x; }
    return max - min > 300 ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
  };
  return { type: "FeatureCollection", features: fc.features.filter((f) => f.properties.iso !== "AQ").map((f) => ({ ...f, geometry: {
    type: f.geometry.type,
    coordinates: f.geometry.type === "Polygon" ? f.geometry.coordinates.map(unwrap) : f.geometry.coordinates.map((poly) => poly.map(unwrap))
  } })) };
}

export async function createFlatMap(el, { onSelect } = {}) {
  const [L, raw] = await Promise.all([loadLeaflet(), loadCountries()]);
  const countries = forFlatMap(raw);
  el.classList.add("cc-flat");
  const map = L.map(el, { zoomControl: false, attributionControl: true, worldCopyJump: false, minZoom: 1, maxZoom: 7,
    zoomSnap: 0.25, preferCanvas: true, maxBounds: [[-75, -260], [85, 260]], scrollWheelZoom: false });
  map.attributionControl.setPrefix(false).addAttribution("Natural Earth");
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.geoJSON(countries, { interactive: false, style: { color: "#2f4f8f", weight: 0.6, fillColor: "#13254d", fillOpacity: 0.95 } }).addTo(map);
  map.setView([18, 12], el.clientWidth < 520 ? 1 : 1.75);
  map.on("click", () => map.scrollWheelZoom.enable());
  const layer = L.layerGroup().addTo(map);
  let routes = []; let selected = null;

  const draw = () => {
    layer.clearLayers();
    for (const r of routes) {
      const color = TONE_COLORS[r.status?.tone] || TONE_COLORS.info; const sel = r.key === selected;
      for (const s of routeSegments(r)) {
        L.polyline(s.coords.map(([lng, lat]) => [lat, lng]), {
          color, weight: sel ? 3.2 : 2, opacity: s.kind === "travelled" ? 0.95 : 0.7, dashArray: s.kind === "travelled" ? null : "5 6"
        }).on("click", () => onSelect?.(r.key)).addTo(layer);
      }
      const mk = (p, fill, radius) => p && L.circleMarker([p.lat, p.lng], { radius, color: "#e2e8f0", weight: sel ? 2 : 1, fillColor: fill, fillOpacity: 1 })
        .on("click", () => onSelect?.(r.key)).addTo(layer);
      mk(r.origin, "#34d399", 4); mk(r.destination, "#f87171", 4);
      if (r.current) { L.circleMarker([r.current.lat, r.current.lng], { radius: 11, stroke: false, fillColor: "#3b82f6", fillOpacity: 0.22, interactive: false }).addTo(layer); mk(r.current, "#60a5fa", 5.5); }
    }
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
  ro?.observe(el);
  setTimeout(() => map.invalidateSize(), 200);

  return {
    kind: "flat",
    update(next) {
      const first = !routes.length && next?.length;
      routes = next || []; draw();
      if (first) {
        const pts = routes.flatMap((r) => [r.origin, r.destination, r.current].filter(Boolean)).map((p) => [p.lat, p.lng]);
        if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 4 });
      }
    },
    select(key) {
      selected = key; draw();
      const r = routes.find((x) => x.key === key);
      const pts = r ? [r.origin, r.destination, r.current].filter(Boolean).map((p) => [p.lat, p.lng]) : [];
      if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 5 }); else if (pts.length) map.setView(pts[0], 4);
    },
    resize() { map.invalidateSize(); },
    destroy() { ro?.disconnect(); try { map.remove(); } catch { /* ignore */ } }
  };
}
