// Courier / GPS ingestion webhook: POST /api/provider?provider=<id>
// Authenticated with a per-provider shared secret (HMAC). Raw body is required for signature verification.
import { readRawBody, send, clientIp, rateLimit } from "./_lib/http.js";
import { getProvider } from "./_lib/providers/index.js";
import { ingestProviderUpdates } from "./_lib/provider-ingest.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  const url = new URL(req.url, "http://localhost");
  const adapter = getProvider(url.searchParams.get("provider"));
  if (!adapter) return send(res, 404, { error: "unknown_provider" });
  if (!rateLimit(`prov:${clientIp(req)}`, { limit: 120, windowMs: 60_000 }).ok) return send(res, 429, { error: "rate_limited" });
  try {
    const raw = await readRawBody(req, 512 * 1024);
    if (!adapter.verify(raw, req)) return send(res, 401, { error: "unauthorized" });
    const results = await ingestProviderUpdates(adapter, adapter.normalize(JSON.parse(raw || "{}")));
    return send(res, 200, { results });
  } catch (err) {
    if (err instanceof SyntaxError) return send(res, 400, { error: "invalid_json" });
    console.error("[provider] failure", err?.message);
    return send(res, err.status || 500, { error: "failed" });
  }
}
