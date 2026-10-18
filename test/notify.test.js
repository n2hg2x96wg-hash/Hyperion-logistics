// Opt-in customer e-mail notifications, the shared transport-mode rule and the public route `mode` field.
// Memory store only; the e-mail provider is exercised with a mocked fetch (nothing leaves the machine).
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.STORE = "memory"; process.env.GEOCODER = "off";
const { __seedDemo } = await import("./seed.js");
const svc = await import("../api/_lib/service.js");
const { buildPublicOverview } = await import("../api/_lib/public-view.js");
const { getStore } = await import("../api/_lib/store/index.js");
const { transportMode } = await import("../shared/mode.js");
const { shipmentMode } = await import("../tracker/scene.js");
const { milestoneEmail, configuredProviders } = await import("../api/_lib/notifications.js");

const admin = { sub: "admin", role: "owner", via: "admin" };
const realFetch = globalThis.fetch; let sent = [];
before(() => {
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers }); return new Response("{}", { status: 200 }); };
});
after(() => { globalThis.fetch = realFetch; for (const k of ["RESEND_API_KEY", "NOTIFY_EMAIL_FROM", "SITE_URL"]) delete process.env[k]; });
beforeEach(async () => {
  await __seedDemo(); sent = [];
  Object.assign(process.env, { RESEND_API_KEY: "re_test", NOTIFY_EMAIL_FROM: "Hyperion <updates@example.com>", SITE_URL: "https://hyperion.example/" });
});
const emails = () => sent.filter((s) => s.url === "https://api.resend.com/emails");
const base = { courier: "maersk", origin: "Shanghai, China", destination: "Rotterdam, Netherlands" };

test("notifyEmail: validated, lower-cased, cleared with an empty string, rejected when malformed", () => {
  assert.equal(svc.parsePatch({ notifyEmail: "  Client@Example.COM " }).notifyEmail, "client@example.com");
  assert.equal(svc.parsePatch({ notifyEmail: "" }).notifyEmail, "");
  for (const bad of ["no-at-sign", "a@b", "two@one.com,three@x.com", "<x@y.com>"]) assert.throws(() => svc.parsePatch({ notifyEmail: bad }), /valid e-mail/, bad);
});

test("e-mail: one message per new recorded milestone, only to shipments with an address, never twice", async () => {
  const s = await svc.createShipment(admin, { ...base, notifyEmail: "client@example.com" });
  assert.equal(emails().length, 1, "registration milestone");
  const m = emails()[0];
  assert.deepEqual(m.body.to, ["client@example.com"]); assert.equal(m.body.from, "Hyperion <updates@example.com>");
  assert.match(m.body.subject, new RegExp(`Your shipment ${s.id}: `));
  assert.match(m.body.text, new RegExp(`https://hyperion\\.example/track\\.html\\?code=${s.id}`));
  assert.match(m.body.text, /Recorded: /); assert.ok(!/carrier confirmed|live/i.test(m.body.text));
  await svc.updateShipment(admin, s.id, { statusCode: "IN_TRANSIT" });
  assert.equal(emails().length, 2, "status change");
  await svc.updateShipment(admin, s.id, { statusCode: "IN_TRANSIT" });
  await svc.updateShipment(admin, s.id, { notes: "internal tweak" });
  assert.equal(emails().length, 2, "unchanged status and non-milestone edits send nothing");
  await svc.addTrackingEvent(admin, s.id, { statusCode: "AT_FACILITY", location: "Port of Singapore", description: "Hidden step", clientVisible: false, applyToShipment: false });
  assert.equal(emails().length, 2, "events hidden from the client are not e-mailed");
  const plain = await svc.createShipment(admin, { ...base });
  await svc.updateShipment(admin, plain.id, { statusCode: "IN_TRANSIT" });
  assert.equal(emails().length, 2, "no address, no e-mail");
});

test("e-mail: off unless configured; the place is left out when the client view hides locations", async () => {
  delete process.env.RESEND_API_KEY;
  assert.ok(!configuredProviders().includes("email"));
  await svc.createShipment(admin, { ...base, notifyEmail: "client@example.com" });
  assert.equal(emails().length, 0);
  const mail = milestoneEmail({ trackingCode: "MSK-1", title: "In Transit", location: "Port X", occurredAt: "2026-10-01T10:00:00Z" });
  assert.match(mail.text, /Recorded at: Port X/); assert.match(mail.html, /Track your shipment/);
  process.env.RESEND_API_KEY = "re_test";
  const s = await svc.createShipment(admin, { ...base, notifyEmail: "client@example.com", visibility: { location: false } });
  await svc.updateLocation(admin, s.id, { locationName: "Port of Singapore", statusCode: "IN_TRANSIT" });
  const last = emails().at(-1).body;
  assert.ok(!/Port of Singapore/.test(last.text + last.html), "hidden location never e-mailed");
});

test("notifyEmail is admin-only: never in the client tracking view or the public overview", async () => {
  const s = await svc.createShipment(admin, { ...base, notifyEmail: "client@example.com", publicMap: true, originLat: 31.2, originLng: 121.5, destinationLat: 51.9, destinationLng: 4.5 });
  const view = await svc.getClientView(s.id);
  assert.ok(!JSON.stringify(view).includes("client@example.com"));
  const store = await getStore();
  const full = await store.getShipment(s.id);
  const overview = buildPublicOverview({ summaries: [full], publicShipments: [full], eventsByCode: new Map([[s.id, await store.listEvents(s.id, 10)]]) });
  assert.ok(!JSON.stringify(overview).includes("client@example.com"));
  assert.equal(overview.routes[0].mode, "sea", "Maersk is an ocean carrier");
  await svc.updateShipment(admin, s.id, { notifyEmail: "new@example.com" });
  const audit = await svc.recentAudit({ code: s.id });
  assert.ok(audit.some((a) => a.action === "shipment.edited" && JSON.stringify(a).includes("notifyEmail")), "address changes are audited");
});

test("transport mode: one rule for tracking and the homepage", () => {
  const cases = [[{ carrierName: "Maersk" }, "sea"], [{ carrierId: "emiratesskycargo" }, "air"], [{ carrierName: "DHL" }, null], [{ carrierId: "fedex" }, null],
    [{ carrierId: "2goexpress" }, null], [{ carrierName: "DHL", serviceType: "Air freight" }, "air"], [{ carrierId: "dhl", serviceType: "Road haulage" }, "road"],
    [{ carrierName: "Maersk", custom: true }, null], [{}, null]];
  for (const [input, want] of cases) assert.equal(transportMode(input), want, JSON.stringify(input));
  assert.equal(shipmentMode({ carrier: { name: "Maersk" } }), "ship"); assert.equal(shipmentMode({ carrier: { name: "DHL", serviceType: "Road freight" } }), "truck");
  assert.equal(shipmentMode({ carrier: { name: "DHL" } }), null);
});

test("public route mode respects carrier visibility", async () => {
  const s = await svc.createShipment(admin, { ...base, publicMap: true, originLat: 31.2, originLng: 121.5, destinationLat: 51.9, destinationLng: 4.5, visibility: { carrier: false } });
  const full = await (await getStore()).getShipment(s.id);
  assert.equal(buildPublicOverview({ summaries: [full], publicShipments: [full], eventsByCode: new Map() }).routes[0].mode, null);
});
