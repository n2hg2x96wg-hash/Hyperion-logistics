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
// waits until opening/closing animations have finished, so boxes are measured where they come to rest
const settle = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
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
  // the detail screen: status, message, the shipment's route and current status; Back returns to the list
  await page.waitForSelector(".nc-view-detail:not([hidden]) .nc-hero-title");
  assert.equal((await page.textContent(".nc-hero-title")).trim(), "Out for Delivery");
  assert.match(await page.textContent(".nc-ship"), new RegExp(codes.a));
  assert.match(await page.textContent(".nc-ship-now"), /Out for Delivery/);
  await page.click(".nc-back");
  await page.waitForSelector(".nc-view-list:not([hidden]) .nc-item");
  await first.locator(".nc-open").click();
  await page.click(".nc-primary"); // View shipment
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
    await page.click(".nc-bell"); await page.waitForSelector(".nc-item"); await settle(page);
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

test("Firebase sign-in (as on the live site): the account check goes to the server, so a blocked browser database read can't leave it stuck on 'Signing in…'", async () => {
  // Firebase Auth SDK stand-in: sign-in succeeds; any browser Firestore read never answers (what happened live)
  const sdk = {
    app: "export const initializeApp=()=>({}),getApps=()=>[];",
    auth: `let user=null;const subs=[];const notify=()=>subs.forEach((f)=>f(user));
      export const getAuth=()=>({get currentUser(){return user;}}),browserSessionPersistence={},setPersistence=async()=>{};
      export const signInWithEmailAndPassword=async(a,email,pw)=>{ if(pw!=="secret-123") throw Object.assign(new Error("bad"),{code:"auth/invalid-credential"});
        user={uid:"uid_fb_test",email,getIdToken:async()=>"fb-test-token"}; setTimeout(notify,0); return {user}; };
      export const signOut=async()=>{user=null;setTimeout(notify,0);};
      export const onAuthStateChanged=(a,cb)=>{subs.push(cb);setTimeout(()=>cb(user),0);return()=>{};};`,
    firestore: "export const getFirestore=()=>({}),doc=()=>({}),getDoc=()=>new Promise(()=>{});"
  };
  for (const [scenario, meStatus, expect] of [["active account", 200, "dashboard"], ["inactive account", 403, "inactive"], ["server error", 500, "error"]]) {
    const { ctx, page, errors } = await customerPage({ width: 390, height: 844 });
    await ctx.route(/gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js/, (r) => {
      const kind = /firebase-(app|auth|firestore)\.js/.exec(r.request().url())[1];
      return r.fulfill({ status: 200, contentType: "text/javascript", body: sdk[kind] });
    });
    const seen = [];
    await ctx.route("**/api/customer", async (r) => {
      const body = JSON.parse(r.request().postData() || "{}"); seen.push(body.action);
      const json = (status, data) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (body.action === "mode") return json(200, { signIn: "firebase" });
      assert.equal(r.request().headers().authorization, "Bearer fb-test-token", "the Firebase ID token is sent");
      if (body.action === "me") return meStatus === 200 ? json(200, { name: "Violet Test", email: "violet@test.example" }) : json(meStatus, { error: "x" });
      if (body.action === "shipments") return json(200, { shipments: [] });
      if (body.action === "notifications") return json(200, { items: [], unread: 0 });
      return json(404, {});
    });
    await page.goto(`${base}/account.html`);
    await page.waitForSelector("#acctEmail");
    await page.fill("#acctEmail", "violet@test.example"); await page.fill("#acctPassword", "secret-123");
    await page.click(".acct-submit");
    if (expect === "dashboard") {
      await page.waitForSelector(".acct-signout", { timeout: 8000 });
      assert.match(await page.textContent("#acctTitle"), /Violet/);
    } else {
      // back on the sign-in form with a clear message, never stuck on "Signing in…"
      await page.waitForFunction(() => document.querySelector(".acct-note")?.textContent.trim(), null, { timeout: 8000 });
      assert.match(await page.textContent(".acct-note"), expect === "inactive" ? /not active/i : /reach the server/i, scenario);
      assert.ok(!(await page.textContent("body")).includes("Signing in…"), scenario);
    }
    assert.ok(seen.includes("me"), `${scenario}: checked on the server`);
    assert.deepEqual(errors, [], scenario);
    await ctx.close();
  }
});

