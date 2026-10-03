// PUBLIC, non-secret client configuration (map tiles). Tile URLs may embed a *public* map token
// (e.g. a URL-restricted Mapbox token) which is set via env, never hard-coded in the repository.
import { send } from "./_lib/http.js";

export default function handler(req, res) {
  const tileUrl = process.env.MAP_TILE_URL || null;
  send(res, 200, {
    map: {
      tileUrl,
      attribution: process.env.MAP_TILE_ATTRIBUTION || null,
      maxZoom: Number(process.env.MAP_TILE_MAX_ZOOM) || 19
    },
    realtime: { sse: process.env.REALTIME_SSE !== "off", pollMs: Number(process.env.CLIENT_POLL_MS) || 20000 }
  }, { "Cache-Control": "public, max-age=300" });
}
