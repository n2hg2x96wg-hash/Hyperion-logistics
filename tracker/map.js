// Shipment map (Leaflet, loaded lazily). Renders only legitimately recorded coordinates.
// Base: a themed outline map drawn from Natural Earth 110m (public domain, no tile requests), following the site's
// light/dark theme. "Street map" switches to the tile chain (OpenStreetMap by default, or a keyed provider set via env,
// from /api/config); if the outline can't load, the tiles are used automatically. No API keys live here.
// The first view is the shipment itself (origin, destination, recorded points), never a world overview.
// Layers are created once and moved in place on updates, so new positions never rebuild the map.
import { loadCountries } from "../ui/globe/geo.js";
const LEAFLET_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css";
const LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js";

let leafletPromise = null;
export function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
        const css = document.createElement("link"); css.rel = "stylesheet"; css.href = LEAFLET_CSS; document.head.appendChild(css);
      }
      const s = document.createElement("script"); s.src = LEAFLET_JS; s.async = true;
      s.onload = () => (window.L?.map ? resolve(window.L) : reject(new Error("leaflet")));
      s.onerror = () => reject(new Error("leaflet"));
      document.head.appendChild(s);
    });
    leafletPromise.catch(() => { leafletPromise = null; });
  }
  return leafletPromise;
}

let configPromise = null;
function loadConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config", { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  return configPromise;
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DEFAULT_TILES = [
  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR, maxZoom: 19 },
  { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxZoom: 19 }
];
function providers(cfg) {
  const tiles = Array.isArray(cfg?.map?.tiles) && cfg.map.tiles.length ? cfg.map.tiles : DEFAULT_TILES;
  return tiles.filter((t) => typeof t?.url === "string" && /^https:\/\//.test(t.url))
    .map((t) => ({ url: t.url, options: { attribution: t.attribution || "", maxZoom: t.maxZoom || 19, crossOrigin: false } }));
}

const fmt = (iso) => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const STATE_LABEL = { live: "Live", recent: "Recently updated", last: "Last known location" };

function popupNode(title, lines) {
  const el = document.createElement("div"); el.className = "hx-popup";
  const h = document.createElement("strong"); h.textContent = title; el.appendChild(h);
  for (const line of lines.filter(Boolean)) { const p = document.createElement("div"); p.textContent = line; el.appendChild(p); }
  return el;
}
const samePt = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
const MODE_ICON = {
  ship: '<path d="M3 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/><path d="M5 14 4 10h16l-1 4"/><path d="M8 10V6h4v4M12 7h4v3"/>',
  plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5Z"/>',
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'
};
/** A gently curved connector between two recorded places (it is not a tracked path). */
export function curve(a, b, steps = 32) {
  const [lat1, lng1] = a; let [lat2, lng2] = b;
  if (Math.abs(lng2 - lng1) > 180) lng2 += lng2 > lng1 ? -360 : 360; // the short way round
  const dx = lng2 - lng1; const dy = lat2 - lat1; const len = Math.hypot(dx, dy);
  if (len < 0.01) return [a, b];
  const k = Math.min(0.18, 6 / len) * len; // bulge, capped for very long routes
  const mx = (lng1 + lng2) / 2 - (dy / len) * k; const my = (lat1 + lat2) / 2 + (dx / len) * k;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; const u = 1 - t;
    out.push([u * u * lat1 + 2 * u * t * my + t * t * lat2, u * u * lng1 + 2 * u * t * mx + t * t * lng2]);
  }
  return out;
}
/** Rings crossing the antimeridian (Russia, Fiji…) are shifted to continuous longitudes so they don't streak across the map. */
function unwrap(fc) {
  const fix = (ring) => {
    let jump = false; for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) { jump = true; break; }
    return jump ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
  };
  return { ...fc, features: fc.features.map((f) => {
    const g = f.geometry; if (!g) return f;
    const coordinates = g.type === "Polygon" ? g.coordinates.map(fix) : g.type === "MultiPolygon" ? g.coordinates.map((p) => p.map(fix)) : g.coordinates;
    return { ...f, geometry: { ...g, coordinates } };
  }) };
}
/**
 * Route order unwrapping: shift each longitude by ±360 so consecutive points are never more than 180° apart. Markers,
 * lines and bounds then follow the short way (Los Angeles → Seoul across the Pacific, routes over the date line stay
 * continuous) instead of being framed the long way round the world. Input/output: [lat, lng] pairs (nulls kept).
 */
