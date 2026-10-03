// PUBLIC, non-secret client configuration (map tiles, realtime). Tile URLs may embed a *public*, domain-restricted
// map key (MAP_TILE_KEY) which is set via env, never hard-coded in the repository. See api/_lib/map-config.js.
import { send } from "./_lib/http.js";
import { resolveMapConfig } from "./_lib/map-config.js";

export default function handler(req, res) {
  const map = resolveMapConfig();
  const first = map.tiles[0];
  send(res, 200, {
    map: {
      provider: map.primary,
      tiles: map.tiles,
      // kept for older clients
      tileUrl: map.primary === "osm" ? null : first.url,
      attribution: first.attribution,
      maxZoom: first.maxZoom
    },
    realtime: { sse: process.env.REALTIME_SSE !== "off", pollMs: Number(process.env.CLIENT_POLL_MS) || 20000 }
  }, { "Cache-Control": "public, max-age=300" });
}
