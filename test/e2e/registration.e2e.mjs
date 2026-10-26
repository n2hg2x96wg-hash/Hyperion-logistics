// Browser tests (Playwright) for the admin client form and the Register Shipment form, against the local dev server
// with the in-memory store (test data only).
//   CHROMIUM_PATH=... node --test --test-concurrency=1 test/e2e/registration.e2e.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

process.env.STORE = "memory";
process.env.GEOCODER = "off";
process.env.ADMIN_PASSWORD = "e2e-password-123";
process.env.SESSION_SECRET = "e2e-secret-e2e-secret-1234";

const { createServer } = await import("../../dev-server.js");
const { __seedDemo } = await import("../seed.js");
const { getStore } = await import("../../api/_lib/store/index.js");
const SHOTS = process.env.SHOTS_DIR || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let server; let base; let browser; let store;
before(async () => {
  await __seedDemo(); store = await getStore();
  server = createServer(); await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); });

async function adminPage(width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  // the admin page's legacy Firebase client SDK is not under test (same stub as site.e2e.mjs)
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: "text/javascript",
    body: "export const initializeApp=()=>({}),getApps=()=>[],getFirestore=()=>({}),collection=()=>({}),getDocs=async()=>({empty:true,docs:[]}),doc=()=>({}),setDoc=async()=>{},deleteDoc=async()=>{},getDoc=async()=>({exists:()=>false}),onSnapshot=()=>()=>{},serverTimestamp=()=>0,getAuth=()=>({}),createUserWithEmailAndPassword=async()=>{},signOut=async()=>{};" }));
  await ctx.route(/(fonts\.|tawk\.to|cdn\.jsdelivr\.net|tile\.|arcgisonline)/, (r) => r.abort());
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/admin.html`);
  await page.fill("#loginPassword", process.env.ADMIN_PASSWORD); await page.click("#loginBtn");
  await page.waitForFunction(() => !document.getElementById("appRoot").classList.contains("hidden"), null, { timeout: 15000 });
  return { ctx, page, errors };
}
const go = (page, view) => page.evaluate((v) => window.switchView(v), view);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const counts = () => ({ clients: store.__dump().clients.size, shipments: store.__dump().shipments.size });

test("clients form: a clear reason when sign-in accounts can't be created; typed data stays; then it saves", async () => {
  const { ctx, page, errors } = await adminPage(390, 844);
  await go(page, "clients");
  await page.fill("#clientName", "Ivy Interface"); await page.fill("#clientEmail", "ivy@test.example"); await page.fill("#clientPhone", "+44 20 7946 0001");
  // missing password: caught before sending, the field is marked
  await page.click('#clientForm button[type="submit"]');
  assert.match(await page.textContent("#clientFormErr"), /initial password/);
  assert.equal(await page.getAttribute("#clientPassword", "aria-invalid"), "true");
  await page.fill("#clientPassword", "secret-123"); await page.selectOption("#clientStatus", "pending"); await page.fill("#clientAdminNotes", "VIP");
  const before = counts();
  store.__fault("authNotConfigured");
  await page.click('#clientForm button[type="submit"]');
  await page.waitForFunction(() => /Firebase Authentication/.test(document.getElementById("clientFormErr").textContent));
  store.__fault("authNotConfigured", false);
  assert.deepEqual(counts(), before, "nothing saved");
  assert.equal(await page.inputValue("#clientName"), "Ivy Interface", "typed data kept"); assert.equal(await page.inputValue("#clientPassword"), "secret-123");
  await shot(page, "clients-error-390");
  // once Authentication works, the same form saves
  await page.click('#clientForm button[type="submit"]');
  await page.waitForFunction(() => document.getElementById("clientFormErr").hidden && document.getElementById("clientName").value === "");
  await page.waitForFunction(() => /ivy@test\.example/.test(document.getElementById("clientsTableBody").textContent));
  assert.match(await page.textContent("#clientsTableBody"), /Pending/);
  assert.ok(await noOverflow(page), "no sideways scrolling on a phone");
  await shot(page, "clients-saved-390");
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const [w, h] of [[390, 844], [1280, 900]]) {
  test(`register shipment at ${w}px: new customer, fees total, review, save once, result, customer sees it`, async () => {
    const { ctx, page, errors } = await adminPage(w, h);
    await go(page, "create");
    await page.waitForSelector("#view-create.active");
    await page.check('input[name="custMode"][value="new"]');
    const email = `reg${w}@test.example`;
    await page.fill("#regName", `Uma UI ${w}`); await page.fill("#regEmail", email); await page.fill("#regPassword", "secret-123");
    await page.fill("#id", `UI-REG-${w}`); await page.fill("#pkgDescription", "Laptop and charger");
    await page.selectOption("#courier", "dhl"); await page.fill("#serviceType", "Air freight");
    await page.fill("#origin", "Accra, Ghana"); await page.fill("#pickupAddress", "5 Ring Rd, Accra"); await page.fill("#destination", "Berlin, Germany"); await page.fill("#deliveryAddress", "Unter den Linden 1");
    await page.fill("#distanceValue", "5150"); await page.fill("#weightValue", "3.4");
    await page.fill("#feeCurrency", "eur"); await page.fill("#feeShipping", "1,200.50"); await page.fill("#feeCustoms", "99.99"); await page.fill("#feeInsurance", "0.51");
    // the total is computed in whole cents: 1200.50 + 99.99 + 0.51 = 1301.00
    await page.waitForFunction(() => /1,301\.00/.test(document.getElementById("feeTotal").textContent));
    assert.match(await page.textContent("#regReview"), new RegExp(`New: Uma UI ${w}`));
    // a bad amount is caught and pointed at
    await page.fill("#feeHandling", "12.345");
    await page.click('#view-create button[type="submit"]');
    assert.match(await page.textContent("#regErr"), /at most 2 decimals/);
    assert.equal(await page.getAttribute("#feeHandling", "aria-invalid"), "true");
    await page.fill("#feeHandling", "");
    await shot(page, `register-form-${w}`);
    const before = counts();
    // double click: still one customer and one shipment
    await page.dblclick('#view-create button[type="submit"]');
    await page.waitForSelector("#regResult:not([hidden]) .code", { timeout: 15000 }).catch(async (e) => { throw new Error(`no result; form says: ${await page.textContent("#regErr")} | page errors: ${errors.join(" / ")} | toasts: ${await page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" / "))}`); });
    assert.equal(await page.textContent("#regResult .code"), `UI-REG-${w}`);
    assert.match(await page.textContent("#regResult"), /Total EUR 1,301\.00/);
    assert.deepEqual(counts(), { clients: before.clients + 1, shipments: before.shipments + 1 });
    // the form is ready for another shipment for the same customer
    assert.equal(await page.isChecked('input[name="custMode"][value="existing"]'), true);
    assert.notEqual(await page.inputValue("#customerId"), "");
    assert.ok(await noOverflow(page), `no sideways scrolling at ${w}px`);
    await shot(page, `register-saved-${w}`);
    // stored correctly
    const s = store.__dump().shipments.get(`UI-REG-${w}`);
    assert.equal(s.charges.total, 130100); assert.equal(s.charges.currency, "EUR"); assert.equal(s.distance, "5150 km"); assert.equal(s.package.weight, "3.4 kg");
    assert.equal(s.deliveryAddress, "Unter den Linden 1");
    // open it from the result; the edit form shows the saved fees
    await page.evaluate((code) => window.editShipment(code), `UI-REG-${w}`);
    await page.waitForSelector("#shipmentModal.show");
    assert.equal(await page.inputValue("#editFeeShipping"), "1200.50"); assert.equal(await page.inputValue("#editFeeCurrency"), "EUR");
    assert.match(await page.textContent("#editFeeTotal"), /1,301\.00/);
    await page.selectOption("#editPaymentStatus", "paid");
    await page.click('#shipmentForm [type="submit"]');
    await page.waitForFunction(() => !document.getElementById("shipmentModal").classList.contains("show"));
    assert.equal(store.__dump().shipments.get(`UI-REG-${w}`).charges.paymentStatus, "paid");
    assert.deepEqual(errors, []);
    await ctx.close();

    // the customer signs in on the website and sees this shipment with its fees
    const cctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    await cctx.route(/(fonts\.|tawk\.to|gstatic\.com|tile\.|arcgisonline|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const cp = await cctx.newPage(); const cerr = []; cp.on("pageerror", (e) => cerr.push(e.message));
    await cp.goto(`${base}/account.html`); await cp.waitForSelector("#acctEmail");
    await cp.fill("#acctEmail", email); await cp.fill("#acctPassword", "secret-123"); await cp.click(".acct-submit");
    await cp.waitForSelector(".acct-ship");
    assert.deepEqual(await cp.$$eval(".acct-ship-code", (els) => els.map((e) => e.textContent)), [`UI-REG-${w}`]);
    await cp.click(".acct-ship");
    await cp.waitForSelector(".hx-charges");
    const fees = await cp.textContent(".hx-charges");
    assert.match(fees, /1,301\.00/); assert.match(fees, /Paid/); assert.match(fees, /Customs/);
    assert.ok(!(await cp.textContent("body")).includes("Unter den Linden"), "street address stays private");
    assert.ok(await noOverflow(cp));
    await shot(cp, `customer-fees-${w}`);
    assert.deepEqual(cerr, []);
    await cctx.close();
  });
}

test("admin app: 'Get the admin app' in the phone menu opens install steps that fit the screen; the admin manifest is linked", async () => {
  const { ctx, page, errors } = await adminPage(390, 844);
  assert.equal(await page.getAttribute('link[rel="manifest"]', "href"), "/admin.webmanifest");
  await page.click('#tabBar [data-tab="more"]'); // phones open the console menu from the tab bar
  await page.click("#btnGetAdminApp");
  await page.waitForSelector("dialog.aa-dialog[open] .aa-steps");
  // a browser that is neither iPhone nor Android: both sets of steps
  assert.equal(await page.locator("dialog.aa-dialog[open] .aa-steps li").count(), 6);
  assert.match(await page.textContent("dialog.aa-dialog"), /Add to Home Screen/);
  assert.ok(await page.evaluate(() => { const r = document.querySelector("dialog.aa-dialog").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), "dialog fits the screen");
  await shot(page, "admin-get-app-390");
  await page.click("dialog.aa-dialog [data-close]");
  assert.equal(await page.locator("dialog.aa-dialog[open]").count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const [w, h] of [[390, 844], [1280, 900]]) {
  test(`client profile at ${w}px: tap a client → profile with actions, shipments and notifications; a notification opens its own screen; back closes`, async () => {
    const { ctx, page, errors } = await adminPage(w, h);
    const call = (b) => page.evaluate(async (b) => (await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json(), b);
    const email = `profile${w}@test.example`;
    const id = (await call({ action: "saveClient", mode: "create", client: { name: `Pat Profile ${w}`, email, phone: "+44 20 7946 0002", password: "secret-123", status: "active" } })).client.id;
    const code = (await call({ action: "create", shipment: { courier: "dhl", origin: "Accra, Ghana", destination: "Berlin, Germany", customerId: id } })).shipment.id;
    await call({ action: "update", code, changes: { statusCode: "CUSTOMS" } });
    await go(page, "clients");
    await page.waitForSelector(`tr[data-client="${id}"]`);
    await page.click(`tr[data-client="${id}"] td.client-name`); // a tap on the row itself
    await page.waitForSelector(".cp-layer:not([hidden]) .cp-row[data-act='note']");
    assert.equal((await page.textContent(".cp-name")).trim(), `Pat Profile ${w}`);
    assert.ok(await page.isVisible('.cp-act[href^="tel:"]'), "Call shown when there is a phone number");
    assert.match(await page.textContent(".cp-sec .cp-list"), new RegExp(code));
    assert.ok((await page.locator(".cp-note-row").count()) >= 2, "registration + customs notifications");
    const box = await page.locator(".cp").boundingBox();
    if (w < 500) assert.ok(box.width >= w - 1 && box.height >= h - 1, "full screen on a phone");
    else assert.ok(box.width < w && box.x > 0, "a panel on a computer");
    assert.ok(await noOverflow(page));
    await page.waitForTimeout(300); await shot(page, `client-profile-${w}`);
    // a notification's own screen
    await page.locator(".cp-note-row").first().click();
    await page.waitForSelector(".cp-note:not([hidden]) .cp-note-hero");
    assert.match(await page.textContent(".cp-note"), /Not yet|Read by the client/);
    await page.waitForTimeout(300); await shot(page, `client-notification-${w}`);
    await page.keyboard.press("Escape"); // back to the profile
    await page.waitForSelector(".cp-main:not([hidden])");
    // a shipment opens the usual editor above the profile
    await page.click(`.cp-row[data-act="ship"][data-code="${code}"]`);
    await page.waitForSelector("#shipmentModal.show");
    const top = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("#shipmentModal") != null);
    assert.ok(top, "the shipment editor is above the profile");
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.getElementById("shipmentModal").classList.remove("show"));
    // closing: the back button on phones (and the phone's back gesture), the ✕ on computers
    if (w < 500) {
      await page.goBack();
      await page.waitForFunction(() => document.querySelector(".cp-layer").hidden);
      assert.match(page.url(), /admin\.html/);
      await page.click(`tr[data-client="${id}"] td.client-name`); await page.waitForSelector(".cp-layer:not([hidden]) .cp-name");
      await page.click(".cp-back");
    } else await page.click(".cp-x");
    await page.waitForFunction(() => document.querySelector(".cp-layer").hidden && !document.documentElement.classList.contains("cp-open"));
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
