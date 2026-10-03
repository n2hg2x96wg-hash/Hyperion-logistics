// Small helpers shared by all serverless handlers (Vercel-compatible req/res).
export async function readRawBody(req, limit = 256 * 1024) {
  if (req.rawBody != null) return req.rawBody;
  if (req.body != null && typeof req.body === "string") return req.body;
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return JSON.stringify(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await readRawBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Best-effort per-instance rate limiter (serverless instances are ephemeral; this is
// a speed bump against enumeration, not a hard guarantee).
const buckets = new Map();
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  return { ok: b.count <= limit, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
}
export function resetRateLimit(key) { buckets.delete(key); }
