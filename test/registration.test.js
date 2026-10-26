// Admin client saving and the customer + shipment registration workflow, through the real HTTP handlers and the
// in-memory store: real persistence, no partial records on failure, no duplicates, strict per-customer access.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.STORE = "memory";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-secret-test-secret-1234";

const { createServer } = await import("../dev-server.js");
const { __seedDemo } = await import("./seed.js");
const { getStore } = await import("../api/_lib/store/index.js");

let server; let base; let cookie = ""; let store;
let n = 0; const sid = () => `test_submission_${Date.now()}_${++n}`;

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})), res };
};
const admin = (body, withCookie = true) => post("/api/admin", body, withCookie && cookie ? { Cookie: cookie } : {});
const customer = (token) => (body) => post("/api/customer", body, { Authorization: `Bearer ${token}` });
const signIn = async (email, password) => (await post("/api/customer", { action: "devLogin", email, password }));
const counts = () => ({ clients: store.__dump().clients.size, users: store.__dump().authUsers.size, shipments: store.__dump().shipments.size });
const shipmentInput = (extra = {}) => ({ courier: "dhl", origin: "Lagos, Nigeria", destination: "London, United Kingdom", statusCode: "CREATED", ...extra });

before(async () => {
  await __seedDemo();
  store = await getStore();
  server = createServer(); await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const login = await admin({ action: "login", password: process.env.ADMIN_PASSWORD }, false);
  cookie = login.res.headers.get("set-cookie").split(";")[0];
});
after(() => server?.close());

test("root cause: when Firebase Authentication isn't set up, saving a client says so and saves nothing", async () => {
  const before = counts();
  store.__fault("authNotConfigured");
  try {
    const r = await admin({ action: "saveClient", mode: "create", client: { name: "Nora Test", email: "nora@test.example", password: "secret-123", status: "active" } });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "auth_not_configured");
    assert.match(r.json.message, /Firebase Authentication \(Email\/Password\) isn't enabled.*Nothing was saved/);
    assert.ok(!/stack|identifier|uid_/i.test(r.json.message), "no internals in the message");
    assert.deepEqual(counts(), before, "no client, sign-in account or shipment was created");
    // the registration workflow reports the same thing and also saves nothing
    const reg = await admin({ action: "registerShipment", submissionId: sid(), customer: { mode: "new", client: { name: "Nora Test", email: "nora@test.example", password: "secret-123", status: "active" } }, shipment: shipmentInput() });
    assert.equal(reg.status, 503); assert.equal(reg.json.error, "auth_not_configured");
    assert.deepEqual(counts(), before);
  } finally { store.__fault("authNotConfigured", false); }
});

