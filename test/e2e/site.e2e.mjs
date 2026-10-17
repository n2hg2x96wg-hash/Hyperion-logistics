// Browser regression tests (Playwright) for the public site and the admin workspace, run against the local dev
// server with the in-memory store (never against production data).
//
//   npm run test:e2e
//
// Env:
//   CHROMIUM_PATH   Chromium/Chrome executable (default: Playwright's own browser if installed)
//   HX_CDN_DIR      optional node_modules folder containing leaflet/ and maplibre-gl/ to serve the map libraries
//                   locally when the CDN is unreachable (sandboxes / offline CI)
//   HX_SHOTS        optional folder to write screenshots to
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

const WIDTHS = [320, 360, 390, 430, 768, 1280];
const SHOTS = process.env.HX_SHOTS || null;
let server; let base; let browser;
const codes = {};

before(async () => {
  await __seedDemo();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  // test data through the real admin API
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin.html`);
  assert.equal((await api(page, { action: "login", password: process.env.ADMIN_PASSWORD })).status, 200);
  const create = async (key, shipment) => {
    const r = await api(page, { action: "create", shipment: { courier: "dhl", statusCode: "IN_TRANSIT", ...shipment } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); codes[key] = r.json.shipment.id;
  };
  await create("good", { origin: "Houston, United States", destination: "Lisbon, Portugal", originLat: 29.76, originLng: -95.37, destinationLat: 38.72, destinationLng: -9.14,
    location: "Atlantic Ocean", latitude: 35.1, longitude: -45.2, publicMap: true });
  await create("swapped", { origin: "Lagos, Nigeria", destination: "Accra, Ghana", originLat: 3.3792, originLng: 6.5244, destinationLat: 5.6037, destinationLng: -0.187 });
  await create("none", { origin: "Somewhere", destination: "Elsewhere" });
  await ctx.close();
});
after(async () => { await browser?.close(); server?.close(); });

async function newContext({ width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  const cdn = process.env.HX_CDN_DIR;
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/(leaflet|maplibre-gl)@[^/]+\/dist\/(.*)/, (r) => {
    if (!cdn) return r.continue();
    const m = r.request().url().match(/npm\/(leaflet|maplibre-gl)@[^/]+\/dist\/([^?]+)/);
    let f = m[2]; if (m[1] === "leaflet") f = f.replace(".min.", ".");
    r.fulfill({ status: 200, contentType: f.endsWith("css") ? "text/css" : "text/javascript", body: fs.readFileSync(path.join(cdn, m[1], "dist", f)) });
  });
  // third-party widgets and the legacy client SDK are not under test
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: "text/javascript",
    body: "export const initializeApp=()=>({}),getApps=()=>[],getFirestore=()=>({}),collection=()=>({}),getDocs=async()=>({empty:true,docs:[]}),doc=()=>({}),setDoc=async()=>{},deleteDoc=async()=>{},getDoc=async()=>({exists:()=>false}),onSnapshot=()=>()=>{},serverTimestamp=()=>0,getAuth=()=>({}),createUserWithEmailAndPassword=async()=>{},signOut=async()=>{};" }));
  await ctx.route(/(fonts\.(googleapis|gstatic)\.com|smartsupp|tile\.openstreetmap|arcgisonline)/, (r) => r.abort());
  return ctx;
}
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}
const api = (page, body) => page.evaluate(async (b) => {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}, body);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const w of WIDTHS) {
  test(`public pages at ${w}px: no overflow, shared header, working menu, compact carriers`, async () => {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    let header = null;
    for (const p of ["index.html", "track.html", "tracking-enhanced.html"]) {
      await page.goto(`${base}/${p}`);
      assert.ok(await noOverflow(page), `${p} overflows at ${w}px`);
      const h = await page.$eval("[data-site-header]", (el) => el.outerHTML.replace(/ aria-current="page"/g, "").replace(/\s+/g, " ")); // the current-page marker is added at runtime
      if (header) assert.equal(h, header, `${p} header differs`); header = h;
      assert.equal(await page.locator('a[href*="admin.html"], a[href*="investment.html"]').count(), 0, `${p} links to admin/investments`);
    }
    await page.goto(`${base}/index.html`);
    await shot(page, `home-${w}`);
    const mobile = w <= 900;
    assert.equal(await page.isVisible(".nav-toggle"), mobile);
    if (mobile) {
      const menu = page.locator("#navMenu");
      assert.equal(await menu.isVisible(), false);
      await page.click(".nav-toggle");
      assert.ok(await menu.isVisible());
      // every link is a full-height tap target, and the items don't overlap
      const boxes = await page.$$eval("#navMenu .nav-menu a", (as) => as.map((a) => a.getBoundingClientRect()).map((r) => [r.top, r.bottom, r.height]));
      for (const [i, [, , hgt]] of boxes.entries()) assert.ok(hgt >= 44, `link ${i} is ${hgt}px tall`);
      for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i][0] >= boxes[i - 1][1] - 1, "menu links overlap");
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "hidden", "page scroll is locked while open");
      await shot(page, `menu-${w}`);
      await page.keyboard.press("Escape");
      assert.equal(await menu.isVisible(), false, "Escape closes the menu");
      await page.click(".nav-toggle");
      await page.mouse.click(10, page.viewportSize().height - 20); // the scrim below the open sheet
      assert.equal(await menu.isVisible(), false, "tapping outside closes the menu");
      await page.click(".nav-toggle");
      await page.click('#navMenu a[href="/#carriers"]');
      assert.equal(await menu.isVisible(), false, "choosing a link closes the menu");
    }
    await page.locator("#carriers .cr-tile").first().waitFor();
    const carH = await page.$eval("#carriers", (el) => el.getBoundingClientRect().height);
    assert.ok(carH < 1600, `carrier section is ${Math.round(carH)}px tall`);
    await page.locator("#carriers .cr-tile").first().click();
    assert.ok(await page.isVisible("#cr-detail"));
    if (w <= 720) assert.ok(await page.isVisible("[data-more]"), "phones show a 'Show all' button");
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

for (const w of WIDTHS) {
  test(`freight showcase at ${w}px: image loads, fits the screen, buttons work`, async () => {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/index.html`);
    const sec = page.locator("#freight");
    await sec.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const i = document.querySelector("#freight img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    await page.waitForTimeout(700); // reveal transition
    await shot(page, `freight-${w}`);
    assert.ok(await noOverflow(page), `overflow at ${w}px`);
    const order = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => s.id));
    assert.ok(order.indexOf("activity") + 1 === order.indexOf("freight") && order.indexOf("freight") + 1 === order.indexOf("carriers"), order.join(","));
    assert.equal(await page.locator("#ccStats, [data-stat], [data-countries]").count(), 0, "public statistics block is hidden");
    for (const id of ["#ccMap", "#ccFeed", "#ccTable"]) assert.equal(await page.locator(id).count(), 1, `${id} kept`);
    for (const b of await page.$$eval("#freight .freight-ctas .btn", (bs) => bs.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.right, r.height]; }))) {
      assert.ok(b[2] >= 44, "button height"); assert.ok(b[0] >= 0 && b[1] <= w, "button inside the screen");
    }
    // headline stays readable: not wider than the screen and not clipped
    const h = await page.$eval("#freightTitle", (el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; });
    assert.ok(h[0] >= 0 && h[1] <= w + 1, `headline ${h}`);
    await page.click("#freight .freight-ctas .btn-primary");
    await page.waitForFunction(() => { const r = document.getElementById("services").getBoundingClientRect(); return r.top >= -2 && r.top < 160; }, null, { timeout: 5000 });
    await sec.scrollIntoViewIfNeeded();
    await page.click("#freight .freight-ctas .btn-ghost");
    await page.waitForFunction(() => document.activeElement?.id === "trackingInput", null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("tracking from the hero shows the shipment and keeps markers inside the map", async () => {
  for (const w of [390, 1280]) {
    const ctx = await newContext({ width: w, height: 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/index.html`);
    await page.fill("#trackingInput", codes.good);
    await page.click(".btn-track");
    await page.waitForSelector(".leaflet-container .leaflet-marker-icon", { timeout: 20000 });
    await page.waitForTimeout(800);
    const inside = await page.evaluate(() => {
      const m = document.querySelector(".leaflet-container"); const b = m.getBoundingClientRect();
      return [...m.querySelectorAll(".leaflet-marker-icon")].map((e) => { const r = e.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
    });
    assert.ok(inside.length >= 2 && inside.every(Boolean), `markers outside the map at ${w}px: ${inside}`);
    await shot(page, `tracked-${w}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test("map states: no coordinates shows 'Awaiting location', never an empty world map", async () => {
  const ctx = await newContext({ width: 390, height: 844 });
  const page = await ctx.newPage();
  await page.goto(`${base}/track.html?code=${codes.none}`);
  await page.waitForSelector(".hx-map-msg", { timeout: 15000 });
  assert.match(await page.textContent(".hx-map-msg"), /Awaiting location update/);
  assert.equal(await page.locator(".leaflet-container").count(), 0);
  await ctx.close();
});

test("authorization boundary: admin actions refuse public callers", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${base}/index.html`);
  for (const action of ["list", "locationHealth", "globalMap", "update", "backup"]) {
    const r = await api(page, { action, code: codes.good, changes: { notes: "x" } });
    assert.equal(r.status, 401, `${action} → ${r.status}`);
  }
  await ctx.close();
});

for (const w of [390, 768, 1280]) {
  test(`admin at ${w}px: CRUD, location check and Global Tracking workspace`, async () => {
    const ctx = await newContext({ width: w, height: 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/admin.html`);
    await page.fill("#loginPassword", process.env.ADMIN_PASSWORD);
    await page.click("#loginBtn");
    await page.waitForSelector("#locCheckRows tr", { timeout: 15000 });
    assert.match(await page.textContent("#locCheckSummary"), /coordinate problem/);
    assert.ok((await page.textContent("#locCheckRows")).includes(codes.swapped));
    assert.ok(await noOverflow(page), `admin overview overflows at ${w}px`);
    await shot(page, `admin-overview-${w}`);

    // CRUD on test data (memory store only)
    const c = await api(page, { action: "create", shipment: { origin: "Paris, France", destination: "Rome, Italy", courier: "dhl" } });
    assert.equal(c.status, 200); const code = c.json.shipment.id;
    assert.equal((await api(page, { action: "update", code, changes: { notes: "e2e edit" } })).status, 200);
    assert.equal((await api(page, { action: "archive", code })).status, 200);
    assert.equal((await api(page, { action: "delete", code, confirm: code })).status, 200);

    await page.evaluate(() => window.switchView("globe"));
    await page.waitForSelector("#opsList .ops-row", { timeout: 20000 });
    await page.fill("#opsSearch", "lisbon");
    await page.waitForFunction(() => document.querySelectorAll("#opsList .ops-row").length === 1);
    await page.click("#opsList .ops-row");
    await page.waitForSelector("#opsDetail .ops-facts");
    assert.ok((await page.textContent("#opsDetail")).includes("Houston"));
    assert.ok(await page.isVisible("#opsDetail .ops-timeline"));
    assert.ok(await noOverflow(page), `admin workspace overflows at ${w}px`);
    await shot(page, `admin-globe-${w}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
