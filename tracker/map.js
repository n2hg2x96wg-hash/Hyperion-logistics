// Live map (Leaflet + tile providers, loaded lazily). Renders only legitimately recorded coordinates.
// No API keys live here: the tile chain (OpenStreetMap by default, or a keyed provider set via env) comes from /api/config.
// Layers are created once and moved in place on updates, so new positions never rebuild the map.
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

/** Creates a map inside `el`. Returns { update(mapData), fit(), destroy() }. Rejects if Leaflet cannot be loaded. */
export async function createMap(el, { onStatus, interactiveHint = true } = {}) {
  const [L, cfg] = await Promise.all([loadLeaflet(), loadConfig()]);
  const touch = !!L.Browser.mobile;
  // Page scrolling must win over the map: wheel zoom waits for a click, one-finger drag waits for a tap on touch screens.
  const map = L.map(el, { zoomControl: true, preferCanvas: true, worldCopyJump: true, minZoom: 2, scrollWheelZoom: false, dragging: !touch, tap: false })
    .setView([20, 0], 2);
  let destroyed = false; let userMoved = false; let programmatic = 0;
  let lastBounds = null; let lastSig = "";
  const layers = { origin: null, dest: null, current: null, travelled: null, remaining: null, trail: L.layerGroup().addTo(map) };

  // tile provider fallback chain (Safari/iOS-safe pattern kept from the previous implementation)
  const chain = providers(cfg); let tileLoaded = false; let active = null; let timer = null;
  function tryProvider(i) {
    if (destroyed) return;
    if (i >= chain.length) { if (!tileLoaded) { el.classList.add("hx-map-notile"); onStatus?.("tiles-unavailable"); } return; }
    if (active) { try { map.removeLayer(active); } catch { /* ignore */ } }
    let errors = 0; let switched = false;
    active = L.tileLayer(chain[i].url, chain[i].options).addTo(map);
    const next = () => { if (switched || tileLoaded || destroyed) return; switched = true; tryProvider(i + 1); };
    active.on("tileload", () => { if (!tileLoaded) { tileLoaded = true; clearTimeout(timer); el.classList.remove("hx-map-notile"); onStatus?.("tiles-ok"); } });
    active.on("tileerror", () => { errors += 1; if (errors >= 3) next(); });
    clearTimeout(timer); timer = setTimeout(next, 6000);
  }
  tryProvider(0);

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
  }

  const markerIcon = (cls, label) => L.divIcon({ className: "hx-marker-wrap", html: `<span class="hx-marker ${cls}" aria-label="${label}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] });

  // custom controls
  const Ctl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const box = L.DomUtil.create("div", "hx-map-ctl");
      const mk = (text, title, fn) => { const b = L.DomUtil.create("button", "", box); b.type = "button"; b.textContent = text; b.title = title; b.setAttribute("aria-label", title); L.DomEvent.on(b, "click", (e) => { L.DomEvent.stop(e); fn(); }); return b; };
      mk("Fit route", "Fit the entire route", () => fit());
      mk("Locate", "Center on the shipment's latest recorded position", () => locate());
      L.DomEvent.disableClickPropagation(box);
      return box;
    }
  });
  map.addControl(new Ctl());

  const settle = () => setTimeout(() => { programmatic = Math.max(0, programmatic - 1); }, 700);
  function fit() {
    if (!lastBounds || !lastBounds.isValid()) return;
    programmatic++;
    if (lastBounds.getNorthEast().equals(lastBounds.getSouthWest())) map.setView(lastBounds.getCenter(), 7, { animate: false });
    else map.fitBounds(lastBounds, { padding: [40, 40], maxZoom: 9, animate: false });
    settle(); userMoved = false;
  }
  function locate() {
    const target = layers.current?.getLatLng() || (lastBounds?.isValid() ? lastBounds.getCenter() : null);
    if (!target) return;
    programmatic++;
    if (reducedMotion()) map.setView(target, Math.max(map.getZoom(), 7), { animate: false });
    else map.flyTo(target, Math.max(map.getZoom(), 7), { duration: 0.6 });
    settle();
    layers.current?.openPopup();
  }
  map.on("dragstart zoomstart", () => { if (!programmatic) userMoved = true; });

  function placeMarker(key, ll, cls, label, popup, z = 0) {
    if (!ll) { if (layers[key]) { map.removeLayer(layers[key]); layers[key] = null; } return; }
    if (!layers[key]) layers[key] = L.marker(ll, { icon: markerIcon(cls, label), keyboard: true, title: label, zIndexOffset: z }).addTo(map);
    else { layers[key].setLatLng(ll); layers[key].setIcon(markerIcon(cls, label)); }
    layers[key].bindPopup(popup);
  }
  function placeLine(key, pts, style) {
    if (!pts || pts.length < 2) { if (layers[key]) { map.removeLayer(layers[key]); layers[key] = null; } return; }
    if (!layers[key]) layers[key] = L.polyline(pts, style).addTo(map);
    else layers[key].setLatLngs(pts);
  }

  function update(data) {
    if (destroyed || !data) return;
    const o = data.origin ? [data.origin.lat, data.origin.lng] : null;
    const d = data.destination ? [data.destination.lat, data.destination.lng] : null;
    const c = data.current ? [data.current.lat, data.current.lng] : null;
    const trail = (data.trail || []).map((t) => ({ ...t, ll: [t.lat, t.lng] }));
    const pts = [];

    placeMarker("origin", o, "hx-m-origin", "Origin", popupNode("Origin", [data.originLabel]));
    placeMarker("dest", d, "hx-m-dest", "Destination", popupNode("Destination", [data.destinationLabel]));
    const cur = data.current;
    placeMarker("current", c, `hx-m-current hx-state-${cur?.state || "last"}`, "Current location",
      popupNode(cur?.state === "live" ? "Current location (live)" : "Last recorded location", [
        cur?.name, cur?.updatedAt ? `Recorded ${fmt(cur.updatedAt)}` : "Time of this position is unknown",
        cur?.sourceLabel ? `Source: ${cur.sourceLabel}` : null, cur?.state && cur.state !== "live" ? STATE_LABEL[cur.state] : null
      ]), 1000);

    // travelled path: origin -> recorded points (in time order) -> current
    const travelled = [];
    const push = (ll) => { if (ll && !samePt(travelled[travelled.length - 1], ll)) travelled.push(ll); };
    push(o); trail.forEach((t) => push(t.ll)); push(c);
    placeLine("travelled", travelled, { color: "#2563eb", weight: 4, opacity: 0.9 });
    const from = c || (trail.length ? trail[trail.length - 1].ll : o);
    placeLine("remaining", from && d && !samePt(from, d) ? [from, d] : null, { color: "#64748b", weight: 3, opacity: 0.85, dashArray: "6 9" });

    layers.trail.clearLayers();
    trail.forEach((t) => {
      if (samePt(t.ll, c)) return;
      L.circleMarker(t.ll, { radius: 4, color: "#2563eb", weight: 2, fillColor: "#fff", fillOpacity: 1 })
        .bindPopup(popupNode(t.name || "Recorded position", [t.timestamp ? fmt(t.timestamp) : null])).addTo(layers.trail);
    });

    [o, d, c, ...trail.map((t) => t.ll)].forEach((ll) => ll && pts.push(ll));
    lastBounds = pts.length ? L.latLngBounds(pts) : null;
    const sig = JSON.stringify([o, d, c, trail.length]);
    if (lastBounds && sig !== lastSig && (!userMoved || !lastSig)) fit(); // never yank the view while the user is exploring
    lastSig = sig;
    map.invalidateSize();
  }

  // iOS Safari / hidden-container sizing: chain + observer
  map.invalidateSize();
  setTimeout(() => !destroyed && map.invalidateSize(), 200);
  setTimeout(() => !destroyed && map.invalidateSize(), 600);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => !destroyed && map.invalidateSize()) : null;
  ro?.observe(el);

  return {
    update, fit, leaflet: map,
    destroy() {
      destroyed = true; clearTimeout(timer); ro?.disconnect();
      try { map.remove(); } catch { /* ignore */ }
    }
  };
}
