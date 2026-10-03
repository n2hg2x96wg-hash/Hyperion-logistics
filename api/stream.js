// PUBLIC realtime channel (Server-Sent Events): GET /api/stream?code=XXXX
// One connection is bound to exactly ONE tracking code and always emits the visibility-filtered client view,
// so a subscriber can never receive another shipment's data. The function closes itself before the platform
// time limit; EventSource reconnects automatically. Clients fall back to polling /api/track on repeated failure.
import { clientIp, rateLimit, send } from "./_lib/http.js";
import { normalizeTrackingCode } from "./_lib/validate.js";
import { getStore } from "./_lib/store/index.js";
import { buildViewFor } from "./_lib/service.js";
import { shipmentVersion } from "./_lib/client-view.js";

const MAX_MS = Number(process.env.STREAM_MAX_MS) || 50_000;
const open = new Map(); // ip -> count (simple per-instance cap)

export default async function handler(req, res) {
  if (process.env.REALTIME_SSE === "off") return send(res, 503, { error: "sse_disabled" });
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
  const ip = clientIp(req);
  const url = new URL(req.url, "http://localhost");
  const code = normalizeTrackingCode(url.searchParams.get("code") || "");
  if (!code) return send(res, 400, { error: "invalid_code" });
  if (!rateLimit(`stream:${ip}`, { limit: 30, windowMs: 60_000 }).ok || (open.get(ip) || 0) >= 5) return send(res, 429, { error: "rate_limited" });

  let store;
  try { store = await getStore(); } catch { return send(res, 503, { error: "unavailable" }); }
  const first = await store.getShipment(code).catch(() => undefined);
  if (first === undefined) return send(res, 503, { error: "unavailable" });
  if (!first || first.archived === true) return send(res, 404, { error: "not_found", message: "Tracking number not found." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no"
  });
  open.set(ip, (open.get(ip) || 0) + 1);
  let closed = false; let lastVersion = url.searchParams.get("v") || null; let chain = Promise.resolve();
  const write = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  const push = (shipment) => {
    chain = chain.then(async () => {
      if (closed) return;
      if (!shipment || shipment.archived === true) { write("gone", { message: "Tracking number not found." }); return close(); }
      const version = shipmentVersion(shipment);
      if (version === lastVersion) return;
      lastVersion = version;
      write("update", { shipment: await buildViewFor(store, shipment) });
    }).catch(() => { write("error", { message: "temporary" }); close(); });
  };

  let unsubscribe = () => {};
  const timers = [];
  function close() {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout); timers.forEach(clearInterval);
    try { unsubscribe(); } catch { /* ignore */ }
    open.set(ip, Math.max(0, (open.get(ip) || 1) - 1));
    try { res.end(); } catch { /* ignore */ }
  }
  req.on("close", close);

  write("ready", { serverTime: new Date().toISOString() });
  unsubscribe = store.watchShipment(code, (s) => { if (s === undefined) { write("error", { message: "listener" }); close(); } else push(s); });
  timers.push(setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, 15_000));
  timers.push(setTimeout(() => { write("bye", { reconnect: true }); close(); }, MAX_MS));
}
