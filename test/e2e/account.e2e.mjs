// Browser tests (Playwright) for the customer "My account" page and notification center, against the local dev server
// with the in-memory store (test accounts and test shipments only).
//   CHROMIUM_PATH=... node --test --test-concurrency=1 test/e2e/account.e2e.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

process.env.STORE = "memory";
process.env.GEOCODER = "off";
process.env.ADMIN_PASSWORD = "e2e-password-123";
process.env.SESSION_SECRET = "e2e-secret-e2e-secret-1234";

const { createServer } = await import("../../dev-server.js");
const { __seedDemo } = await import("../seed.js");

let server; let base; let browser; let adminCtx; let adminPage;
const ids = {}; const codes = {};

const admin = (body) => adminPage.evaluate(async (b) => {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
}, body);

before(async () => {
  await __seedDemo();
  server = createServer(); await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // the admin page's legacy Firebase client SDK is not under test (same stub as site.e2e.mjs)
  await adminCtx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: "text/javascript",
    body: "export const initializeApp=()=>({}),getApps=()=>[],getFirestore=()=>({}),collection=()=>({}),getDocs=async()=>({empty:true,docs:[]}),doc=()=>({}),setDoc=async()=>{},deleteDoc=async()=>{},getDoc=async()=>({exists:()=>false}),onSnapshot=()=>()=>{},serverTimestamp=()=>0,getAuth=()=>({}),createUserWithEmailAndPassword=async()=>{},signOut=async()=>{};" }));
  await adminCtx.route(/(fonts\.|tawk\.to|cdn\.jsdelivr\.net)/, (r) => r.abort());
  adminPage = await adminCtx.newPage();
  await adminPage.goto(`${base}/admin.html`);
  assert.equal((await admin({ action: "login", password: process.env.ADMIN_PASSWORD })).status, 200);
  for (const [key, name, email] of [["cara", "Cara Test", "cara@test.example"], ["dan", "Dan Test", "dan@test.example"]]) {
    assert.equal((await admin({ action: "saveClient", mode: "create", client: { name, email, password: "secret-123", status: "active" } })).status, 200);
    ids[key] = (await admin({ action: "listClients" })).json.clients.find((c) => c.email === email).id;
  }
  const mk = async (key, shipment) => { const r = await admin({ action: "create", shipment: { courier: "dhl", ...shipment } }); assert.equal(r.status, 200, JSON.stringify(r.json)); codes[key] = r.json.shipment.id; };
  await mk("a", { origin: "Lagos, Nigeria", destination: "London, United Kingdom", customerId: ids.cara });
  await mk("b", { courier: "maersk", origin: "Shanghai, China", destination: "Rotterdam, Netherlands", customerId: ids.cara });
  await mk("other", { origin: "Accra, Ghana", destination: "Paris, France" }); // not linked to anyone
  for (const st of ["PICKED_UP", "IN_TRANSIT"]) assert.equal((await admin({ action: "update", code: codes.a, changes: { statusCode: st } })).status, 200);
  assert.equal((await admin({ action: "update", code: codes.b, changes: { statusCode: "DELAYED" } })).status, 200);
});
after(async () => { await browser?.close(); server?.close(); });

