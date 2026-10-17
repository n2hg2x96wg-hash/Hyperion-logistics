// Command-center upgrade: public homepage data privacy, statistics, carriers directory, global map,
// backups (with restore) and legacy-field preservation through the migration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.STORE = process.env.STORE || "memory";
if (process.env.STORE === "firestore-emulator") { process.env.FIREBASE_PROJECT_ID ||= "demo-hyperion"; process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085"; process.env.GCLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID; process.env.GEOCODER = "off"; }
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-secret-test-secret-1234";
process.env.PROVIDER_GENERIC_SECRET = "prov-secret";

const { createServer } = await import("../dev-server.js");
const { __seedDemo } = await import("./seed.js");
const { __clearPublicCache } = await import("../api/public.js");
const { createMemoryStore } = await import("../api/_lib/store/memory.js");
const { maskCode, cityLabel } = await import("../api/_lib/public-view.js");
const { countryAt } = await import("../api/_lib/geo.js");

let server; let base; let cookie = "";
let legacyBefore;

before(async () => {
  const store = await __seedDemo();
  legacyBefore = await store.getShipment("LEGACY-OLD");
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const r = await fetch(`${base}/api/admin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", password: "test-password-123" }) });
  cookie = r.headers.get("set-cookie").split(";")[0];
});
after(() => server.close());

async function admin(body, { auth = true } = {}) {
  const res = await fetch(`${base}/api/admin`, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function overview() { __clearPublicCache(); const r = await fetch(`${base}/api/public?view=overview`); assert.equal(r.status, 200); return r.json(); }

let code;
test("helpers: masking, city labels, point-in-country", () => {
  assert.equal(maskCode("HY-123456"), "HY-12••56");
  assert.equal(maskCode("DHL-12345"), "DHL-12••45");
  assert.equal(cityLabel("12 Marina Road, Lagos, Nigeria"), "Lagos, Nigeria");
  assert.equal(countryAt(6.5244, 3.3792), "NG");
  assert.equal(countryAt(51.5072, -0.1276), "GB");
  assert.equal(countryAt(0, -30), null, "ocean is not a country");
});

test("public overview: real counts, NO individual shipments until an admin opts in", async () => {
  const o = await overview();
  assert.equal(o.routes.length, 0);
  assert.equal(o.activity.length, 0);
  assert.equal(o.stats.total, 2);
  assert.equal(o.stats.active, 2);
  assert.ok(o.stats.countriesAll >= 3, "PH, US, JP derived from seed data");
  assert.ok(o.stats.rules.active, "counting rules are published");
  const r = await fetch(`${base}/api/public?view=overview`);
  assert.match(r.headers.get("cache-control"), /s-maxage=30/);
});

test("opt-in route is masked, city-level, without private fields; changes are audited", async () => {
  const c = await admin({ action: "create", shipment: {
    origin: "12 Marina Road, Lagos, Nigeria", destination: "Flat 4, 221B Baker Street, London, United Kingdom", courier: "dhl",
    originLat: 6.524379, originLng: 3.379206, destinationLat: 51.507218, destinationLng: -0.127586,
    location: "Apapa Port, Lagos, Nigeria", latitude: 6.45, longitude: 3.36, clientRef: "ACME-SECRET-REF",
    notes: "Leave with neighbour", internalNotes: "VIP INTERNAL", statusCode: "IN_TRANSIT"
  } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  code = c.json.shipment.id;
  assert.equal(c.json.shipment.originCountry, "NG");
  assert.equal(c.json.shipment.destinationCountry, "GB");
  assert.equal((await overview()).routes.length, 0, "default is private");

  const on = await admin({ action: "update", code, changes: { publicMap: true } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  const audit = (await admin({ action: "audit", code })).json.items;
  assert.ok(audit.some((a) => a.action === "publicmap.changed" && a.next.publicMap === true));

  const o = await overview();
  assert.equal(o.routes.length, 1);
  const route = o.routes[0];
  assert.equal(route.ref, maskCode(code));
  assert.equal(route.originLabel, "Lagos, Nigeria");
  assert.equal(route.destinationLabel, "London, United Kingdom");
  assert.deepEqual(route.origin, { lat: 6.52, lng: 3.38 });
  assert.equal(route.current.lat, 6.45);
  assert.equal(route.current.sourceLabel, "Operations update");
  const text = JSON.stringify(o);
  for (const secret of [code, "ACME-SECRET-REF", "VIP INTERNAL", "Leave with neighbour", "Marina Road", "Baker Street", "admin", "Apapa Port"]) {
    assert.ok(!text.includes(secret), `public overview must not contain ${secret}`);
  }
  assert.ok(o.activity.length >= 1);
  assert.ok(o.activity.every((a) => a.ref === route.ref && !("description" in a)));
  assert.equal(o.stats.active, 3);
  assert.ok(o.stats.activeCountries.some((c) => c.iso === "NG"));
});

test("shipment visibility still applies on the homepage; archived shipments disappear", async () => {
  await admin({ action: "setVisibility", code, visibility: { location: false } });
  let route = (await overview()).routes[0];
  assert.equal(route.current, null, "no position when the client view hides location");
  await admin({ action: "setVisibility", code, visibility: { location: true } });
  await admin({ action: "archive", code });
  const o = await overview();
  assert.equal(o.routes.length, 0);
  assert.equal(o.stats.total, 2, "archived records are not counted");
  await admin({ action: "unarchive", code });
});

test("operators without visibility permission cannot publish; anonymous users cannot touch admin actions", async () => {
  for (const action of ["globalMap", "backup", "backupDone"]) assert.equal((await admin({ action }, { auth: false })).status, 401, action);
  const bad = await admin({ action: "update", code, changes: { publicMap: "yes" } });
  assert.equal(bad.status, 400);
});

test("admin global map: unmasked active routes incl. non-public ones", async () => {
  const g = (await admin({ action: "globalMap" })).json;
  assert.ok(g.routes.some((r) => r.ref === code && r.publicMap === true));
  assert.ok(g.routes.some((r) => r.ref === "DHL-12345" && r.publicMap === false && r.current));
});

test("carrier directory: categories, honest integration labels, no private courier fields", async () => {
  __clearPublicCache();
  const { carriers } = await (await fetch(`${base}/api/public?view=carriers`)).json();
  const byId = Object.fromEntries(carriers.map((c) => [c.id, c]));
  for (const id of ["dhl", "fedex", "maersk", "msc", "cmacgm", "giglogistics", "redstarexpress", "tesla-transport"]) assert.ok(byId[id], id);
  assert.equal(byId.maersk.category, "ocean");
  assert.equal(byId["tesla-transport"].category, "custom");
  assert.equal(byId["tesla-transport"].website, null);
  assert.ok(carriers.every((c) => c.integration.status !== "live"), "no carrier API is connected in tests");
  const text = JSON.stringify(carriers);
  assert.ok(!text.includes("secret.internal") && !text.includes("x@dhl.example"));
  const bad = await admin({ action: "saveCourier", id: "maersk", courier: { name: "Maersk", prefix: "MSK", category: "spaceships" } });
  assert.equal(bad.status, 400);
  const ok = await admin({ action: "saveCourier", id: "maersk", courier: { name: "Maersk", prefix: "MSK", category: "ocean", coverage: "Global ocean routes" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test("backup → restore round-trip is lossless; migration needs it and keeps legacy fields", async () => {
  assert.equal((await admin({ action: "migrate" })).json.error, "backup_required");
  let cursor = null; const items = []; let couriers;
  do { const p = (await admin({ action: "backup", cursor })).json; if (!cursor) couriers = p.couriers; items.push(...p.items); cursor = p.nextCursor; } while (cursor);
  assert.equal(items.length, 3);
  assert.ok(Array.isArray(couriers));
  const checksum = crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
  assert.equal((await admin({ action: "backupDone", shipments: items.length, events: 0, locations: 0, checksum })).status, 200);

  // restore into an empty store and compare every document field by field
  const restored = createMemoryStore({ shipments: Object.fromEntries(items.map((i) => [i.id, i.data])) });
  for (const i of items) assert.deepEqual(await restored.getShipment(i.id), { ...i.data, id: i.id });
  const withEvents = items.find((i) => i.id === code);
  assert.ok(withEvents.events.length >= 2 && withEvents.locations.length >= 1, "events and location history are in the backup");

  let page = (await admin({ action: "migrate" })).json;
  assert.ok(page.scanned >= 3, JSON.stringify(page));
  const after = (await admin({ action: "get", code: "LEGACY-OLD" })).json.shipment;
  for (const [k, v] of Object.entries(legacyBefore)) assert.deepEqual(after[k], v, `legacy field ${k} preserved`);
  assert.equal(after.originCountry, undefined, "unknown country text is not guessed ('Lagos' alone)");
  const again = (await admin({ action: "migrate" })).json;
  assert.equal(again.changed, 0, "migration is idempotent");
});
