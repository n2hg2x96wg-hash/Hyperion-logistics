// PUBLIC homepage data: GET /api/public?view=overview | carriers
// overview  -> real statistics, opted-in shipment routes (masked, city-level) and their recent public events
// carriers  -> active carrier directory without contact emails, API endpoints or internal notes
// Short shared cache (in-instance + CDN) keeps this cheap; see api/_lib/public-view.js for privacy rules.
import { send, clientIp, rateLimit } from "./_lib/http.js";
import { getStore } from "./_lib/store/index.js";
import { buildPublicOverview } from "./_lib/public-view.js";
import { publicCarriers } from "./_lib/couriers.js";

const TTL_MS = 30_000;
const cache = new Map();
const CACHE_HEADERS = { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" };

async function overview() {
  const store = await getStore();
  const [summaries, publicShipments] = await Promise.all([store.scanShipmentSummaries(), store.listPublicShipments(100)]);
  const candidates = publicShipments.filter((s) => s.archived !== true).slice(0, 50);
  const eventsByCode = new Map(await Promise.all(candidates.map(async (s) => [s.id, await store.listEvents(s.id, 10)])));
  return buildPublicOverview({ summaries, publicShipments: candidates, eventsByCode });
}

const VIEWS = { overview, carriers: async () => ({ carriers: await publicCarriers(), generatedAt: new Date().toISOString() }) };

export function __clearPublicCache() { cache.clear(); }

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
  const view = new URL(req.url, "http://localhost").searchParams.get("view") || "overview";
  if (!VIEWS[view]) return send(res, 400, { error: "unknown_view" });
  const rl = rateLimit(`public:${clientIp(req)}`, { limit: 120, windowMs: 60_000 });
  if (!rl.ok) return send(res, 429, { error: "rate_limited" }, { "Retry-After": String(rl.retryAfter) });
  const hit = cache.get(view);
  if (hit && Date.now() - hit.at < TTL_MS) return send(res, 200, hit.body, CACHE_HEADERS);
  try {
    const body = await VIEWS[view]();
    cache.set(view, { at: Date.now(), body });
    return send(res, 200, body, CACHE_HEADERS);
  } catch (err) {
    console.error("[public] failure", view, err?.message);
    if (hit) return send(res, 200, { ...hit.body, stale: true }, CACHE_HEADERS); // keep last good data
    return send(res, 503, { error: "unavailable", message: "Live activity is temporarily unavailable." });
  }
}
