// Map tile configuration (server side). The browser receives only PUBLIC tile URLs.
//
// Default: OpenStreetMap standard tiles (no key, attribution required). The old CARTO basemap was removed
// from the default chain because it can return "API key required"/watermarked tiles that still "load", so
// the fallback never kicked in and clients saw a broken map.
//
// Optional production providers (set in the server environment, never in source):
//   MAP_PROVIDER=maptiler|stadia|mapbox  + MAP_TILE_KEY=<public, domain-restricted key>
//   or MAP_TILE_URL=<any XYZ template>    (may contain {key}, replaced with MAP_TILE_KEY) + MAP_TILE_ATTRIBUTION
// A keyed provider that rejects its key produces tile errors, and the browser falls back to OpenStreetMap.

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const MAP_PRESETS = Object.freeze({
  osm: { label: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR, maxZoom: 19, needsKey: false },
  maptiler: {
    label: "MapTiler Streets", url: "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}",
    attribution: `<a href="https://www.maptiler.com/copyright/">&copy; MapTiler</a> ${OSM_ATTR}`, maxZoom: 20, needsKey: true
  },
  stadia: {
    label: "Stadia Maps", url: "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key={key}",
    attribution: `&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ${OSM_ATTR}`, maxZoom: 20, needsKey: true
  },
  mapbox: {
    label: "Mapbox Streets", url: "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token={key}",
    attribution: `&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> ${OSM_ATTR}`, maxZoom: 20, needsKey: true
  }
});

// Last-resort key-free fallback (kept from the previous implementation).
const ESRI = { label: "Esri World Street Map", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxZoom: 19 };

const tile = ({ label, url, attribution, maxZoom }) => ({ label, url, attribution, maxZoom });

/** Resolves the tile chain from the environment. `issues` lists misconfigurations (never secret values). */
export function resolveMapConfig(env = process.env) {
  const issues = [];
  const key = (env.MAP_TILE_KEY || "").trim();
  const maxZoom = Number(env.MAP_TILE_MAX_ZOOM) || null;
  const chain = [];
  let primary = "osm";

  if (env.MAP_TILE_URL) {
    const url = String(env.MAP_TILE_URL).trim();
    if (!/^https:\/\//i.test(url) || !/\{z\}/.test(url) || !/\{x\}/.test(url) || !/\{y\}/.test(url)) issues.push("MAP_TILE_URL must be an https URL containing {z}, {x} and {y}");
    else if (url.includes("{key}") && !key) issues.push("MAP_TILE_URL contains {key} but MAP_TILE_KEY is not set");
    else {
      chain.push({ label: "Custom tile server", url: url.replace("{key}", encodeURIComponent(key)), attribution: env.MAP_TILE_ATTRIBUTION || OSM_ATTR, maxZoom: maxZoom || 19 });
      primary = "custom";
    }
  } else if (env.MAP_PROVIDER && env.MAP_PROVIDER !== "osm") {
    const preset = MAP_PRESETS[String(env.MAP_PROVIDER).toLowerCase()];
    if (!preset) issues.push(`Unknown MAP_PROVIDER "${String(env.MAP_PROVIDER).slice(0, 20)}" (use maptiler, stadia, mapbox or osm)`);
    else if (preset.needsKey && !key) issues.push(`MAP_PROVIDER=${env.MAP_PROVIDER} needs MAP_TILE_KEY`);
    else {
      chain.push({ ...tile(preset), url: preset.url.replace("{key}", encodeURIComponent(key)), maxZoom: maxZoom || preset.maxZoom });
      primary = String(env.MAP_PROVIDER).toLowerCase();
    }
  }
  chain.push(tile(MAP_PRESETS.osm), tile(ESRI));
  return { primary, label: chain[0].label, tiles: chain, issues, keyConfigured: !!key };
}