async function customerPage({ width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = false; });
  await ctx.route(/(fonts\.|tawk\.to|gstatic\.com|tile\.|arcgisonline|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
async function signIn(page, email, password = "secret-123") {
  await page.goto(`${base}/account.html`);
  await page.waitForSelector("#acctEmail");
  await page.fill("#acctEmail", email); await page.fill("#acctPassword", password);
  await page.click(".acct-submit");
}
/** Unread count as stored on the server (the same API the page uses, with the page's own sign-in). */
const storedUnread = (page) => page.evaluate(async () => {
  const token = sessionStorage.getItem("hx-account-dev-token");
  const r = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "notifications" }) });
  return (await r.json()).unread;
});
const badge = async (page) => ((await page.locator(".nc-badge").isHidden()) ? 0 : Number((await page.textContent(".nc-badge")).replace("+", "")));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("sign-in: wrong password is explained; the right one opens the account with the customer's shipments only", async () => {
  const { ctx, page, errors } = await customerPage();
  await signIn(page, "cara@test.example", "wrong-password");
  await page.waitForFunction(() => document.getElementById("acctError")?.textContent.trim());
  assert.equal(await page.textContent("#acctError"), "The email or password is incorrect.");
  await page.fill("#acctPassword", "secret-123"); await page.click(".acct-submit");
  await page.waitForSelector(".acct-ship");
  assert.equal(await page.textContent("#acctTitle"), "Hello, Cara");
  const listed = await page.$$eval(".acct-ship-code", (els) => els.map((e) => e.textContent));
  assert.deepEqual(listed.sort(), [codes.a, codes.b].sort(), "own shipments only");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("bell: unread count matches the stored notifications; the panel lists them newest first with read states", async () => {
  const { ctx, page, errors } = await customerPage();
  await signIn(page, "cara@test.example");
  await page.waitForSelector(".nc-badge:not([hidden])");
  const stored = await storedUnread(page);
  assert.equal(stored, 5, "registered ×2, picked up, in transit, delayed");
  assert.equal(await badge(page), stored);
  assert.equal(await page.getAttribute(".nc-bell", "aria-label"), `Notifications, ${stored} unread`);
  await page.click(".nc-bell");
  await page.waitForSelector(".nc-item");
  assert.equal(await page.getAttribute(".nc-bell", "aria-expanded"), "true");
  const titles = await page.$$eval(".nc-item .nc-title", (els) => els.map((e) => e.textContent.replace(/^Unread: /, "").trim()));
  assert.equal(titles.length, 5);
  assert.equal(titles[0], "Delayed");
  assert.equal(await page.locator(".nc-item.is-unread").count(), 5);
  assert.match(await page.textContent(".nc-item .nc-msg"), new RegExp(`Shipment ${codes.b} is now: Delayed\\.`));
  assert.ok((await page.textContent(".nc-item .nc-time")).match(/\d{4}/), "date and time shown");
  // keyboard: Escape closes and returns focus to the bell
  await page.keyboard.press("Escape");
  assert.equal(await page.isHidden("#ncPanel"), true);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("nc-bell")), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("read state: one, then all; stored on the server, so it survives a reload and a new sign-in", async () => {
  const { ctx, page, errors } = await customerPage();
  await signIn(page, "cara@test.example");
  await page.waitForSelector(".nc-badge:not([hidden])");
  const start = await badge(page);
  await page.click(".nc-bell"); await page.waitForSelector(".nc-item");
  await page.click(".nc-item.is-unread .nc-read");
  await page.waitForFunction((n) => document.querySelectorAll(".nc-item.is-unread").length === n, start - 1);
  assert.equal(await badge(page), start - 1); assert.equal(await storedUnread(page), start - 1);
  await page.reload(); await page.waitForSelector(".nc-badge:not([hidden])");
  assert.equal(await badge(page), start - 1, "after reload");
  await page.click(".acct-signout"); await page.waitForSelector("#acctEmail");
  assert.equal(await page.locator(".nc-bell").count(), 0, "no bell when signed out");
  await page.fill("#acctEmail", "cara@test.example"); await page.fill("#acctPassword", "secret-123"); await page.click(".acct-submit");
  await page.waitForSelector(".nc-badge:not([hidden])");
  assert.equal(await badge(page), start - 1, "after signing in again");
  await page.click(".nc-bell"); await page.waitForSelector(".nc-item");
  await page.click(".nc-all");
  await page.waitForFunction(() => !document.querySelector(".nc-item.is-unread"));
  assert.equal(await badge(page), 0); assert.equal(await page.isHidden(".nc-badge"), true); assert.equal(await storedUnread(page), 0);
  assert.equal(await page.isHidden(".nc-all"), true, "nothing left to mark");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a new status saved by an admin appears; saving it again adds nothing; opening a notification shows that shipment", async () => {
  const { ctx, page, errors } = await customerPage();
  await signIn(page, "cara@test.example");
  await page.waitForSelector(".acct-ship");
  const before = await storedUnread(page);
  assert.equal((await admin({ action: "update", code: codes.a, changes: { statusCode: "OUT_FOR_DELIVERY" } })).status, 200);
  assert.equal((await admin({ action: "update", code: codes.a, changes: { statusCode: "OUT_FOR_DELIVERY" } })).status, 200);
  await page.click(".nc-bell"); // opening the panel reloads the list
  await page.waitForFunction((n) => document.querySelectorAll(".nc-item.is-unread").length === n, before + 1);
  assert.equal(await storedUnread(page), before + 1, "exactly one new notification");
  const first = page.locator(".nc-item").first();
  assert.match(await first.textContent(), /Out for Delivery/);
  await first.locator(".nc-open").click();
  await page.waitForSelector(".hx-header .hx-pill");
  assert.equal(await page.textContent(".hx-code"), codes.a, "the notification opened its own shipment");
  assert.equal((await page.textContent(".hx-header .hx-pill")).trim(), "Out for Delivery");
  await page.waitForFunction((n) => (Number(document.querySelector(".nc-badge")?.textContent) || 0) === n || document.querySelector(".nc-badge").hidden, before);
  assert.equal(await storedUnread(page), before, "opening it marked it read");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("another customer sees only their own (empty) center and cannot open someone else's shipment", async () => {
  const { ctx, page, errors } = await customerPage({ width: 390, height: 844 });
  await signIn(page, "dan@test.example");
  await page.waitForSelector(".acct-empty");
  assert.match(await page.textContent(".acct-empty"), /No shipments are linked to your account yet\./);
  await page.waitForSelector(".nc-bell");
  assert.equal(await badge(page), 0);
  await page.click(".nc-bell"); await page.waitForSelector(".nc-state");
  assert.match(await page.textContent(".nc-state"), /You're all caught up/);
  const probe = await page.evaluate(async (code) => {
    const token = sessionStorage.getItem("hx-account-dev-token");
    const r = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "shipment", code }) });
    return r.status;
  }, codes.a);
  assert.equal(probe, 404, "Cara's shipment is not reachable from Dan's account");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("loading and failure states: a slow or failed request shows a clear state with a working retry", async () => {
  const { ctx, page, errors } = await customerPage();
  let mode = "slow";
  await page.route("**/api/customer", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action !== "notifications" || mode === "ok") return route.continue();
    if (mode === "slow") { await new Promise((r) => setTimeout(r, 1200)); return route.continue(); }
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal" }) });
  });
  await signIn(page, "dan@test.example");
  await page.waitForSelector(".nc-bell");
  mode = "slow"; await page.click(".nc-bell");
  await page.waitForSelector(".nc-skel", { timeout: 1000 });
  await page.waitForSelector(".nc-state");
  await page.click(".nc-bell"); // close
  mode = "fail"; await page.click(".nc-bell");
  await page.waitForSelector(".nc-retry");
  assert.match(await page.textContent(".nc-state"), /Notifications could not be loaded/);
  mode = "ok"; await page.click(".nc-retry");
  await page.waitForFunction(() => /all caught up/.test(document.querySelector(".nc-state")?.textContent || ""));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("layout: phone and desktop, panel inside the screen, header controls never covered, no sideways scrolling", async () => {
  for (const [width, height] of [[360, 760], [390, 844], [768, 1024], [1024, 768], [1280, 900]]) {
    const { ctx, page, errors } = await customerPage({ width, height });
    await signIn(page, "cara@test.example");
    await page.waitForSelector(".acct-ship"); await page.waitForSelector(".nc-bell");
    assert.ok(await noOverflow(page), `${width}: no sideways scroll`);
    const toggle = width <= 900 ? ".nav-toggle" : ".nav-cta";
    const box = await page.locator(toggle).boundingBox();
    assert.ok(box && box.x + box.width <= width + 0.5, `${width}: ${toggle} fully visible`);
    await page.click(".nc-bell"); await page.waitForSelector(".nc-item");
    const p = await page.locator("#ncPanel").boundingBox();
    assert.ok(p.x >= 0 && p.x + p.width <= width + 0.5 && p.y + p.height <= height + 0.5, `${width}: panel within the screen ${JSON.stringify(p)}`);
    const bell = await page.locator(".nc-bell").boundingBox();
    assert.ok(p.y >= bell.y + bell.height - 1, `${width}: the panel opens below the header`);
    assert.ok(await noOverflow(page), `${width}: no sideways scroll with the panel open`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test("admin: the customer picker links a shipment from the edit form; the account then shows it", async () => {
  const page = await adminCtx.newPage();
  await page.goto(`${base}/admin.html`);
  await page.waitForFunction(() => typeof window.editShipment === "function" && !document.getElementById("appRoot").classList.contains("hidden"), null, { timeout: 15000 });
  await page.evaluate((code) => window.editShipment(code), codes.other);
  await page.waitForSelector("#shipmentModal.show");
  assert.equal(await page.isVisible("#shipmentCustomerInput"), true, "picker visible for admins");
  assert.equal(await page.inputValue("#shipmentCustomerInput"), "", "not linked yet");
  await page.selectOption("#shipmentCustomerInput", ids.dan);
  await page.click('#shipmentForm [type="submit"]');
  await page.waitForFunction(() => !document.getElementById("shipmentModal").classList.contains("show"));
  const got = await admin({ action: "get", code: codes.other });
  assert.equal(got.json.shipment.customerId, ids.dan);
  const { ctx, page: cp } = await customerPage();
  await signIn(cp, "dan@test.example");
  await cp.waitForSelector(".acct-ship");
  assert.deepEqual(await cp.$$eval(".acct-ship-code", (els) => els.map((e) => e.textContent)), [codes.other]);
  assert.equal(await badge(cp), 0, "linking alone does not resend past updates");
  await ctx.close(); await page.close();
});