test("install card: shown when the browser offers an install; Install opens the browser's prompt; Not now hides it for good", async () => {
  const { ctx, page, errors } = await customerPage({ width: 390, height: 844 });
  await page.goto(`${base}/account.html`); await page.waitForSelector("#acctEmail");
  assert.equal(await page.locator(".app-install").count(), 0, "nothing until the browser says the app can be installed");
  // the browser's own install event (Chrome/Android), with a prompt we can observe
  await page.evaluate(() => { const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1; }; e.userChoice = Promise.resolve({ outcome: "accepted" });
    dispatchEvent(e); });
  await page.waitForSelector(".app-install .app-install-go");
  assert.match(await page.textContent(".app-install"), /Get the Hyperion app/);
  assert.ok(await noOverflow(page), "no sideways scrolling on a phone");
  await page.click(".app-install-go");
  await page.waitForFunction(() => window.__prompted === 1 && !document.querySelector(".app-install"));
  // offered again later, then dismissed: stays hidden after a reload
  await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = async () => {}; e.userChoice = Promise.resolve({}); dispatchEvent(e); });
  await page.click(".app-install-later");
  assert.equal(await page.locator(".app-install").count(), 0);
  await page.reload(); await page.waitForSelector("#acctEmail");
  await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = async () => {}; e.userChoice = Promise.resolve({}); dispatchEvent(e); });
  assert.equal(await page.locator(".app-install").count(), 0, "'Not now' is remembered");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("install card on iPhone: Share → Add to Home Screen steps (Safari has no install prompt)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = false; });
  await ctx.route(/(fonts\.|tawk\.to|gstatic\.com|tile\.|arcgisonline|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/account.html`); await page.waitForSelector(".app-install");
  // three numbered steps with icons: Share, Add to Home Screen, Add
  assert.equal(await page.locator(".app-install .app-steps li").count(), 3);
  assert.match(await page.textContent(".app-install .app-steps"), /Share.*Add to Home Screen.*Add/s);
  assert.equal(await page.locator(".app-install .app-step-ico svg").count(), 3);
  assert.equal(await page.locator(".app-install-go").count(), 0);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/install-iphone.png`, fullPage: true });
  // in Spanish too
  await page.click(".nav-toggle"); await page.selectOption("#hxLangMenu", "es");
  await page.waitForFunction(() => /Añadir a pantalla de inicio/.test(document.querySelector(".app-install")?.textContent || ""));
  assert.ok(await noOverflow(page));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Android without a browser prompt: the card shows the menu steps; 'Get the app' in the phone menu opens them on any page, even after 'Not now'", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36" });
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = false; });
  await ctx.route(/(fonts\.|tawk\.to|gstatic\.com|tile\.|arcgisonline|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/account.html`); await page.waitForSelector(".app-install .app-steps");
  assert.match(await page.textContent(".app-install .app-steps"), /browser menu.*Install app.*Install/s);
  await page.click(".app-install-later");
  assert.equal(await page.locator(".app-install").count(), 0);
  // another page: the menu item still opens the steps
  await page.goto(`${base}/track.html`);
  await page.click(".nav-toggle"); await page.click("[data-get-app]");
  await page.waitForSelector("dialog.app-dialog[open] .app-steps");
  assert.equal(await page.locator("dialog.app-dialog[open] .app-steps li").count(), 3);
  assert.ok(await page.evaluate(() => { const r = document.querySelector("dialog.app-dialog").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), "dialog fits the screen");
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/get-app-dialog-android.png` });
  await page.click("dialog.app-dialog [data-close]");
  assert.equal(await page.locator("dialog.app-dialog[open]").count(), 0);
  // the menu item is a phone-menu entry only
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.isVisible("[data-get-app]"), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("app feel on a phone: All/Unread tabs and day groups; a notification opens its own screen; shipment details open full screen and the phone's back closes them", async () => {
  const { ctx, page, errors } = await customerPage({ width: 390, height: 844 });
  await signIn(page, "cara@test.example");
  await page.waitForSelector(".acct-ship"); await page.waitForSelector(".nc-bell");
  // a fresh update, so there is something unread today
  assert.equal((await admin({ action: "update", code: codes.a, changes: { statusCode: "IN_TRANSIT" } })).status, 200);
  await page.click(".nc-bell"); await page.waitForSelector(".nc-item.is-unread");
  assert.match(await page.textContent(".nc-group"), /Today/);
  const total = await page.locator(".nc-item").count();
  await page.click('.nc-tab[data-filter="unread"]');
  assert.equal(await page.locator(".nc-item").count(), await page.locator(".nc-item.is-unread").count(), "Unread shows only unread");
  await page.click('.nc-tab[data-filter="all"]');
  assert.equal(await page.locator(".nc-item").count(), total);
  // the sheet fills the screen under the header
  await settle(page);
  const p = await page.locator("#ncPanel").boundingBox();
  assert.ok(p.width >= 389 && p.y + p.height >= 843, `sheet fills the screen ${JSON.stringify(p)}`);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/nc-list-390.png` });
  await page.locator(".nc-item .nc-open").first().click();
  await page.waitForSelector(".nc-view-detail:not([hidden]) .nc-hero"); await settle(page);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/nc-detail-390.png` });
  await page.keyboard.press("Escape"); // back to the list first
  await page.waitForSelector(".nc-view-list:not([hidden])");
  await page.click(".nc-x");
  assert.equal(await page.isHidden("#ncPanel"), true);
  // shipment details: a full screen with a back button; the phone's back gesture closes it
  await page.locator(".acct-ship").first().click();
  await page.waitForSelector("#acctDetails.is-sheet .hx-header"); await settle(page);
  const d = await page.locator("#acctDetails").boundingBox();
  assert.ok(d.width >= 389 && d.y + d.height >= 843, "details fill the screen");
  assert.ok(await page.isVisible(".acct-back"));
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/acct-sheet-390.png` });
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("acctDetails").hidden);
  assert.equal(new URL(page.url()).pathname, "/account.html", "still on the account page");
  // and the back button in the screen
  await page.locator(".acct-ship").first().click();
  await page.waitForSelector("#acctDetails.is-sheet:not([hidden])");
  await page.click(".acct-back");
  await page.waitForFunction(() => document.getElementById("acctDetails").hidden && !document.documentElement.classList.contains("acct-sheet-open"));
  assert.ok(await noOverflow(page));
  assert.deepEqual(errors, []);
  await ctx.close();
});
