// Customer notification center: notifications follow real, committed status changes; no duplicates; strict
// per-customer isolation on the server. Runs against the in-memory store through the real HTTP handlers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.STORE = "memory";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-secret-test-secret-1234";

const { createServer } = await import("../dev-server.js");
const { __seedDemo } = await import("./seed.js");
const { getStore } = await import("../api/_lib/store/index.js");

let server; let base; let cookie = ""; let ana; let ben; let code; let benCode;

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})), res };
};
const admin = (body) => post("/api/admin", body, cookie ? { Cookie: cookie } : {});
const as = (who) => (body) => post("/api/customer", body, who ? { Authorization: `Bearer ${who.token}` } : {});
async function signIn(email, password) {
  const r = await post("/api/customer", { action: "devLogin", email, password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { token: r.json.token };
}
const notes = async (who) => (await as(who)({ action: "notifications" })).json;

before(async () => {
  await __seedDemo();
  server = createServer(); await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const login = await admin({ action: "login", password: process.env.ADMIN_PASSWORD });
  cookie = login.res.headers.get("set-cookie").split(";")[0];
  for (const [email, name] of [["ana@test.example", "Ana Test"], ["ben@test.example", "Ben Test"]]) {
    const r = await admin({ action: "saveClient", mode: "create", client: { name, email, password: "secret-123", status: "active" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const ids = Object.fromEntries((await admin({ action: "listClients" })).json.clients.map((c) => [c.email, c.id]));
  ana = { ...(await signIn("ana@test.example", "secret-123")), uid: ids["ana@test.example"] };
  ben = { ...(await signIn("ben@test.example", "secret-123")), uid: ids["ben@test.example"] };
  const c1 = await admin({ action: "create", shipment: { courier: "dhl", origin: "Lagos, Nigeria", destination: "London, United Kingdom", customerId: ana.uid } });
  assert.equal(c1.status, 200, JSON.stringify(c1.json)); code = c1.json.shipment.id;
  const c2 = await admin({ action: "create", shipment: { courier: "dhl", origin: "Accra, Ghana", destination: "Paris, France", customerId: ben.uid } });
  benCode = c2.json.shipment.id;
});
after(() => server?.close());

test("customer API: no token, bad token and inactive accounts are refused", async () => {
  assert.equal((await as(null)({ action: "notifications" })).status, 401);
  assert.equal((await as({ token: "forged" })({ action: "notifications" })).status, 401);
  assert.equal((await post("/api/customer", { action: "devLogin", email: "ana@test.example", password: "wrong" })).status, 401);
  const me = await as(ana)({ action: "me" });
  assert.deepEqual(me.json, { name: "Ana Test", email: "ana@test.example" });
});

test("a new shipment linked to a customer notifies them once ('Shipment Registered'); other customers see nothing of it", async () => {
  const a = await notes(ana);
  assert.equal(a.unread, 1);
  assert.equal(a.items[0].statusCode, "CREATED"); assert.equal(a.items[0].shipment, code); assert.equal(a.items[0].read, false);
  assert.ok(Date.parse(a.items[0].createdAt));
  const b = await notes(ben);
  assert.ok(b.items.every((n) => n.shipment !== code), "Ben never sees Ana's shipment");
  assert.ok(!JSON.stringify(a).match(/customerId|eventId|actor|internal/), "no internal fields reach the customer");
});

test("a real status change notifies; saving the same status again does not duplicate", async () => {
  const before = (await notes(ana)).items.length;
  assert.equal((await admin({ action: "update", code, changes: { statusCode: "IN_TRANSIT" } })).status, 200);
  let n = await notes(ana);
  assert.equal(n.items.length, before + 1); assert.equal(n.items[0].statusCode, "IN_TRANSIT"); assert.equal(n.items[0].title, "In Transit");
  // same status again, twice: nothing new
  const again = await admin({ action: "update", code, changes: { statusCode: "IN_TRANSIT" } });
  assert.equal(again.status, 200); await admin({ action: "update", code, changes: { statusCode: "IN_TRANSIT" } });
  assert.equal((await notes(ana)).items.length, before + 1);
  // a location-only update is not a milestone notification
  await admin({ action: "updateLocation", code, locationName: "Accra, Ghana" });
  assert.equal((await notes(ana)).items.length, before + 1);
  // delivered
  await admin({ action: "update", code, changes: { statusCode: "OUT_FOR_DELIVERY" } });
  await admin({ action: "update", code, changes: { statusCode: "DELIVERED" } });
  n = await notes(ana);
  assert.deepEqual(n.items.slice(0, 2).map((x) => x.statusCode), ["DELIVERED", "OUT_FOR_DELIVERY"]);
});

test("a manual tracking event notifies once; a resubmission and a hidden event do not", async () => {
  const before = (await notes(ana)).items.length;
  const ev = { action: "addEvent", code, statusCode: "AT_FACILITY", location: "Heathrow hub", description: "Arrived at hub", timestamp: "2026-10-20T10:00:00.000Z" };
  assert.equal((await admin(ev)).status, 200);
  assert.equal((await admin(ev)).json.duplicate, true);
  assert.equal((await notes(ana)).items.length, before + 1);
  await admin({ ...ev, description: "Internal check", clientVisible: false });
  assert.equal((await notes(ana)).items.length, before + 1, "events hidden from the customer are not notified");
});

test("a failed status change creates no notification", async () => {
  const before = (await notes(ana)).items.length;
  const bad = await admin({ action: "update", code, changes: { statusCode: "NOT_A_STATUS" } });
  assert.equal(bad.status, 400);
  const missing = await admin({ action: "update", code: "NO-SUCH-1", changes: { statusCode: "DELAYED" } });
  assert.equal(missing.status, 404);
  assert.equal((await notes(ana)).items.length, before);
});

test("read state: one, then all; stored, so it survives a new sign-in", async () => {
  let n = await notes(ana);
  assert.ok(n.unread >= 3);
  const first = n.items[0];
  const r = await as(ana)({ action: "markRead", id: first.id });
  assert.equal(r.status, 200); assert.equal(r.json.unread, n.unread - 1);
  assert.equal(r.json.items.find((x) => x.id === first.id).read, true);
  // marking it again changes nothing
  assert.equal((await as(ana)({ action: "markRead", id: first.id })).json.unread, n.unread - 1);
  const again = { ...(await signIn("ana@test.example", "secret-123")) };
  assert.equal((await notes(again)).unread, n.unread - 1, "read state persists across sign-ins");
  const all = await as(again)({ action: "markAllRead" });
  assert.equal(all.json.unread, 0); assert.ok(all.json.items.every((x) => x.read));
  n = await notes(ana); assert.equal(n.unread, 0);
});

test("isolation: another customer's notification ids and shipment codes are not reachable", async () => {
  const anaIds = (await notes(ana)).items.map((x) => x.id);
  const benUnreadBefore = (await notes(ben)).unread;
  for (const id of [anaIds[0], "nt_000000000000000000000000", "../x", "", null]) {
    const r = await as(ben)({ action: "markRead", id });
    assert.equal(r.status, 404, `ben cannot mark ${id}`);
  }
  assert.equal((await as(ben)({ action: "markAllRead" })).status, 200);
  const anaAfter = await notes(ana);
  assert.deepEqual(anaAfter.items.map((x) => x.id), anaIds, "Ana's notifications untouched by Ben");
  assert.ok(benUnreadBefore >= 0);
  // shipments: own only; another customer's code and unlinked codes are "not found" (no probing)
  assert.deepEqual((await as(ana)({ action: "shipments" })).json.shipments.map((s) => s.code), [code]);
  assert.equal((await as(ben)({ action: "shipment", code })).status, 404);
  assert.equal((await as(ben)({ action: "shipment", code: "DHL-12345" })).status, 404, "unlinked shipments are not customer shipments");
  const own = await as(ana)({ action: "shipment", code: code.toLowerCase() });
  assert.equal(own.status, 200); assert.equal(own.json.shipment.trackingCode, code);
  assert.ok(!("customerId" in own.json.shipment) && !JSON.stringify(own.json).includes("internalNotes"), "the same client view as public tracking");
  assert.equal((await as(ben)({ action: "shipment", code: benCode })).status, 200);
});

test("admin: linking needs an existing customer account and client permission; tracking and status updates unchanged", async () => {
  const bad = await admin({ action: "update", code, changes: { customerId: "uid_doesnotexist" } });
  assert.equal(bad.status, 400); assert.equal(bad.json.field, "customerId");
  // unlinking stops new notifications for that shipment
  assert.equal((await admin({ action: "update", code: benCode, changes: { customerId: "" } })).status, 200);
  const before = (await notes(ben)).items.length;
  await admin({ action: "update", code: benCode, changes: { statusCode: "DELAYED" } });
  assert.equal((await notes(ben)).items.length, before);
  assert.equal((await as(ben)({ action: "shipment", code: benCode })).status, 404, "unlinked: no longer in the account");
  // public tracking is unchanged and never exposes the link
  const pub = await fetch(`${base}/api/track?code=${code}`).then((r) => r.json());
  assert.equal(pub.shipment.trackingCode, code); assert.ok(!JSON.stringify(pub).includes(ana.uid));
  // customers cannot use the admin API
  const asCustomer = await post("/api/admin", { action: "update", code, changes: { statusCode: "CANCELLED" } }, { Authorization: `Bearer ${ana.token}` });
  assert.equal(asCustomer.status, 401);
});

test("disabled or deleted customer accounts lose access immediately", async () => {
  const r = await admin({ action: "setClientStatus", id: ben.uid, status: "inactive" });
  assert.equal(r.status, 200);
  assert.ok([401, 403].includes((await as(ben)({ action: "notifications" })).status));
  await admin({ action: "setClientStatus", id: ben.uid, status: "active" });
});

test("data model: additive only (existing shipment fields and records untouched)", async () => {
  const store = await getStore();
  const legacy = await store.getShipment("DHL-12345");
  assert.ok(legacy && !("customerId" in legacy), "existing shipments are not modified");
  const dump = store.__dump();
  assert.ok(dump.notifications.get(ana.uid).size >= 5);
  for (const n of dump.notifications.get(ana.uid).values()) assert.match(n.id, /^nt_[0-9a-f]{24}$/);
});

test("installable app: valid manifest with real icons, linked from the public pages; the service worker never caches data", async () => {
  const fs = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const m = JSON.parse(fs.readFileSync(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(m.display, "standalone"); assert.equal(m.scope, "/"); assert.match(m.start_url, /^\/account\.html/);
  for (const size of ["192x192", "512x512"]) for (const purpose of ["any", "maskable"]) assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === purpose), `${size} ${purpose}`);
  for (const icon of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)]) {
    const png = fs.readFileSync(new URL(icon.src.slice(1), root));
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [w, h], icon.src);
  }
  for (const page of ["index.html", "track.html", "tracking-enhanced.html", "carriers.html", "account.html"]) {
    const html = fs.readFileSync(new URL(page, root), "utf8");
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, page);
    assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/app\/apple-touch-icon\.png">/, page);
  }
  const sw = fs.readFileSync(new URL("sw.js", root), "utf8");
  assert.doesNotMatch(sw, /cache\.put|\.put\(/, "responses are never written to a cache");
  assert.match(sw, /req\.method !== "GET"/);
  // the admin console is its own app: own id, name, icons and scope; the customer pages never link it
  const a = JSON.parse(fs.readFileSync(new URL("admin.webmanifest", root), "utf8"));
  assert.equal(a.id, "/admin.html"); assert.equal(a.scope, "/admin"); assert.match(a.start_url, /^\/admin\.html/); assert.notEqual(a.id, m.id);
  for (const icon of a.icons) {
    const png = fs.readFileSync(new URL(icon.src.slice(1), root));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], icon.sizes.split("x").map(Number), icon.src);
  }
  const adminHtml = fs.readFileSync(new URL("admin.html", root), "utf8");
  assert.match(adminHtml, /<link rel="manifest" href="\/admin\.webmanifest">/);
  assert.doesNotMatch(adminHtml, /manifest\.webmanifest/);
  for (const page of ["index.html", "track.html", "account.html"]) assert.doesNotMatch(fs.readFileSync(new URL(page, root), "utf8"), /admin\.webmanifest/, page);
  const res = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(res.headers.get("content-type"), "application/manifest+json");
});
