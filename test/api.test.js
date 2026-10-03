import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.STORE = process.env.STORE || "memory";
if (process.env.STORE === "firestore-emulator") { process.env.FIREBASE_PROJECT_ID ||= "demo-hyperion"; process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085"; process.env.GCLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID; process.env.GEOCODER = "off"; }
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-secret-test-secret-1234";
process.env.PROVIDER_GENERIC_SECRET = "prov-secret";
process.env.STREAM_MAX_MS = "3000";

const { createServer } = await import("../dev-server.js");
const { __seedDemo } = await import("./seed.js");

let server; let base; let cookie = "";

before(async () => {
  await __seedDemo();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const track = (code, v) => fetch(`${base}/api/track?code=${encodeURIComponent(code)}${v ? `&v=${v}` : ""}`);
async function admin(body, { auth = true, headers = {} } = {}) {
  const res = await fetch(`${base}/api/admin`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(auth && cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => ({})), res };
}

test("public: invalid / unknown codes give professional errors and no internals", async () => {
  let r = await track("  ");
  assert.equal(r.status, 400);
  r = await track("NOPE-0000");
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.message, "Tracking number not found.");
  assert.ok(!JSON.stringify(body).includes("firestore"));
});

test("public: legacy shipment is served through whitelisted view (no secrets)", async () => {
  const r = await track(" dhl-12345 ");
  assert.equal(r.status, 200);
  const { shipment } = await r.json();
  assert.equal(shipment.trackingCode, "DHL-12345");
  assert.equal(shipment.status.code, "IN_TRANSIT");
  assert.equal(shipment.currentLocation.name, "Tokyo, Japan");
  assert.equal(shipment.map.current.lat, 35.6762);
  assert.equal(shipment.eta.state, "unavailable");
  const text = JSON.stringify(shipment);
  assert.ok(!text.includes("secret.internal"), "courier apiEndpoint must never leak");
  assert.ok(!text.includes("internalNotes"));
  assert.ok(shipment.timeline.some((t) => t.id === "legacy-0"));
});

test("admin endpoints reject unauthenticated callers and forged cookies", async () => {
  for (const action of ["stats", "list", "get", "create", "update", "updateLocation", "addEvent", "delete", "audit", "preview", "migrate"]) {
    const { status } = await admin({ action, code: "DHL-12345" }, { auth: false });
    assert.equal(status, 401, action);
  }
  const forged = await admin({ action: "stats" }, { auth: false, headers: { Cookie: "hx_admin=eyJyb2xlIjoiYWRtaW4ifQ.bad" } });
  assert.equal(forged.status, 401);
  const bad = await admin({ action: "login", password: "wrong" }, { auth: false });
  assert.equal(bad.status, 401);
});

test("cross-origin admin POST is rejected", async () => {
  const r = await admin({ action: "login", password: "test-password-123" }, { auth: false, headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
});

test("admin login issues HttpOnly strict cookie", async () => {
  const r = await admin({ action: "login", password: "test-password-123" }, { auth: false });
  assert.equal(r.status, 200);
  const set = r.res.headers.get("set-cookie");
  assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/);
  cookie = set.split(";")[0];
  assert.equal((await admin({ action: "me" })).json.role, "admin");
});

let code;
test("admin: create shipment generates registered event, audit entry, and is publicly trackable", async () => {
  const r = await admin({ action: "create", shipment: {
    origin: "Lagos, Nigeria", destination: "London, UK", courier: "dhl", serviceType: "Express", location: "Lagos, Nigeria",
    latitude: 6.5244, longitude: 3.3792, originLat: 6.5244, originLng: 3.3792, destinationLat: 51.5072, destinationLng: -0.1276,
    etaDate: "2026-10-12", notes: "Handle with care", internalNotes: "VIP client - do not disclose", clientRef: "ACME Ltd",
    package: { description: "Spare parts", weight: "12 kg" }
  } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  code = r.json.shipment.id;
  assert.match(code, /^DHL-\d{6}$/);
  const pub = await (await track(code)).json();
  assert.equal(pub.shipment.status.code, "CREATED");
  assert.equal(pub.shipment.eta.state, "date");
  assert.equal(pub.shipment.timeline.length, 1);
  assert.equal(pub.shipment.timeline[0].title, "Shipment Registered");
  assert.equal(pub.shipment.notes, "Handle with care");
  assert.ok(!JSON.stringify(pub).includes("VIP"), "internal notes never exposed");
  assert.ok(!JSON.stringify(pub).includes("ACME"), "client ref never exposed");
  const audit = (await admin({ action: "audit" })).json.items;
  assert.ok(audit.some((a) => a.action === "shipment.created" && a.shipment === code && a.actor === "admin"));
});

test("admin: duplicate tracking code is rejected", async () => {
  const r = await admin({ action: "create", shipment: { trackingCode: code, origin: "A", destination: "B" } });
  assert.equal(r.status, 409);
});

test("admin: location update changes shipment, adds exactly one event + history, and is idempotent", async () => {
  const body = { action: "updateLocation", code, locationName: "Abuja, Nigeria", latitude: 9.0765, longitude: 7.3986, statusCode: "IN_TRANSIT" };
  const first = await admin(body);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.unchanged, false);
  const second = await admin(body);
  assert.equal(second.json.unchanged, true, "identical update must not duplicate events");
  const pub = (await (await track(code)).json()).shipment;
  assert.equal(pub.currentLocation.name, "Abuja, Nigeria");
  assert.equal(pub.currentLocation.sourceLabel, "Operations update", "manual updates are never labelled GPS");
  assert.equal(pub.status.code, "IN_TRANSIT");
  assert.equal(pub.map.trail.length, 2, "creation location + update are both recorded points");
  const titles = pub.timeline.map((t) => t.title);
  assert.equal(titles.filter((t) => t === "Location Updated").length, 1);
  assert.equal(titles.filter((t) => t === "In Transit").length, 1);
  const full = (await admin({ action: "get", code })).json;
  assert.equal(full.events.length, 3);
  assert.ok((await admin({ action: "audit", code })).json.items.some((a) => a.action === "location.changed"));
});

test("conditional polling returns unchanged for same version", async () => {
  const v = (await (await track(code)).json()).shipment.version;
  const r = await (await track(code, v)).json();
  assert.equal(r.unchanged, true);
});

test("validation: bad coordinates and unknown status are rejected", async () => {
  assert.equal((await admin({ action: "updateLocation", code, locationName: "X", latitude: 123, longitude: 0 })).status, 400);
  assert.equal((await admin({ action: "update", code, changes: { statusCode: "TELEPORTED" } })).status, 400);
  assert.equal((await admin({ action: "updateLocation", code, locationName: "X", latitude: 10 })).status, 400);
});

test("tracking event manager: stored, shown, de-duplicated", async () => {
  const ev = { action: "addEvent", code, statusCode: "AT_FACILITY", location: "Lagos Hub", timestamp: new Date(Date.now() - 3600_000).toISOString(), description: "Arrived at sorting facility." };
  const a = await admin(ev); const b = await admin(ev);
  assert.equal(a.json.duplicate, false); assert.equal(b.json.duplicate, true);
  const pub = (await (await track(code)).json()).shipment;
  assert.equal(pub.timeline.filter((t) => t.description === "Arrived at sorting facility.").length, 1);
  assert.equal((await admin({ action: "addEvent", code, statusCode: "AT_FACILITY", description: "", timestamp: new Date(Date.now() - 3600_000).toISOString() })).status, 400);
  assert.equal((await admin({ action: "addEvent", code, statusCode: "AT_FACILITY", description: "x", timestamp: "2999-01-01T00:00:00Z" })).status, 400, "future events rejected");
});

test("visibility switches are enforced by the server, not CSS", async () => {
  const r = await admin({ action: "setVisibility", code, visibility: { map: false, eta: false, carrier: false, package: false, notes: false, timeline: false, events: false, location: false, fee: false, progress: false } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const pub = (await (await track(code)).json()).shipment;
  for (const k of ["map", "eta", "carrier", "package", "notes", "timeline", "currentLocation", "progress", "fee"]) assert.equal(pub[k], undefined, k);
  assert.ok(!JSON.stringify(pub).includes("Abuja"), "location text must not leak anywhere");
  assert.ok((await admin({ action: "audit", code })).json.items.some((a) => a.action === "visibility.changed"));
  // preview mirrors the public view exactly (same builder)
  const prev = (await admin({ action: "preview", code })).json.shipment;
  assert.equal(prev.preview, true); assert.equal(prev.map, undefined);
  await admin({ action: "setVisibility", code, visibility: { map: true, eta: true, location: true, timeline: true, events: true, progress: true, notes: true, carrier: true, package: true } });
});

test("exceptions only appear when recorded; clearing works", async () => {
  let pub = (await (await track(code)).json()).shipment;
  assert.equal(pub.exception, undefined);
  await admin({ action: "update", code, changes: { exception: { type: "CUSTOMS_HOLD", note: "Awaiting documents" } } });
  pub = (await (await track(code)).json()).shipment;
  assert.equal(pub.exception.label, "Customs hold");
  assert.equal(pub.status.code, "EXCEPTION");
  assert.equal(pub.progress.held, true);
  await admin({ action: "update", code, changes: { statusCode: "IN_TRANSIT" } });
  pub = (await (await track(code)).json()).shipment;
  assert.equal(pub.exception, undefined);
});

test("delivered shows delivered ETA state and 100% progress", async () => {
  await admin({ action: "update", code, changes: { statusCode: "DELIVERED" } });
  const pub = (await (await track(code)).json()).shipment;
  assert.equal(pub.progress.pct, 100); assert.equal(pub.eta.state, "delivered");
});

test("search & filter, stats are computed from real data", async () => {
  const byPrefix = (await admin({ action: "list", q: code.slice(0, 6) })).json;
  assert.ok(byPrefix.items.some((i) => i.id === code));
  const byStatus = (await admin({ action: "list", status: "DELIVERED" })).json;
  assert.ok(byStatus.items.every((i) => i.statusCode === "DELIVERED"));
  const byDest = (await admin({ action: "list", destination: "lon" })).json;
  assert.ok(byDest.items.some((i) => i.id === code));
  const stats = (await admin({ action: "stats" })).json;
  assert.equal(stats.totals.total, 3);
  assert.equal(stats.totals.delivered, 1);
  assert.equal(stats.needsMigration, true, "legacy docs flagged until migration");
  const mig = (await admin({ action: "migrate" })).json;
  assert.ok(mig.changed >= 2);
  assert.equal((await admin({ action: "stats" })).json.needsMigration, false);
  const legacy = (await (await track("LEGACY-OLD")).json()).shipment;
  assert.equal(legacy.status.code, "CUSTOMS", "legacy 'Under Custom review' maps to CUSTOMS");
});

test("archive hides from public, delete is audited", async () => {
  assert.equal((await admin({ action: "archive", code: "LEGACY-OLD" })).json.changed, true);
  assert.equal((await track("LEGACY-OLD")).status, 404);
  await admin({ action: "delete", code: "LEGACY-OLD" });
  assert.ok((await admin({ action: "audit" })).json.items.some((a) => a.action === "shipment.deleted"));
});

test("provider webhook: signed requests update location with carrier source; unsigned are rejected", async () => {
  const payload = JSON.stringify({ updates: [{ trackingCode: "DHL-12345", location: "Anchorage, USA", latitude: 61.2181, longitude: -149.9003, statusCode: "IN_TRANSIT" }] });
  const bad = await fetch(`${base}/api/provider?provider=generic`, { method: "POST", body: payload });
  assert.equal(bad.status, 401);
  const sig = crypto.createHmac("sha256", "prov-secret").update(payload).digest("hex");
  const ok = await fetch(`${base}/api/provider?provider=generic`, { method: "POST", body: payload, headers: { "x-hyperion-signature": sig } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).results[0].ok, true);
  const pub = (await (await track("DHL-12345")).json()).shipment;
  assert.equal(pub.currentLocation.sourceLabel, "Carrier API");
});

test("SSE stream is scoped to one code and pushes updates", async () => {
  const res = await fetch(`${base}/api/stream?code=DHL-12345`);
  assert.equal(res.headers.get("content-type").split(";")[0], "text/event-stream");
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  const waitFor = async (needle) => { const deadline = Date.now() + 4000; while (!buf.includes(needle) && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return buf.includes(needle); };
  assert.ok(await waitFor("event: ready"));
  await admin({ action: "updateLocation", code: "DHL-12345", locationName: "Seattle, USA", latitude: 47.6062, longitude: -122.3321 });
  assert.ok(await waitFor("Seattle, USA"));
  assert.ok(!buf.includes(code), "stream for one code must never include another shipment");
  await reader.cancel();
  assert.equal((await fetch(`${base}/api/stream?code=NOPE-0000`)).status, 404);
});

test("source code and server internals are not served statically", async () => {
  for (const p of ["/api/_lib/service.js", "/api/_lib/store/firestore.js", "/test/api.test.js"]) assert.equal((await fetch(base + p)).status, 404, p);
});

test("health endpoint reports configuration without secrets", async () => {
  const r = await fetch(`${base}/api/health`);
  const body = await r.json();
  assert.ok(body.database.startsWith("ok"));
  assert.ok(!JSON.stringify(body).includes(process.env.ADMIN_PASSWORD));
  assert.ok(!JSON.stringify(body).includes(process.env.SESSION_SECRET));
});