test("clients: create with phone, notes and status; persists; edit and partial edit keep the rest; pending and suspended can't sign in", async () => {
  let r = await admin({ action: "saveClient", mode: "create", client: { name: "Paula Pending", email: "Paula@Test.example", password: "secret-123", status: "pending", phone: "+234 801 234 5678", adminNotes: "Prefers WhatsApp" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.client.id;
  r = await admin({ action: "getClient", id });
  assert.equal(r.json.client.email, "paula@test.example"); assert.equal(r.json.client.status, "pending");
  assert.equal(r.json.client.phone, "+234 801 234 5678"); assert.equal(r.json.client.adminNotes, "Prefers WhatsApp");
  assert.equal((await signIn("paula@test.example", "secret-123")).status, 401, "pending: sign-in disabled");
  // activate
  r = await admin({ action: "setClientStatus", id, status: "active" }); assert.equal(r.status, 200);
  assert.equal((await signIn("paula@test.example", "secret-123")).status, 200);
  // partial edit (holdings only, like Quick Edit) keeps phone and notes
  r = await admin({ action: "saveClient", mode: "update", id, client: { name: "Paula Pending", status: "active", xrp_holdings: 5 } });
  assert.equal(r.status, 200);
  r = await admin({ action: "getClient", id });
  assert.equal(r.json.client.phone, "+234 801 234 5678"); assert.equal(r.json.client.adminNotes, "Prefers WhatsApp"); assert.equal(r.json.client.portfolios.xrp_holdings, 5);
  // suspend
  r = await admin({ action: "saveClient", mode: "update", id, client: { name: "Paula P.", status: "suspended" } });
  assert.equal(r.status, 200);
  assert.equal((await signIn("paula@test.example", "secret-123")).status, 401, "suspended: sign-in disabled");
  // duplicate email (any case) is refused, nothing new created
  const before = counts();
  r = await admin({ action: "saveClient", mode: "create", client: { name: "Copy", email: "PAULA@test.example", password: "secret-123" } });
  assert.equal(r.status, 409); assert.deepEqual(counts(), before);
  // invalid inputs
  for (const [client, field] of [[{ name: "", email: "x@test.example", password: "secret-123" }, "name"], [{ name: "X", email: "not-an-email", password: "secret-123" }, "email"],
    [{ name: "X", email: "x@test.example", password: "123" }, "password"], [{ name: "X", email: "x@test.example", password: "secret-123", phone: "call me" }, "phone"],
    [{ name: "X", email: "x@test.example", password: "secret-123", status: "vip" }, "status"]]) {
    r = await admin({ action: "saveClient", mode: "create", client });
    assert.equal(r.status, 400, field); assert.equal(r.json.field, field);
  }
  assert.deepEqual(counts(), before);
});

test("register: new customer + shipment with itemised fees; both persist; the customer signs in and sees only their shipment", async () => {
  const submissionId = sid();
  const body = { submissionId, customer: { mode: "new", client: { name: "Rita Register", email: "rita@test.example", password: "secret-123", status: "active", phone: "+44 20 7946 0000" } },
    shipment: shipmentInput({ trackingCode: "REG-TEST-001", serviceType: "Air freight", pickupAddress: "12 Marina Rd, Lagos", deliveryAddress: "1 High St, London", distance: "5,000 km",
      package: { description: "Documents", weight: "2 kg", pieces: "1" }, etaDate: "2030-01-15",
      charges: { currency: "usd", shipping: "1,250.10", customs: "0.20", insurance: "19.99", paymentStatus: "partial", note: "Customer pays customs on arrival" } }) };
  const r = await admin({ action: "registerShipment", ...body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.shipment.id, "REG-TEST-001");
  assert.equal(r.json.customer.status, "active"); assert.equal(r.json.customer.created, true);
  assert.equal(r.json.shipment.charges.total, 127029, "1250.10 + 0.20 + 19.99 = 1270.29, in cents");
  // persisted: reopen the shipment and the client
  const got = await admin({ action: "get", code: "REG-TEST-001" });
  const s = got.json.shipment;
  assert.equal(s.customerId, r.json.customer.id); assert.equal(s.charges.currency, "USD"); assert.equal(s.charges.total, 127029); assert.equal(s.charges.paymentStatus, "partial");
  assert.equal(s.pickupAddress, "12 Marina Rd, Lagos"); assert.equal(s.deliveryAddress, "1 High St, London");
  const c = await admin({ action: "getClient", id: r.json.customer.id });
  assert.equal(c.json.client.shipments.count, 1);
  // the customer signs in and sees exactly this shipment, with fees but without the admin note or addresses
  const login = await signIn("rita@test.example", "secret-123"); assert.equal(login.status, 200);
  const rita = customer(login.json.token);
  const list = await rita({ action: "shipments" });
  assert.deepEqual(list.json.shipments.map((x) => x.code), ["REG-TEST-001"]);
  const view = (await rita({ action: "shipment", code: "REG-TEST-001" })).json.shipment;
  assert.equal(view.charges.totalCents, 127029); assert.equal(view.charges.currency, "USD"); assert.equal(view.charges.paymentStatus, "partial");
  const text = JSON.stringify(view);
  assert.ok(!text.includes("Customer pays customs") && !text.includes("Marina Rd") && !text.includes("High St"), "admin note and street addresses stay private");
  // public tracking never shows the street addresses either
  const pub = await fetch(`${base}/api/track?code=REG-TEST-001`).then((x) => x.json());
  assert.ok(!JSON.stringify(pub).includes("Marina Rd"));

  // the same submission again (double click / retry) creates nothing new
  const before = counts();
  const again = await admin({ action: "registerShipment", ...body });
  assert.equal(again.status, 200); assert.equal(again.json.repeated, true); assert.equal(again.json.shipment.id, "REG-TEST-001");
  assert.deepEqual(counts(), before);

  // another customer cannot open it
  const other = await admin({ action: "saveClient", mode: "create", client: { name: "Otto Other", email: "otto@test.example", password: "secret-123", status: "active" } });
  assert.equal(other.status, 200);
  const otto = customer((await signIn("otto@test.example", "secret-123")).json.token);
  assert.equal((await otto({ action: "shipment", code: "REG-TEST-001" })).status, 404);
  assert.deepEqual((await otto({ action: "shipments" })).json.shipments, []);

  // a status update shows on the existing tracking interface
  assert.equal((await admin({ action: "update", code: "REG-TEST-001", changes: { statusCode: "IN_TRANSIT" } })).status, 200);
  assert.equal((await fetch(`${base}/api/track?code=REG-TEST-001`).then((x) => x.json())).shipment.status.code, "IN_TRANSIT");
  assert.equal((await rita({ action: "shipment", code: "REG-TEST-001" })).json.shipment.status.code, "IN_TRANSIT");
});

test("register: more shipments for an existing customer, no duplicate customer; reassigning needs confirmation", async () => {
  const clients = (await admin({ action: "listClients" })).json.clients;
  const rita = clients.find((c) => c.email === "rita@test.example"); const otto = clients.find((c) => c.email === "otto@test.example");
  const before = counts();
  const r = await admin({ action: "registerShipment", submissionId: sid(), customer: { mode: "existing", id: rita.id }, shipment: shipmentInput() });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.match(r.json.shipment.id, /^[A-Z0-9_-]+$/, "a tracking ID is generated");
  assert.equal(counts().clients, before.clients); assert.equal(counts().shipments, before.shipments + 1);
  assert.equal((await admin({ action: "getClient", id: rita.id })).json.client.shipments.count, 2);
  // trying to put the shipment on another customer is refused unless confirmed
  let u = await admin({ action: "update", code: r.json.shipment.id, changes: { customerId: otto.id } });
  assert.equal(u.status, 409); assert.equal(u.json.error, "reassign_confirm");
  assert.equal((await admin({ action: "get", code: r.json.shipment.id })).json.shipment.customerId, rita.id, "still Rita's");
  u = await admin({ action: "update", code: r.json.shipment.id, changes: { customerId: otto.id, confirmReassign: true } });
  assert.equal(u.status, 200);
  assert.equal((await admin({ action: "get", code: r.json.shipment.id })).json.shipment.customerId, otto.id);
});

test("register: failures save nothing (duplicate ID, invalid fields, a shipment that fails after the customer was created)", async () => {
  const before = counts();
  const newCustomer = (email) => ({ mode: "new", client: { name: "Fay Fail", email, password: "secret-123", status: "active" } });
  // duplicate tracking ID: refused before anything is written
  let r = await admin({ action: "registerShipment", submissionId: sid(), customer: newCustomer("fay1@test.example"), shipment: shipmentInput({ trackingCode: "REG-TEST-001" }) });
  assert.equal(r.status, 409); assert.match(r.json.message, /already used/);
  // invalid inputs: each reports its field
  for (const [shipment, field] of [[shipmentInput({ origin: "" }), "origin"], [shipmentInput({ courier: "" }), "courier"],
    [shipmentInput({ charges: { shipping: "-5", currency: "USD" } }), "fee_shipping"], [shipmentInput({ charges: { shipping: "12.345", currency: "USD" } }), "fee_shipping"],
    [shipmentInput({ charges: { shipping: "10" } }), "currency"], [shipmentInput({ charges: { shipping: "10", currency: "ZZZ" } }), "currency"],
    [shipmentInput({ charges: { other: "5", currency: "EUR" } }), "otherLabel"], [shipmentInput({ trackingCode: "BAD/CODE#1" }), "trackingCode"]]) {
    r = await admin({ action: "registerShipment", submissionId: sid(), customer: newCustomer("fay2@test.example"), shipment });
    assert.equal(r.status, 400, field); assert.equal(r.json.field, field, JSON.stringify(r.json));
  }
  r = await admin({ action: "registerShipment", submissionId: "short", customer: { mode: "none" }, shipment: shipmentInput() });
  assert.equal(r.status, 400); assert.equal(r.json.field, "submissionId");
  // the shipment write fails after the new customer was created: the customer is removed again, no false success
  const failing = sid();
  store.__fault("shipmentWrite");
  try {
    r = await admin({ action: "registerShipment", submissionId: failing, customer: newCustomer("fay3@test.example"), shipment: shipmentInput() });
    assert.equal(r.status, 500); assert.equal(r.json.message, "The request could not be completed.");
  } finally { store.__fault("shipmentWrite", false); }
  assert.deepEqual(counts(), before, "no customer, sign-in account or shipment left behind");
  assert.equal((await signIn("fay3@test.example", "secret-123")).status, 401);
  // the same submission can be retried once the problem is gone, and then saves exactly once
  r = await admin({ action: "registerShipment", submissionId: failing, customer: newCustomer("fay3@test.example"), shipment: shipmentInput() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(counts().clients, before.clients + 1); assert.equal(counts().shipments, before.shipments + 1);
  const afterRetry = counts();
  // unknown existing customer
  r = await admin({ action: "registerShipment", submissionId: sid(), customer: { mode: "existing", id: "uid_doesnotexist" }, shipment: shipmentInput() });
  assert.equal(r.status, 400); assert.equal(r.json.field, "customerId");
  assert.deepEqual(counts(), afterRetry);
});

test("register: refused without an admin session; existing data untouched", async () => {
  const before = counts();
  const r = await admin({ action: "registerShipment", submissionId: sid(), customer: { mode: "none" }, shipment: shipmentInput() }, false);
  assert.equal(r.status, 401);
  const asCustomer = await post("/api/admin", { action: "registerShipment", submissionId: sid(), customer: { mode: "none" }, shipment: shipmentInput() }, { Authorization: "Bearer client-a-token" });
  assert.equal(asCustomer.status, 401);
  assert.deepEqual(counts(), before);
  // the seeded demo shipments and clients are still there and unchanged in shape
  const list = await admin({ action: "list", limit: 100 });
  assert.ok(list.json.items.length >= 1);
});

test("clients: the sign-in email can be corrected; the client then signs in with the new one; duplicates and invalid emails are refused", async () => {
  let r = await admin({ action: "saveClient", mode: "create", client: { name: "Vera Typo", email: "vera@gmil.com", password: "secret-123", status: "active" } });
  assert.equal(r.status, 200); const id = r.json.client.id;
  assert.equal((await signIn("vera@gmil.com", "secret-123")).status, 200);
  r = await admin({ action: "saveClient", mode: "update", id, client: { name: "Vera Typo", email: "Vera@Gmail.com", status: "active" } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.match(r.json.message, /vera@gmail\.com/);
  assert.equal((await admin({ action: "getClient", id })).json.client.email, "vera@gmail.com");
  assert.equal((await signIn("vera@gmail.com", "secret-123")).status, 200, "new email works, same password");
  assert.equal((await signIn("vera@gmil.com", "secret-123")).status, 401, "old email no longer works");
  // another client's email is refused, nothing changes
  const other = await admin({ action: "saveClient", mode: "create", client: { name: "Walt", email: "walt@test.example", password: "secret-123", status: "active" } });
  r = await admin({ action: "saveClient", mode: "update", id: other.json.client.id, client: { name: "Walt", email: "vera@gmail.com", status: "active" } });
  assert.equal(r.status, 409);
  assert.equal((await admin({ action: "getClient", id: other.json.client.id })).json.client.email, "walt@test.example");
  r = await admin({ action: "saveClient", mode: "update", id, client: { name: "Vera Typo", email: "not-an-email", status: "active" } });
  assert.equal(r.status, 400); assert.equal(r.json.field, "email");
  // leaving the email out (e.g. Quick Edit) keeps it
  r = await admin({ action: "saveClient", mode: "update", id, client: { name: "Vera Typo", status: "active", xrp_holdings: 1 } });
  assert.equal(r.status, 200); assert.equal((await admin({ action: "getClient", id })).json.client.email, "vera@gmail.com");
});