export function unwrapRoute(seq) {
  let prev = null;
  return seq.map((p) => {
    if (!p) return p;
    let lng = p[1];
    if (prev != null) { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
    prev = lng; return [p[0], lng];
  });
}
/** Shift a Polygon/MultiPolygon's longitudes by dx (for the extra world copies of the outline). */
function shift(g, dx) {
  const ring = (r) => (dx ? r.map(([x, y]) => [x + dx, y]) : r);
  return g.type === "Polygon" ? g.coordinates.map(ring) : g.type === "MultiPolygon" ? g.coordinates.map((p) => p.map(ring)) : g.coordinates;
}
/** Bounds of every drawable point in the map data, or null. Used to open the map already framed on the shipment. */
export function pointsOf(data) {
  if (!data) return [];
  // route order (origin → checkpoints → latest → destination), unwrapped, so the bounds are the short way round
  return unwrapRoute([ll(data.origin), ...(data.trail || []).map((t) => ll(t)), ll(data.current), ll(data.destination)]).filter(Boolean);
}
// Defence in depth (the server already filters): never draw missing, non-numeric or 0,0 points.
const ll = (p) => (p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0) ? [p.lat, p.lng] : null);

/** Creates a map inside `el`. Returns { update(mapData), fit(), destroy() }. Rejects if Leaflet cannot be loaded. */
export async function createMap(el, { onStatus, interactiveHint = true, initial = null, street = false } = {}) {
  const [L, cfg] = await Promise.all([loadLeaflet(), loadConfig()]);
  const touch = !!L.Browser.mobile;
  // Page scrolling must win over the map: wheel zoom waits for a click, one-finger drag waits for a tap on touch screens.
  // SVG for the few route lines and markers: Leaflet's canvas renderer can try to redraw after the map is removed when
  // the visitor switches tracking codes mid-animation
  const map = L.map(el, { zoomControl: true, preferCanvas: false, worldCopyJump: true, minZoom: 1, zoomSnap: 0.25, zoomDelta: 1, scrollWheelZoom: false, dragging: !touch, tap: false });
  const small = () => (el.clientWidth || 600) < 520;
  // phones keep the controls in a row along the bottom, so the route gets the top of the map
  // (room for the side labels too: "Destination · …" sits left of its marker, the others to the right)
  const pad = () => (small() ? { paddingTopLeft: [70, 48], paddingBottomRight: [70, 80] } : { paddingTopLeft: [150, 56], paddingBottomRight: [160, 56] });
  const hasSize = () => el.clientWidth > 0 && el.clientHeight > 0;
  // open on the shipment: frame its points before anything is drawn (a world view only when there are none). A
  // container without a size yet (hidden, still laying out) is framed by the resize observer as soon as it has one.
  const first = pointsOf(initial);
  if (first.length > 1) map.fitBounds(L.latLngBounds(first), { ...pad(), maxZoom: 9, animate: false });
  else if (first.length === 1) map.setView(first[0], 5, { animate: false });
  else map.setView([20, 0], 2);
  const mark = () => { const c = map.getCenter().wrap(); el.dataset.zoom = String(map.getZoom()); el.dataset.center = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`; };
  map.on("zoomend moveend", mark); mark(); // read by the browser tests (the first view must be the shipment, not the world)
  // the view follows the shipment until the visitor actually handles the map (pointer, wheel or keys on the map itself;
  // the map's own buttons don't count). Leaflet's zoomstart/dragstart also fire for resizes and fits, so they aren't used.
  let destroyed = false; let userMoved = false;
  const handled = (e) => { if (!e.target.closest?.(".leaflet-control")) userMoved = true; };
  for (const t of ["pointerdown", "wheel", "keydown"]) el.addEventListener(t, handled, { passive: true });
  let lastBounds = null; let lastSig = "";
  const layers = { origin: null, dest: null, current: null, travelled: null, remaining: null, trail: L.layerGroup().addTo(map) };
  const css = (name, d) => getComputedStyle(el).getPropertyValue(name).trim() || d;
  const colors = () => ({ line: css("--hx-map-line", "#2563eb"), dash: css("--hx-map-dash", "#64748b"), trail: css("--hx-map-line", "#2563eb"), trailFill: css("--hx-map-sea", "#fff") });

  // base layer: themed outline (default) or street tiles
  let outline = null; let outlineFailed = false;
  function outlineStyle() { return { color: css("--hx-map-border", "#3a5e9e"), weight: 0.8, fillColor: css("--hx-map-land", "#17305e"), fillOpacity: 1, interactive: false }; }
  // its own SVG renderer below the markers (a shared canvas could stay blank after a zero-size start), and three copies
  // of the world so routes unwrapped across the date line always have land under them
  const outlineRenderer = L.svg({ pane: "tilePane", padding: 0.5 });
  async function showOutline() {
    el.classList.add("hx-base-outline"); el.classList.remove("hx-base-street");
    if (outline) { outline.addTo(map); return; }
    try {
      const fc = unwrap(await loadCountries()); if (destroyed) return;
      const shifted = (dx) => fc.features.map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: shift(f.geometry, dx) } }));
      outline = L.geoJSON({ type: "FeatureCollection", features: [...shifted(-360), ...shifted(0), ...shifted(360)] },
        { style: outlineStyle, interactive: false, renderer: outlineRenderer }).addTo(map);
      el.dataset.outline = "ready";
    } catch { outlineFailed = true; setStreet(true); }
  }

  // tile provider fallback chain (Safari/iOS-safe pattern kept from the previous implementation)
  const chain = providers(cfg); let tileLoaded = false; let active = null; let timer = null; let streetOn = false;
  function tryProvider(i) {
    if (destroyed || !streetOn) return;
    if (i >= chain.length) {
      if (!tileLoaded) {
        if (!outlineFailed) { setStreet(false); onStatus?.("street-unavailable"); return; } // the outline map stays usable
        el.classList.add("hx-map-notile"); onStatus?.("tiles-unavailable");
      }
      return;
    }
    if (active) { try { map.removeLayer(active); } catch { /* ignore */ } }
    let errors = 0; let switched = false;
    active = L.tileLayer(chain[i].url, chain[i].options).addTo(map);
    const next = () => { if (switched || tileLoaded || destroyed) return; switched = true; tryProvider(i + 1); };
    active.on("tileload", () => { if (!tileLoaded) { tileLoaded = true; clearTimeout(timer); el.classList.remove("hx-map-notile"); onStatus?.("tiles-ok"); } });
    active.on("tileerror", () => { errors += 1; if (errors >= 3) next(); });
    clearTimeout(timer); timer = setTimeout(next, 6000);
  }
  let streetBtn = null;
  function setStreet(on) {
    streetOn = on; streetBtn?.setAttribute("aria-pressed", String(on)); if (streetBtn) streetBtn.textContent = on ? "Outline map" : "Street map";
    if (on) {
      if (outline) map.removeLayer(outline);
      el.classList.add("hx-base-street"); el.classList.remove("hx-base-outline");
      tileLoaded = false; tryProvider(0);
    } else {
      clearTimeout(timer); if (active) { try { map.removeLayer(active); } catch { /* ignore */ } active = null; }
      el.classList.remove("hx-map-notile"); showOutline();
    }
  }
  const onTheme = () => { outline?.setStyle(outlineStyle()); restyle(); map.invalidateSize(); };
  document.addEventListener("hx-theme", onTheme);

  // interaction gating (wheel zoom after click; drag after tap on touch devices)
  const wake = () => {
    if (!map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
    if (touch && !map.dragging.enabled()) map.dragging.enable();
    el.classList.add("hx-map-awake");
  };
  map.on("click focus", wake);
  map.on("mouseout", () => { if (!touch) map.scrollWheelZoom.disable(); });
  if (interactiveHint) {
    const hint = L.DomUtil.create("div", "hx-map-hint", el);
    hint.textContent = touch ? "Tap the map to move around" : "Click the map to zoom with the scroll wheel";
    setTimeout(() => hint.classList.add("is-gone"), 6000); // it explains the gesture once, then gets out of the way
  }

  const markerIcon = (cls, label, mode) => L.divIcon({ className: "hx-marker-wrap",
    html: mode && MODE_ICON[mode] ? `<span class="hx-marker hx-m-mode ${cls}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${MODE_ICON[mode]}</svg></span>` : `<span class="hx-marker ${cls}" aria-label="${label}"></span>`,
    iconSize: mode ? [34, 34] : [22, 22], iconAnchor: mode ? [17, 17] : [11, 11], popupAnchor: [0, -14] });

  // custom controls
  const Ctl = L.Control.extend({
    options: { position: small() ? "bottomright" : "topright" },
    onAdd() {
      const box = L.DomUtil.create("div", `hx-map-ctl${small() ? " is-row" : ""}`);
      const mk = (text, title, fn) => { const b = L.DomUtil.create("button", "", box); b.type = "button"; b.textContent = text; b.title = title; b.setAttribute("aria-label", title); L.DomEvent.on(b, "click", (e) => { L.DomEvent.stop(e); fn(); }); return b; };
      mk("Fit route", "Fit the entire route", () => fit());
      mk("Locate", "Center on the shipment's latest recorded position", () => locate());
      streetBtn = mk("Street map", "Switch between the outline map and the street map", () => setStreet(!streetOn));
      streetBtn.setAttribute("aria-pressed", "false");
      L.DomEvent.disableClickPropagation(box);
      return box;
    }
  });
  map.addControl(new Ctl());

  function fit() {
    if (!lastBounds || !lastBounds.isValid() || !hasSize()) return;
    map.invalidateSize();
    if (lastBounds.getNorthEast().equals(lastBounds.getSouthWest())) map.setView(lastBounds.getCenter(), 5, { animate: false });
    else map.fitBounds(lastBounds, { ...pad(), maxZoom: 9, animate: false });
    userMoved = false;
  }
  function locate() {
    // only a recorded location can be "located"; without one the route is framed and the note says so
    if (!layers.current) { fit(); onStatus?.("no-current"); return; }
    const target = layers.current.getLatLng();
    userMoved = true; // the visitor chose this view: automatic re-framing must not pull it back to the whole route
    if (reducedMotion()) map.setView(target, Math.max(map.getZoom(), 6), { animate: false });
    else map.flyTo(target, Math.max(map.getZoom(), 6), { duration: 0.5 });
    layers.current.openPopup();
  }

  function placeMarker(key, ll, cls, label, popup, z = 0, tag = "", mode = null) {
    if (!ll) { if (layers[key]) { map.removeLayer(layers[key]); layers[key] = null; } return; }
    // updates are idempotent: the icon is only replaced when it changes and a label is bound once, then only re-worded
    const iconKey = `${cls}|${mode || ""}`;
    if (!layers[key]) { layers[key] = L.marker(ll, { icon: markerIcon(cls, label, mode), keyboard: true, title: label, zIndexOffset: z }).addTo(map); layers[key]._hxIcon = iconKey; }
    else { layers[key].setLatLng(ll); if (layers[key]._hxIcon !== iconKey) { layers[key].setIcon(markerIcon(cls, label, mode)); layers[key]._hxIcon = iconKey; } }
    layers[key].bindPopup(popup);
    // phones: labels sit above their marker (side labels would run off a narrow map); wider screens: beside it
    const side = small() ? { direction: "top", offset: [0, -14] } : { direction: key === "dest" ? "left" : "right", offset: [key === "dest" ? -12 : 12, 0] };
    const tip = layers[key].getTooltip();
    if (!tag) { if (tip) layers[key].unbindTooltip(); }
    else if (tip) { if (tip.getContent() !== tag) layers[key].setTooltipContent(tag); }
    else layers[key].bindTooltip(tag, { permanent: true, ...side, className: `hx-map-label k-${key}` });
  }
  const styles = {};
  function placeLine(key, pts, style) {
    if (!pts || pts.length < 2) { if (layers[key]) { map.removeLayer(layers[key]); layers[key] = null; } return; }
    styles[key] = style;
    if (!layers[key]) layers[key] = L.polyline(pts, style()).addTo(map);
    else { layers[key].setLatLngs(pts); layers[key].setStyle(style()); }
  }
  function restyle() { for (const k of ["travelled", "remaining"]) if (layers[k] && styles[k]) layers[k].setStyle(styles[k]()); layers.trail.eachLayer((m) => m.setStyle?.({ color: colors().trail, fillColor: colors().trailFill })); }

  function update(data) {
    if (destroyed || !data) return;
    // route order, unwrapped across the date line, so markers and lines sit on one copy of the world
    const raw = (data.trail || []).map((t) => ({ ...t, ll: ll(t) })).filter((t) => t.ll);
    const seq = unwrapRoute([ll(data.origin), ...raw.map((t) => t.ll), ll(data.current), ll(data.destination)]);
    const o = seq[0]; const d = seq[seq.length - 1]; const c = seq[seq.length - 2];
    const trail = raw.map((t, i) => ({ ...t, ll: seq[1 + i] }));
    const pts = [];

    const short = (s) => String(s || "").split(",")[0].trim();
    const city = (p) => (p?.approx ? "Shown at city level" : null);
    const atOrigin = samePt(o, c); // still at the origin: one label for both markers, so neither hides the other
    placeMarker("origin", o, "hx-m-origin", "Origin", popupNode("Origin", [data.originLabel, city(data.origin)]), 0, atOrigin ? "" : data.originLabel ? `Origin · ${short(data.originLabel)}` : "Origin");
    placeMarker("dest", d, "hx-m-dest", "Destination", popupNode("Destination", [data.destinationLabel, city(data.destination)]), 0, data.destinationLabel ? `Destination · ${short(data.destinationLabel)}` : "Destination");
    const cur = data.current;
    const approx = cur && !cur.sourceLabel; // admin-recorded places are geocoded to city level
    placeMarker("current", c, `hx-m-current hx-state-${cur?.state || "last"}${cur?.approx ? " is-approx" : ""}`, "Latest recorded location",
      popupNode(cur?.state === "live" ? "Current location (live)" : "Latest recorded location", [
        cur?.name, approx ? "Approximate location (city level)" : null,
        cur?.at ? `Recorded ${fmt(cur.at)}` : null,
        cur?.updatedAt ? `Reported ${fmt(cur.updatedAt)}` : null, // the tracker passes a time only for GPS / carrier positions
        cur?.sourceLabel ? `Source: ${cur.sourceLabel}` : null, cur?.state && cur.state !== "live" ? STATE_LABEL[cur.state] : null
      ]), 1000, atOrigin ? "Origin · latest" : `${cur?.state === "live" ? "Now" : "Latest"}${cur?.name ? ` · ${short(cur.name)}` : ""}`, data.mode || null);

    // travelled path: origin -> recorded points (in time order) -> current
    const travelled = [];
    const push = (ll) => { if (ll && !samePt(travelled[travelled.length - 1], ll)) travelled.push(ll); };
    push(o); trail.forEach((t) => push(t.ll)); push(c);
    placeLine("travelled", travelled, () => ({ color: colors().line, weight: 4, opacity: 0.95 }));
    const from = c || (trail.length ? trail[trail.length - 1].ll : o);
    placeLine("remaining", from && d && !samePt(from, d) ? curve(from, d) : null, () => ({ color: colors().dash, weight: 2.5, opacity: 0.9, dashArray: "6 9" }));

    layers.trail.clearLayers();
    trail.forEach((t) => {
      if (samePt(t.ll, c)) return;
      L.circleMarker(t.ll, { radius: 4, color: colors().trail, weight: 2, fillColor: colors().trailFill, fillOpacity: 1 })
        .bindPopup(popupNode(t.name || "Recorded position", [t.timestamp ? fmt(t.timestamp) : null])).addTo(layers.trail);
    });

    [o, d, c, ...trail.map((t) => t.ll)].forEach((ll) => ll && pts.push(ll));
    lastBounds = pts.length ? L.latLngBounds(pts) : null;
    const sig = JSON.stringify([o, d, c, trail.length]);
    map.invalidateSize();
    // new or moved points re-frame the map, unless the visitor is exploring it (a new shipment always re-frames)
    if (lastBounds && sig !== lastSig && (!userMoved || !lastSig)) fit();
    lastSig = sig;
    el.dataset.points = String(pts.length); el.dataset.latest = c ? `${c[0].toFixed(2)},${(((c[1] + 540) % 360) - 180).toFixed(2)}` : "";
  }

  // sizing: Safari/iOS settle late and hidden containers start at 0×0, so re-measure, and re-frame while the visitor
  // hasn't handled the map (first layout, orientation change, window resize)
  let raf = 0;
  const refit = () => { raf = 0; if (destroyed) return; map.invalidateSize(); if (!userMoved) fit(); };
  const later = () => { if (!raf) raf = requestAnimationFrame(refit); };
  setTimeout(later, 200); setTimeout(later, 600);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(later) : null;
  ro?.observe(el);
  addEventListener("orientationchange", later);

  setStreet(!!street);
  if (initial) update(initial);

  return {
    update, fit, leaflet: map, setStreet,
    destroy() {
      destroyed = true; clearTimeout(timer); ro?.disconnect(); document.removeEventListener("hx-theme", onTheme); removeEventListener("orientationchange", later);
      if (raf) cancelAnimationFrame(raf);
      try { map.remove(); } catch { /* ignore */ }
    }
  };
}
