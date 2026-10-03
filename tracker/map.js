// Live map (Leaflet + tile providers, loaded lazily). Renders only legitimately recorded coordinates.
// No API keys live here: an optional custom tile URL (e.g. a URL-restricted Mapbox token) comes from /api/config (env).
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
function providers(cfg) {
  const list = [];
  if (cfg?.map?.tileUrl) list.push({ url: cfg.map.tileUrl, options: { attribution: cfg.map.attribution || "", maxZoom: cfg.map.maxZoom || 19 } });
  list.push(
    { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", options: { attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`, subdomains: "abcd", maxZoom: 19 } },
    { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", options: { attribution: OSM_ATTR, maxZoom: 19 } },
    { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", options: { attribution: "Tiles &copy; Esri", maxZoom: 19 } }
  );
  return list;
}

const fmt = (iso) => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };

function popupNode(title, lines) {
  const el = document.createElement("div"); el.className = "hx-popup";
  const h = document.createElement("strong"); h.textContent = title; el.appendChild(h);
  for (const line of lines.filter(Boolean)) { const p = document.createElement("div"); p.textContent = line; el.appendChild(p); }
  return el;
}

/** Creates a map inside `el`. Returns { update(mapData), destroy() }. Rejects if Leaflet cannot be loaded. */
export async function createMap(el, { onStatus } = {}) {
  const [L, cfg] = await Promise.all([loadLeaflet(), loadConfig()]);
  const map = L.map(el, { zoomControl: true, preferCanvas: true, worldCopyJump: true, minZoom: 2 }).setView([20, 0], 2);
  let destroyed = false; let userMoved = false; let programmatic = 0; let layers = L.layerGroup().addTo(map);
  let currentMarker = null; let lastBounds = null;

  // tile provider fallback chain (Safari/iOS-safe pattern kept from the previous implementation)
  const chain = providers(cfg); let idx = 0; let tileLoaded = false; let active = null; let timer = null;
  function tryProvider(i) {
    if (destroyed) return;
    if (i >= chain.length) { if (!tileLoaded) { el.classList.add("hx-map-notile"); onStatus?.("tiles-unavailable"); } return; }
    if (active) { try { map.removeLayer(active); } catch { /* ignore */ } }
    idx = i; let errors = 0; let switched = false;
    active = L.tileLayer(chain[i].url, chain[i].options).addTo(map);
    const next = () => { if (switched || tileLoaded || destroyed) return; switched = true; tryProvider(i + 1); };
    active.on("tileload", () => { if (!tileLoaded) { tileLoaded = true; el.classList.remove("hx-map-notile"); onStatus?.("tiles-ok"); } });
    active.on("tileerror", () => { errors += 1; if (errors >= 3) next(); });
    clearTimeout(timer); timer = setTimeout(next, 4500);
  }
  tryProvider(0);

  const markerIcon = (cls, label) => L.divIcon({ className: "hx-marker-wrap", html: `<span class="hx-marker ${cls}" aria-label="${label}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] });

  // custom controls
  const Ctl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const box = L.DomUtil.create("div", "hx-map-ctl");
      const mk = (text, title, fn) => { const b = L.DomUtil.create("button", "", box); b.type = "button"; b.textContent = text; b.title = title; b.setAttribute("aria-label", title); L.DomEvent.on(b, "click", (e) => { L.DomEvent.stop(e); fn(); }); return b; };
      mk("Fit route", "Fit entire route", () => fit());
      mk("Locate", "Center on shipment", () => { if (currentMarker) { programmatic++; map.flyTo(currentMarker.getLatLng(), Math.max(map.getZoom(), 7), { duration: 0.6 }); setTimeout(() => programmatic--, 800); } });
      L.DomEvent.disableClickPropagation(box);
      return box;
    }
  });
  map.addControl(new Ctl());

  function fit() {
    if (!lastBounds || !lastBounds.isValid()) return;
    programmatic++;
    map.fitBounds(lastBounds, { padding: [36, 36], maxZoom: 9, animate: false });
    setTimeout(() => { programmatic = Math.max(0, programmatic - 1); }, 50);
    userMoved = false;
  }
  map.on("dragstart zoomstart", () => { if (!programmatic) userMoved = true; });

  function update(data) {
    if (destroyed || !data) return;
    layers.clearLayers(); currentMarker = null;
    const pts = [];
    const o = data.origin; const d = data.destination; const c = data.current;
    if (o) { L.marker([o.lat, o.lng], { icon: markerIcon("hx-m-origin", "Origin"), keyboard: true, title: "Origin" }).bindPopup(popupNode("Origin", [data.originLabel])).addTo(layers); pts.push([o.lat, o.lng]); }
    if (d) { L.marker([d.lat, d.lng], { icon: markerIcon("hx-m-dest", "Destination"), keyboard: true, title: "Destination" }).bindPopup(popupNode("Destination", [data.destinationLabel])).addTo(layers); pts.push([d.lat, d.lng]); }
    const travelled = [];
    if (o) travelled.push([o.lat, o.lng]);
    for (const t of data.trail || []) {
      const ll = [t.lat, t.lng];
      if (!travelled.length || travelled[travelled.length - 1][0] !== ll[0] || travelled[travelled.length - 1][1] !== ll[1]) travelled.push(ll);
    }
    if (c) {
      const ll = [c.lat, c.lng]; const last = travelled[travelled.length - 1];
      if (!last || last[0] !== ll[0] || last[1] !== ll[1]) travelled.push(ll);
      pts.push(ll);
      currentMarker = L.marker(ll, { icon: markerIcon("hx-m-current", "Current location"), zIndexOffset: 1000, keyboard: true, title: "Current location" })
        .bindPopup(popupNode("Current location", [c.name, c.updatedAt ? `Updated ${fmt(c.updatedAt)}` : null, c.sourceLabel ? `Source: ${c.sourceLabel}` : null])).addTo(layers);
    }
    (data.trail || []).forEach((t) => { pts.push([t.lat, t.lng]); L.circleMarker([t.lat, t.lng], { radius: 3, color: "#3b82f6", weight: 1, fillColor: "#fff", fillOpacity: 1 }).bindPopup(popupNode(t.name || "Recorded position", [t.timestamp ? fmt(t.timestamp) : null])).addTo(layers); });
    if (travelled.length > 1) L.polyline(travelled, { color: "#3b82f6", weight: 4, opacity: 0.9 }).addTo(layers);
    const from = c ? [c.lat, c.lng] : (o ? [o.lat, o.lng] : null);
    if (from && d) L.polyline([from, [d.lat, d.lng]], { color: "#94a3b8", weight: 3, opacity: 0.8, dashArray: "6 9" }).addTo(layers);
    lastBounds = pts.length ? L.latLngBounds(pts) : null;
    if (!userMoved && lastBounds) {
      if (pts.length === 1) { programmatic++; map.setView(pts[0], 7, { animate: false }); setTimeout(() => { programmatic = Math.max(0, programmatic - 1); }, 50); }
      else fit();
    }
    map.invalidateSize();
  }

  // iOS Safari / hidden-container sizing: chain + observer
  map.invalidateSize();
  setTimeout(() => !destroyed && map.invalidateSize(), 200);
  setTimeout(() => !destroyed && map.invalidateSize(), 600);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => !destroyed && map.invalidateSize()) : null;
  ro?.observe(el);

  return {
    update,
    destroy() {
      destroyed = true; clearTimeout(timer); ro?.disconnect();
      try { map.remove(); } catch { /* ignore */ }
    }
  };
}
