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
  // a sea shipment with recorded checkpoints (for the stage photo, route overlay and 3D view)
  await create("sea", { courier: "maersk", origin: "Shanghai, China", destination: "Rotterdam, Netherlands" });
  for (const location of ["Port of Shanghai, China", "Port of Singapore", "Suez Canal, Egypt"])
    assert.equal((await api(page, { action: "addEvent", code: codes.sea, statusCode: "IN_TRANSIT", location, description: "In transit", applyToShipment: true })).status, 200);
  await create("hub", { courier: "dhl", statusCode: "AT_FACILITY", origin: "Lagos, Nigeria", destination: "London, United Kingdom" });
  await ctx.close();
});
after(async () => { await browser?.close(); server?.close(); });

async function newContext({ width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  // this browser draws WebGL in software, which the viewer would (correctly) decline as too slow; tests opt out of that check
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = false; });
  const cdn = process.env.HX_CDN_DIR;
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/(leaflet|maplibre-gl|three)@[^/]+\/(dist|build)\/(.*)/, (r) => {
    if (!cdn) return r.continue();
    const m = r.request().url().match(/npm\/(leaflet|maplibre-gl|three)@[^/]+\/(dist|build)\/([^?]+)/);
    let f = m[3]; if (m[1] === "leaflet") f = f.replace(".min.", ".");
    r.fulfill({ status: 200, contentType: f.endsWith("css") ? "text/css" : "text/javascript", body: fs.readFileSync(path.join(cdn, m[1], m[2], f)) });
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
    // public directory identifies carriers only: no internal update methods, no partnership or live-API claims
    const carriersText = await page.textContent("#carriers");
    for (const t of ["Manual updates", "Live API", "Official tracking link", "How updates reach", "Verified partner"]) assert.ok(!carriersText.includes(t), `public carriers show "${t}"`);
    assert.equal(await page.locator("#carrierLegend, .cr-legend").count(), 0);
    await page.locator("#carriers .cr-tile").first().click();
    assert.ok(await page.isVisible("#cr-detail"));
    assert.ok(!/(Manual updates|Live API|How updates reach)/.test(await page.textContent("#cr-detail")));
    if (w <= 720) assert.ok(await page.isVisible("[data-more]"), "phones show a 'Show all' button");
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

for (const w of WIDTHS) {
  test(`freight showcase at ${w}px: image loads, fits the screen, buttons work`, async () => {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    // flat map: the globe (software-rendered in headless test browsers) would compete with the scroll animations under test
    await page.goto(`${base}/index.html?map=flat`);
    const sec = page.locator("#freight");
    await sec.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const i = document.querySelector("#freight img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    await page.waitForTimeout(700); // reveal transition
    await shot(page, `freight-${w}`);
    // the real photo is used, with the ship-centred crop on phones (never the fallback illustration)
    const src = await page.$eval("#freight img", (i) => i.currentSrc);
    assert.match(src, w <= 640 ? /assets\/freight\/ship-mobile-\d+\.(avif|webp|jpg)$/ : /assets\/freight\/ship-\d+\.(avif|webp|jpg)$/, src);
    assert.ok(await noOverflow(page), `overflow at ${w}px`);
    const order = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => s.id));
    assert.ok(order.indexOf("activity") + 1 === order.indexOf("freight") && order.indexOf("freight") + 1 === order.indexOf("journey") && order.indexOf("journey") + 1 === order.indexOf("services"), order.join(","));
    assert.equal(await page.locator("#ccStats, [data-stat], [data-countries]").count(), 0, "public statistics block is hidden");
    for (const id of ["#ccMap", "#ccFeed", "#ccTable"]) assert.equal(await page.locator(id).count(), 1, `${id} kept`);
    for (const b of await page.$$eval("#freight .freight-ctas .btn", (bs) => bs.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.right, r.height]; }))) {
      assert.ok(b[2] >= 44, "button height"); assert.ok(b[0] >= 0 && b[1] <= w, "button inside the screen");
    }
    // headline stays readable: not wider than the screen and not clipped
    const h = await page.$eval("#freightTitle", (el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; });
    assert.ok(h[0] >= 0 && h[1] <= w + 1, `headline ${h}`);
    // the two buttons don't overlap; service cards in a row share one height
    const bx = await page.$$eval("#freight .freight-ctas .btn", (bs) => bs.map((x) => x.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
    assert.ok(bx[0].r <= bx[1].l + 1 || bx[0].b <= bx[1].t + 1, "buttons overlap");
    const rows = await page.$$eval("#freight .freight-card", (cs) => cs.map((c) => c.getBoundingClientRect()).map((r) => [Math.round(r.top), Math.round(r.height)]));
    assert.equal(rows.length, 4);
    for (const [top, h] of rows) for (const [t2, h2] of rows) if (Math.abs(top - t2) < 2) assert.ok(Math.abs(h - h2) < 2, `card heights differ: ${h} vs ${h2}`);
    await page.click("#freight .freight-ctas .btn-primary");
    await page.waitForFunction(() => { const r = document.getElementById("services").getBoundingClientRect(); return r.top >= -2 && r.top < 160; }, null, { timeout: 5000 });
    await sec.scrollIntoViewIfNeeded();
    await page.click("#freight .freight-ctas .btn-ghost");
    await page.waitForFunction(() => document.activeElement?.id === "trackingInput", null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("freight showcase: a photo that fails to load falls back to the illustration", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  await ctx.route(/\/assets\/freight\//, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(`${base}/index.html?map=flat`);
  // simulate a broken photo even before one is installed: point the image at a blocked file
  // (the photo now sits close to the top, so its own failed request may already have triggered the fallback)
  await page.$eval("#freight img", (i) => { if (!i.dataset.fallback) { i.loading = "eager"; i.src = "assets/freight/missing.webp"; } });
  await page.waitForFunction(() => { const i = document.querySelector("#freight img"); return i.complete && i.naturalWidth > 0 && i.src.endsWith("freight-ship.svg"); }, null, { timeout: 10000 });
  await ctx.close();
});

for (const w of WIDTHS) {
  test(`logistics journey at ${w}px: placement, image, reveal without layout shift, button`, async () => {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/index.html?map=flat`);
    const order = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => s.id));
    assert.ok(order.indexOf("freight") + 1 === order.indexOf("journey") && order.indexOf("journey") + 1 === order.indexOf("services"), order.join(","));
    assert.equal(await page.locator("#ccStats, [data-stat]").count(), 0, "statistics block stays hidden");
    // the frame reserves its size before the lazy image arrives
    const before = await page.$eval("#journey .journey-parallax", (e) => e.getBoundingClientRect().height);
    assert.ok(before > 100, "image box reserved before load");
    await page.locator("#journey").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 100));
    await page.waitForFunction(() => { const i = document.querySelector("#journey img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".journey-frame").classList.contains("is-visible"), null, { timeout: 5000 });
    await page.waitForTimeout(1600);
    const after = await page.$eval("#journey .journey-parallax", (e) => e.getBoundingClientRect().height);
    assert.ok(Math.abs(after - before) < 1, `layout shift: ${before} → ${after}`);
    const st = await page.$eval(".journey-frame", (f) => ({ op: getComputedStyle(f).opacity, src: f.querySelector("img").currentSrc }));
    assert.equal(st.op, "1");
    assert.match(st.src, w <= 640 ? /assets\/journey\/handover-mobile-\d+\.(avif|webp|jpg)$/ : /assets\/journey\/handover-\d+\.(avif|webp|jpg)$/, st.src);
    assert.ok(await noOverflow(page), `overflow at ${w}px`);
    await page.waitForFunction(() => [...document.querySelectorAll("#journey .journey-steps > li")].every((li) => li.classList.contains("is-visible")), null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const steps = await page.$$eval("#journey .journey-steps > li", (ls) => ls.map((l) => ({ t: l.querySelector("strong").textContent, op: getComputedStyle(l).opacity, d: parseFloat(getComputedStyle(l).transitionDelay) })));
    assert.deepEqual(steps.map((x) => x.t), ["Warehouse processing", "Transit and handling", "Final delivery"]);
    assert.ok(steps.every((x) => x.op === "1"), "every milestone visible");
    assert.ok(steps[0].d < steps[1].d && steps[1].d < steps[2].d, "milestones appear in sequence");
    assert.ok(["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(await page.$eval("#journey .journey-steps", (o) => getComputedStyle(o, "::after").transform)), "connector fully drawn");
    await shot(page, `journey-${w}`);
    await page.click("#journey .link-arrow");
    await page.waitForFunction(() => document.activeElement?.id === "trackingInput", null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("logistics journey: reduced motion shows everything at once; a failed image leaves a clean panel", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await ctx.route(/gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com|smartsupp|cdn\.jsdelivr\.net/, (r) => r.abort());
  await ctx.route(/\/assets\/journey\//, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(`${base}/index.html?map=flat`);
  const st = await page.$eval(".journey-frame", (f) => { const cs = getComputedStyle(f); return { op: cs.opacity, clip: cs.clipPath, anim: getComputedStyle(f.querySelector(".journey-parallax")).animationName }; });
  assert.equal(st.op, "1"); assert.equal(st.clip, "none"); assert.equal(st.anim, "none");
  assert.equal(await page.$eval("#journeyTitle", (h) => getComputedStyle(h).opacity), "1", "text visible without scrolling");
  assert.deepEqual(await page.$$eval("#journey .journey-steps > li", (ls) => ls.map((l) => getComputedStyle(l).opacity)), ["1", "1", "1"], "milestones visible without scrolling");
  assert.equal(await page.$eval("#journey .journey-steps", (o) => getComputedStyle(o, "::after").transform), "none", "connector drawn without animation");
  assert.equal(await page.$eval(".hero3-media", (m) => getComputedStyle(m).animationName), "none", "no hero entrance animation");
  await page.locator("#journey").scrollIntoViewIfNeeded();
  await page.evaluate(() => { const i = document.querySelector("#journey .journey-frame img"); if (i) i.loading = "eager"; }); // may already have failed
  await page.waitForFunction(() => document.querySelector(".journey-frame").classList.contains("is-missing"), null, { timeout: 10000 });
  assert.equal(await page.locator("#journey .journey-frame img").count(), 0, "broken image removed");
  const h = await page.$eval("#journey .journey-parallax", (e) => e.getBoundingClientRect().height);
  assert.ok(h > 100, "panel keeps its size");
  await ctx.close();
});

test("shared shipments: published shipments show masked rows; an empty list hides the whole section; a failed load is an error, not empty", async () => {
  const visible = (page) => page.evaluate(() => { const s = document.getElementById("activity"); return { hidden: s.hidden, state: s.dataset.state, h: s.getBoundingClientRect().height,
    nav: [...document.querySelectorAll('a[href="/#activity"]')].map((a) => a.offsetParent !== null) }; });
  // 1. real data: the seeded store has one shipment published for the homepage
  let ctx = await newContext({ width: 390, height: 844 });
  let page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/index.html?map=flat`);
  await page.waitForFunction(() => document.getElementById("activity").dataset.state === "ready", null, { timeout: 10000 });
  let v = await visible(page);
  assert.equal(v.hidden, false); assert.ok(v.h > 200);
  const rows = await page.$$eval("#ccTable tr", (rs) => rs.map((r) => r.textContent));
  assert.ok(rows.length >= 1 && !rows.some((t) => t.includes("No shipments")), rows.join(" | "));
  const text = await page.textContent("#activity");
  assert.ok(!text.includes(codes.good) && !text.includes(codes.swapped) && !text.includes(codes.none), "full tracking numbers never shown");
  assert.ok(text.includes("••"), "codes are masked");
  assert.ok(!text.includes("Lagos") && !text.includes("Somewhere"), "unpublished shipments are not shown");
  assert.ok(await noOverflow(page));
  await shot(page, "activity-ready-390");
  assert.deepEqual(errors, []);
  await ctx.close();

  // 2. genuinely empty public list (same response shape as the API): the section and its links disappear without a gap
  ctx = await newContext({ width: 390, height: 844 });
  await ctx.route(/\/api\/public\?view=overview/, (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ routes: [], activity: [], stats: { active: 0, inTransit: 0, delivered: 0, countriesActive: 0, activeCountries: [] }, version: "empty", generatedAt: new Date().toISOString() }) }));
  page = await ctx.newPage();
  await page.goto(`${base}/index.html?map=flat`);
  await page.waitForFunction(() => document.getElementById("activity").dataset.state === "empty", null, { timeout: 10000 });
  v = await visible(page);
  assert.equal(v.hidden, true); assert.equal(v.h, 0, "no reserved space"); assert.ok(v.nav.every((x) => !x), "links to the section hidden");
  const gap = await page.evaluate(() => document.getElementById("freight").getBoundingClientRect().top - document.getElementById("track").getBoundingClientRect().bottom
    - document.getElementById("results-section").getBoundingClientRect().height);
  assert.ok(gap >= 0 && gap < 4, `hero/results flow straight into freight (gap ${gap}px)`);
  assert.ok(await noOverflow(page));
  await shot(page, "activity-empty-390");
  await ctx.close();

  // 3. the request fails: recorded as an error, the section stays hidden, nothing on the page breaks
  ctx = await newContext({ width: 1280, height: 900 });
  await ctx.route(/\/api\/public\?view=overview/, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  page = await ctx.newPage();
  await page.goto(`${base}/index.html?map=flat`);
  await page.waitForFunction(() => document.getElementById("activity").dataset.state === "error", null, { timeout: 10000 });
  v = await visible(page);
  assert.equal(v.hidden, true);
  assert.match(await page.textContent("#ccStatus"), /temporarily unavailable/i, "the failure is reported as unavailable, not as 'no shipments'");
  await page.fill("#trackingInput", codes.good); await page.click(".btn-track");
  await page.waitForFunction((c) => document.getElementById("trackerRoot").textContent.includes(c), codes.good, { timeout: 15000 }); // tracking unaffected
  await ctx.close();
});

for (const w of [390, 768, 1280]) {
  test(`hero at ${w}px: scene visible, readable copy, CTA focuses the real tracking form`, async () => {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/index.html?map=flat`);
    const hero = await page.evaluate(() => {
      const m = getComputedStyle(document.querySelector(".hero3-media"));
      const h1 = document.getElementById("heroTitle").getBoundingClientRect();
      return { bg: m.backgroundImage, h1: [h1.left, h1.right], text: document.getElementById("heroTitle").textContent };
    });
    assert.match(hero.bg, w <= 640 ? /assets\/hero\/scene-mobile\.svg/ : /assets\/hero\/scene\.svg/);
    assert.equal(hero.text, "Every shipment. Every milestone. One clear view.");
    assert.ok(hero.h1[0] >= 0 && hero.h1[1] <= w + 1, `headline fits: ${hero.h1}`);
    const scene = await page.evaluate(async (url) => (await fetch(url)).status, w <= 640 ? "/assets/hero/scene-mobile.svg" : "/assets/hero/scene.svg");
    assert.equal(scene, 200);
    await page.waitForTimeout(1800); // entrance animation finished
    assert.deepEqual(await page.$$eval(".hero3-copy > *", (els) => els.map((e) => getComputedStyle(e).opacity)).then((o) => [...new Set(o)]), ["1"], "all hero copy visible after the entrance");
    assert.ok(await noOverflow(page));
    await shot(page, `hero-${w}`);
    // CTA → focus the input; unknown code → clear message; real code → real result
    await page.click('.hero3-ctas a[data-focus-track]');
    await page.waitForFunction(() => document.activeElement?.id === "trackingInput", null, { timeout: 5000 });
    await page.fill("#trackingInput", "HY-000000");
    await page.press("#trackingInput", "Enter");
    await page.waitForFunction(() => /Tracking number not found/.test(document.getElementById("trackerRoot").textContent), null, { timeout: 10000 });
    await page.fill("#trackingInput", codes.good);
    await page.click(".btn-track");
    await page.waitForFunction((c) => document.getElementById("trackerRoot").textContent.includes(c), codes.good, { timeout: 15000 });
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

test("theme toggle: switches, persists across pages and the admin, applies before first paint, keeps text readable", async () => {
  const ctx = await newContext({ width: 390, height: 844 });
  const page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/index.html?map=flat`);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || "dark");
  assert.equal(await theme(), "dark", "dark by default");
  const btn = page.locator(".site-nav [data-theme-toggle]");
  assert.ok(await btn.isVisible(), "toggle visible on phones without opening the menu");
  const box = await btn.boundingBox(); assert.ok(box.width >= 40 && box.height >= 40, "comfortable tap target");
  assert.equal(await btn.getAttribute("aria-pressed"), "false");
  await btn.click();
  assert.equal(await theme(), "light"); assert.equal(await btn.getAttribute("aria-pressed"), "true");
  assert.equal(await btn.getAttribute("aria-label"), "Switch to dark theme");
  assert.equal(await page.$eval('meta[name="theme-color"]', (m) => m.content), "#f5f8fe");
  // next page: the saved choice is applied by the inline <head> script, before stylesheets and module scripts run
  await page.goto(`${base}/track.html`, { waitUntil: "commit" });
  await page.waitForFunction(() => document.readyState !== "loading" || document.documentElement.dataset.theme);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.waitForLoadState("load");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, "rgb(245, 248, 254)", "light page background");
  // a tracking result in the light theme: dark text on light cards
  await page.fill("#trackingInput", codes.good); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-header .hx-code");
  const card = await page.$eval(".hx-header", (c) => ({ bg: getComputedStyle(c).backgroundImage, fg: getComputedStyle(c.querySelector(".hx-code")).color }));
  assert.match(card.bg, /rgb\(255, 255, 255\)/, "light card surface"); assert.equal(card.fg, "rgb(11, 26, 61)");
  await shot(page, "theme-light-track-390");
  // the admin console follows the same choice
  await page.goto(`${base}/admin.html`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  // switching back is remembered too
  await page.goto(`${base}/index.html?map=flat`);
  await page.locator(".site-nav [data-theme-toggle]").click();
  await page.reload();
  assert.equal(await theme(), "dark");
  assert.ok(await noOverflow(page));
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const w of [390, 768, 1280]) {
  test(`tracking result at ${w}px: stage illustration from real data, stage-based progress, recorded route, copy and manual check`, async () => {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/track.html`);
    await page.fill("#trackingInput", codes.good); await page.keyboard.press("Enter");
    await page.waitForSelector(".hx-scene");
    const scene = await page.$eval(".hx-scene", (f) => ({ stage: f.dataset.stage, mode: f.dataset.mode, scene: f.dataset.scene, text: f.textContent.replace(/\s+/g, " "), h: f.querySelector(".hx-scene-stage").getBoundingClientRect().height }));
    assert.equal(scene.stage, "transit", "IN_TRANSIT -> transit stage");
    assert.equal(scene.mode, "none", "DHL runs several modes: no vehicle is guessed without a recorded service type");
    assert.equal(scene.scene, "neutral");
    assert.match(scene.text, /Illustration of the current shipment stage\.|3D illustration of a typical pallet of parcels/);
    assert.ok(scene.h > 100, "illustration has its reserved size");
    const head = await page.textContent(".hx-progress-head");
    assert.match(head, /Stage \d of \d/); assert.ok(!head.includes("%"), "no percentage");
    assert.equal(await page.locator(".hx-step.current[aria-current='step']").count(), 1);
    const route = await page.$$eval(".hx-rs", (li) => li.map((x) => ({ place: x.querySelector(".hx-rs-place").textContent, cls: x.className })));
    assert.equal(route[0].place, "Houston, United States"); assert.match(route[0].cls, /k-origin/);
    assert.equal(route.at(-1).place, "Lisbon, Portugal"); assert.match(route.at(-1).cls, /is-upcoming/, "destination upcoming while in transit");
    assert.match(await page.textContent(".hx-fact-updated"), /Latest recorded milestone/);
    const rootText = await page.textContent(".hx-tracker");
    assert.ok(!/Operations update|Recorded time|Last recorded update/.test(rootText), "no back-office labels or entry times for clients");
    assert.ok(!/Live tracking map/.test(rootText) && await page.locator(".hx-loc-badge").count() === 0, "a manually recorded location never reads as live");
    assert.ok(await page.locator(".hx-timeline time[datetime]").count() >= 1, "milestone times stay in the timeline");
    await page.click(".hx-copy");
    await page.waitForFunction(() => document.querySelector("[data-copy-label]")?.textContent === "Copied");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), codes.good);
    assert.match(await page.textContent('[data-act="refresh"]'), /Check now/);
    await page.click('[data-act="refresh"]');
    await page.waitForTimeout(600);
    assert.ok(await page.isVisible(".hx-header"), "result stays after a manual check");
    assert.ok(await noOverflow(page), `overflow at ${w}px`);
    await shot(page, `tracking-result-${w}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("tracking edge cases: invalid code, network failure with retry, missing optional data, single-flight manual check, timeline order", async () => {
  const ctx = await newContext({ width: 390, height: 844 });
  const page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/track.html`);
  // invalid code: clear message, no request result invented
  await page.fill("#trackingInput", "!!"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Please enter a valid tracking number/.test(document.getElementById("results").textContent));
  // network failure on lookup: an error message with a working retry
  await ctx.route(/\/api\/track\?/, (r) => r.abort());
  await page.fill("#trackingInput", codes.good); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /We couldn't load tracking right now/.test(document.getElementById("results").textContent));
  assert.equal(await page.locator('[data-act="retry"]').count(), 1);
  await ctx.unroute(/\/api\/track\?/);
  await page.click('[data-act="retry"]');
  await page.waitForSelector(".hx-header .hx-code");
  // timeline: oldest first by default, "Latest" marks the newest record, order can be flipped
  const order = () => page.$$eval(".hx-timeline > .hx-tl", (li) => li.map((x) => ({ latest: x.classList.contains("latest"), t: x.querySelector("time").dateTime })));
  let tl = await order();
  if (tl.length > 1) {
    assert.ok(Date.parse(tl[0].t) <= Date.parse(tl.at(-1).t), "oldest first");
    assert.ok(tl.at(-1).latest, "newest record marked Latest");
    await page.click('.hx-seg[data-order="latest"]');
    tl = await order();
    assert.ok(Date.parse(tl[0].t) >= Date.parse(tl.at(-1).t), "latest first after switching");
    assert.ok(tl[0].latest);
    assert.equal(await page.getAttribute('.hx-seg[data-order="latest"]', "aria-pressed"), "true");
  }
  // manual check: two quick taps send one request, and the outcome is reported
  let calls = 0; page.on("request", (r) => { if (r.url().includes("/api/track?")) calls++; });
  await page.evaluate(() => { const b = document.querySelector('[data-act="refresh"]'); b.click(); b.click(); });
  await page.waitForFunction(() => /Checked|New information/.test(document.querySelector(".hx-refresh-note")?.textContent || ""));
  assert.equal(calls, 1, "one request for overlapping taps");
  assert.match(await page.textContent(".hx-checked"), /Last checked/);
  // a failed check keeps the last loaded data and says so
  await ctx.route(/\/api\/track\?/, (r) => r.abort());
  await page.click('[data-act="refresh"]');
  await page.waitForFunction(() => /Couldn't check right now/.test(document.querySelector(".hx-refresh-note")?.textContent || ""));
  assert.ok(await page.isVisible(".hx-header .hx-code"), "last loaded shipment stays on screen");
  await ctx.unroute(/\/api\/track\?/);
  // missing optional data: neutral wording, nothing invented
  await page.fill("#trackingInput", codes.none); await page.keyboard.press("Enter");
  await page.waitForFunction((c) => document.querySelector(".hx-code")?.textContent === c, codes.none);
  const caption = await page.textContent(".hx-scene figcaption");
  assert.match(caption, /No location recorded yet/);
  const stops = await page.$$eval(".hx-rs-place", (x) => x.map((e) => e.textContent));
  assert.deepEqual(stops, ["Somewhere", "Elsewhere"], "only the recorded origin and destination");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("tracking result with reduced motion: every block visible at once, illustration static", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", isMobile: true, hasTouch: true });
  await ctx.route(/gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com|smartsupp|cdn\.jsdelivr\.net/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.good); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-route");
  const ops = await page.$$eval(".hx-tracker > *, .hx-route .hx-rs, .hx-scene", (els) => els.map((e) => getComputedStyle(e).opacity));
  assert.ok(ops.every((o) => o === "1"), `hidden blocks: ${ops}`);
  assert.equal(await page.$eval(".hx-scene-subject", (g) => getComputedStyle(g).animationName), "none");
  await ctx.close();
});

for (const theme of ["dark", "light"]) {
  test(`admin shipment list on a phone (${theme}): readable cards, copy, separated risky actions, no overflow`, async () => {
    const ctx = await newContext({ width: 390, height: 844 });
    if (theme === "light") await ctx.addInitScript(() => { try { localStorage.setItem("hx-theme", "light"); } catch {} });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/admin.html`);
    await page.fill("#loginPassword", process.env.ADMIN_PASSWORD); await page.click("#loginBtn");
    await page.waitForFunction(() => typeof window.switchView === "function" && !document.getElementById("appRoot").classList.contains("hidden"));
    assert.ok(await page.isVisible(".header [data-theme-toggle]"), "theme switch in the top bar");
    await page.waitForSelector("#kpiGrid .kpi.attention", { timeout: 10000 }); // dashboard figures load after sign-in
    await page.evaluate(() => window.switchView("shipments"));
    await page.waitForSelector(".shipments-table .td-code");
    const card = await page.$eval(".shipments-table tbody tr", (tr) => {
      const r = (sel) => tr.querySelector(sel)?.getBoundingClientRect();
      const buttons = [...tr.querySelectorAll(".row-actions .btn-action")].map((b) => b.getBoundingClientRect().height);
      return { code: r(".td-code strong"), risky: r(".row-actions-risky"), main: r(".row-actions .btn-action"), buttons };
    });
    assert.ok(card.code.top < card.main.top, "tracking number first");
    assert.ok(card.risky.top > card.main.top, "archive/delete set apart below the everyday actions");
    assert.ok(card.buttons.every((h) => h >= 44), `tap targets ${card.buttons}`);
    const fs16 = await page.$eval("#fCode", (i) => parseFloat(getComputedStyle(i).fontSize));
    assert.ok(fs16 >= 16, "no iOS zoom on focus");
    assert.ok(await noOverflow(page));
    await shot(page, `admin-list-${theme}-390`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("stage photo, recorded checkpoints over the ship and the explorable 3D model follow the real shipment", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.sea); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-scene .hx-scene-photo img");
  const fig = await page.$eval(".hx-scene", (f) => ({ photo: f.dataset.photo, model: f.dataset.scene, src: f.querySelector("img").currentSrc || f.querySelector("img").src }));
  assert.equal(fig.photo, "ship"); assert.equal(fig.model, "ship"); assert.match(fig.src, /assets\/stages\/ship-342\./);
  await page.waitForFunction(() => { const i = document.querySelector(".hx-scene-photo img"); return i.complete && i.naturalWidth > 0; });
  const labels = await page.$$eval(".hx-route-overlay text:not(.ro-more)", (t) => t.map((x) => x.textContent));
  assert.equal(labels[0], "Shanghai"); assert.equal(labels.at(-1), "Rotterdam");
  assert.ok(labels.includes("Suez Canal"), labels.join(","));
  assert.equal(await page.locator(".hx-route-overlay .is-current").count(), 1);
  assert.equal(await page.locator(".hx-route-overlay .is-upcoming text").textContent(), "Rotterdam", "destination still to come");
  // the 3D view starts by itself (no click): loading state, then the canvas over the reserved stage
  await page.waitForSelector(".hx-3d-canvas", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector(".hx-scene").classList.contains("is-3d") && !document.querySelector(".hx-3d-loading"));
  assert.match(await page.textContent('[data-slot="scenecap"]'), /3D illustration of a typical container vessel at sea for this stage — not the actual facility, vehicle or parcel\./);
  assert.deepEqual(await page.$$eval(".hx-3d-views .hx-seg", (b) => b.map((x) => x.textContent)), ["Overview", "Bridge", "Bow"]);
  assert.equal(await page.getAttribute('[data-act="3d"]', "aria-pressed"), "true");
  await page.waitForTimeout(400);
  const shot1 = await page.locator(".hx-3d-canvas").screenshot();
  const b = await page.locator(".hx-3d-canvas").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 150, b.y + b.height / 2, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const shot2 = await page.locator(".hx-3d-canvas").screenshot();
  assert.ok(!shot1.equals(shot2), "dragging rotates the model");
  await page.click('[data-act="3d-zoom-in"]'); await page.waitForTimeout(200);
  const shot3 = await page.locator(".hx-3d-canvas").screenshot();
  assert.ok(!shot3.equals(shot2), "zoom button zooms");
  await page.click('.hx-3d-views [data-view="bridge"]'); await page.waitForTimeout(900);
  const shot4 = await page.locator(".hx-3d-canvas").screenshot();
  assert.ok(!shot4.equals(shot3), "a camera view moves the camera");
  assert.equal(await page.getAttribute('.hx-3d-views [data-view="bridge"]', "aria-pressed"), "true");
  await page.click('[data-act="3d-reset"]'); await page.waitForTimeout(200);
  assert.equal(await page.getAttribute('.hx-3d-views [data-view="overview"]', "aria-pressed"), "true", "reset returns to the first view");
  // the wheel scrolls the page unless the canvas was clicked/focused first
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => { window.__wheelPrevented = null; addEventListener("wheel", (e) => { window.__wheelPrevented = e.defaultPrevented; }, { once: true }); });
  const y0 = await page.evaluate(() => scrollY); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => window.__wheelPrevented !== null);
  assert.equal(await page.evaluate(() => window.__wheelPrevented), false, "the 3D canvas does not cancel the wheel");
  await page.waitForFunction((y) => scrollY > y, y0, { timeout: 5000 }); // wheel scrolling is animated, so wait for it to land
  // back to the photo and to 3D again
  await page.click('[data-act="3d-close"]');
  assert.equal(await page.locator(".hx-3d-canvas").count(), 0, "the photo view frees the 3D canvas");
  assert.ok(await page.isVisible(".hx-scene-photo img"));
  assert.equal(await page.getAttribute('[data-act="3d-close"]', "aria-pressed"), "true");
  await page.click('[data-act="3d"]');
  await page.waitForSelector(".hx-3d-canvas", { timeout: 20000 });
  // a facility shipment gets the owner's aerial facility photo and the distribution-centre scene
  await page.fill("#trackingInput", codes.hub); await page.keyboard.press("Enter");
  await page.waitForFunction((c) => document.querySelector(".hx-code")?.textContent === c, codes.hub);
  assert.deepEqual(await page.$eval(".hx-scene", (f) => [f.dataset.photo, f.dataset.scene]), ["aerial", "facility"]);
  await page.waitForSelector(".hx-scene.is-3d .hx-3d-canvas", { timeout: 20000 });
  // an in-transit courier shipment with no recorded mode: the drawing as poster and the neutral scene, no vehicle
  await page.fill("#trackingInput", codes.good); await page.keyboard.press("Enter");
  await page.waitForFunction((c) => document.querySelector(".hx-code")?.textContent === c, codes.good);
  assert.equal(await page.locator(".hx-scene .hx-scene-svg").count(), 1);
  assert.equal(await page.$eval(".hx-scene", (f) => f.dataset.scene), "neutral");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("3D view falls back to the photo with a clear message when WebGL is unavailable", async () => {
  const ctx = await newContext({ width: 390, height: 844 });
  await ctx.addInitScript(() => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : orig.call(this, t, ...a); }; });
  const page = await ctx.newPage();
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.sea); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /3D view isn't available on this device/.test(document.querySelector(".hx-3d-note:not([hidden])")?.textContent || ""), null, { timeout: 15000 });
  assert.ok(await page.isVisible(".hx-scene-photo img"), "the photo is still there");
  assert.equal(await page.locator(".hx-3d-canvas").count(), 0);
  assert.equal(await page.isVisible(".hx-3d-tools"), false, "no 3D controls without 3D");
  assert.ok(await noOverflow(page));
  await ctx.close();
});

test("3D view: loading state while Three.js downloads, photo fallback when the CDN is blocked, canvas leaves vertical swipes to the page", async () => {
  // slow CDN: the loading overlay is shown over the photo
  let ctx = await newContext({ width: 390, height: 844 });
  let release; const gate = new Promise((r) => { release = r; });
  await ctx.route(/three@[^/]+\/build\//, async (r) => { await gate; r.abort(); });
  let page = await ctx.newPage();
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.sea); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-3d-loading", { timeout: 15000 });
  assert.match(await page.textContent(".hx-3d-loading"), /Loading 3D view/);
  assert.equal(await page.getAttribute(".hx-scene", "aria-busy"), "true");
  assert.ok(await page.isDisabled('[data-act="3d-reset"]'), "controls wait for the model");
  release();
  // blocked CDN: photo stays with the note, the rest of the page keeps working
  await page.waitForFunction(() => !document.querySelector(".hx-3d-loading") && !document.querySelector(".hx-3d-note").hidden, null, { timeout: 15000 });
  assert.ok(await page.isVisible(".hx-scene-photo img"));
  assert.ok(await page.isVisible(".hx-timeline"));
  await ctx.close();
  // touch: the canvas leaves vertical swipes to the page (touch-action: pan-y) and has 44px-class targets
  ctx = await newContext({ width: 390, height: 844 });
  page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.sea); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-3d-canvas", { timeout: 20000 });
  assert.equal(await page.$eval(".hx-3d-canvas", (c) => getComputedStyle(c).touchAction), "pan-y");
  const sizes = await page.$$eval(".hx-3d-btn, .hx-3d-mode .hx-seg", (b) => b.map((x) => { const r = x.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  assert.ok(sizes.every((n) => n >= 40), `touch targets ${sizes}`);
  assert.ok(await noOverflow(page));
  await shot(page, "tracking-3d-390");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("reduced motion: the 3D model still loads but stays still", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = false; });
  const cdn = process.env.HX_CDN_DIR;
  if (cdn) await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/build\/(.*)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.join(cdn, "three", "build", r.request().url().match(/build\/([^?]+)/)[1])) }));
  const page = await ctx.newPage();
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.sea); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-3d-canvas", { timeout: 20000 });
  await page.waitForTimeout(600);
  const a = await page.locator(".hx-3d-canvas").screenshot(); await page.waitForTimeout(700);
  const b = await page.locator(".hx-3d-canvas").screenshot();
  assert.ok(a.equals(b), "no idle animation with reduced motion");
  await ctx.close();
});

test("every recorded status gets its own 3D scene; on-hold and cancelled scenes stay still; unknown modes imply no vehicle", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/admin.html`);
  assert.equal((await api(page, { action: "login", password: process.env.ADMIN_PASSWORD })).status, 200);
  const cases = [["maersk", "IN_TRANSIT", null, "ship", "true"], ["emiratesskycargo", "IN_TRANSIT", null, "air", "true"], ["dhl", "IN_TRANSIT", "Road freight", "road", "true"],
    ["dhl", "IN_TRANSIT", null, "neutral", "true"], ["dhl", "CREATED", null, "processing", "true"], ["dhl", "PICKED_UP", null, "collection", "true"], ["dhl", "AT_FACILITY", null, "facility", "true"],
    ["dhl", "CUSTOMS", null, "customs", "true"], ["dhl", "OUT_FOR_DELIVERY", null, "delivery", "true"], ["dhl", "DELIVERED", null, "delivered", "true"],
    ["dhl", "DELAYED", null, "delayed", "false"], ["dhl", "EXCEPTION", null, "hold", "false"], ["dhl", "CANCELLED", null, "cancelled", "false"]];
  const made = [];
  for (const [courier, statusCode, serviceType, scene, animate] of cases) {
    const r = await api(page, { action: "create", shipment: { courier, statusCode, origin: "Lagos, Nigeria", destination: "Accra, Ghana", ...(serviceType ? { serviceType } : {}) } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); made.push([r.json.shipment.id, scene, animate, statusCode]);
  }
  for (const [code, scene, animate, statusCode] of made) {
    await page.goto(`${base}/track.html`);
    await page.fill("#trackingInput", code); await page.keyboard.press("Enter");
    await page.waitForSelector(".hx-scene.is-3d .hx-3d-canvas", { timeout: 30000 });
    const f = await page.$eval(".hx-scene", (x) => ({ scene: x.dataset.scene, animate: x.dataset.animate, cap: x.querySelector("[data-slot=scenecap]").textContent }));
    assert.equal(f.scene, scene, statusCode); assert.equal(f.animate, animate, statusCode);
    assert.match(f.cap, /3D illustration of a typical .+ — not the actual facility, vehicle or parcel\./, statusCode);
    if (animate === "false") assert.match(f.cap, /without movement/, statusCode);
    if (SHOTS) await page.locator(".hx-scene").screenshot({ path: path.join(SHOTS, `scene-${statusCode}-${scene}.png`) });
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("3D view on a slow device: declined after a short frame-time check, the photo stays with a clear note", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  // a device that can only draw ~4 frames a second: every animation frame arrives 220 ms late
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = true; window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 220); });
  const page = await ctx.newPage();
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.sea); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-3d-note:not([hidden])", { timeout: 40000 });
  assert.match(await page.textContent(".hx-3d-note"), /turned off to keep this page smooth/);
  assert.ok(await page.isVisible(".hx-scene-photo img")); assert.equal(await page.locator(".hx-3d-canvas").count(), 0);
  await ctx.close();
});

test("homepage network globe: worldwide connections rotate with no admin data, pause, reduced motion and fallback", async () => {
  const empty = (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ routes: [], activity: [], stats: { active: 0, inTransit: 0, delivered: 0, countriesActive: 0, activeCountries: [] }, version: "e", generatedAt: new Date().toISOString() }) });
  // no published shipments at all: the globe still shows connections, and they change over time
  let ctx = await newContext({ width: 1280, height: 900 });
  await ctx.addInitScript(() => { window.HX_NETWORK_INTERVAL_MS = 700; });
  await ctx.route(/\/api\/public\?view=overview/, empty);
  let page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/index.html?map=flat`);
  await page.locator("#freightNetwork").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.getElementById("freightNetwork").dataset.state === "ready", null, { timeout: 20000 });
  const first = await page.getAttribute("#freightNetwork", "data-routes");
  assert.equal(first.split(" ").length, 3, first);
  await page.waitForFunction((f) => document.getElementById("freightNetwork").dataset.routes !== f, first, { timeout: 10000 });
  const seen = new Set(first.split(" "));
  for (let i = 0; i < 12 && seen.size < 6; i++) { await page.waitForTimeout(800); (await page.getAttribute("#freightNetwork", "data-routes")).split(" ").forEach((k) => seen.add(k)); }
  assert.ok(seen.size >= 5, `several connections over time: ${[...seen]}`);
  const text = (await page.textContent("#freightNetwork")).replace(/\s+/g, " ");
  assert.match(text, /Worldwide freight connections/); assert.match(text, /Network visualisation of international freight corridors — not live shipments\./);
  assert.match(text, /Freight connection/); assert.match(text, /km apart/);
  assert.ok(!/In Transit|Delivered|\bGPS\b|tracking number|Illustrative network/i.test(text), "no shipment statuses, codes or the old disclaimer");
  assert.ok(!text.includes(codes.good) && !text.includes(codes.sea), "never shows tracking codes");
  assert.ok(await page.$eval("#freightNetwork canvas", (c) => c.width > 0 && c.height > 0));
  // pause stops the rotation
  await page.click("[data-ng-toggle]");
  assert.equal(await page.getAttribute("[data-ng-toggle]", "aria-pressed"), "true");
  const paused = await page.getAttribute("#freightNetwork", "data-routes"); await page.waitForTimeout(2200);
  assert.equal(await page.getAttribute("#freightNetwork", "data-routes"), paused, "paused routes stay put");
  assert.ok(await noOverflow(page)); assert.deepEqual(errors, []);
  await shot(page, "network-globe-1280");
  await ctx.close();
  // phone, light theme: two cards, no overflow
  ctx = await newContext({ width: 390, height: 844 });
  await ctx.addInitScript(() => { try { localStorage.setItem("hx-theme", "light"); } catch {} });
  page = await ctx.newPage();
  await page.goto(`${base}/index.html?map=flat`);
  await page.locator("#freightNetwork").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.getElementById("freightNetwork").dataset.state === "ready", null, { timeout: 20000 });
  assert.equal((await page.getAttribute("#freightNetwork", "data-routes")).split(" ").length, 2);
  assert.ok(await noOverflow(page));
  await shot(page, "network-globe-390-light");
  await ctx.close();
  // reduced motion: a still globe and a button for other routes
  ctx = await newContext({ width: 768, height: 900 });
  page = await ctx.newPage(); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/index.html?map=flat`);
  await page.locator("#freightNetwork").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.getElementById("freightNetwork").dataset.state === "static", null, { timeout: 20000 });
  assert.equal(await page.isVisible("[data-ng-toggle]"), false);
  const still = await page.getAttribute("#freightNetwork", "data-routes"); await page.waitForTimeout(1500);
  assert.equal(await page.getAttribute("#freightNetwork", "data-routes"), still, "nothing rotates by itself");
  await page.click("[data-ng-next]");
  assert.notEqual(await page.getAttribute("#freightNetwork", "data-routes"), still);
  await ctx.close();
  // no canvas: the cards alone
  ctx = await newContext({ width: 1280, height: 900 });
  await ctx.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  page = await ctx.newPage();
  await page.goto(`${base}/index.html?map=flat`);
  await page.waitForFunction(() => document.getElementById("freightNetwork").dataset.state === "fallback", null, { timeout: 20000 });
  assert.ok((await page.locator("#freightNetwork .ng-card").count()) >= 2);
  await ctx.close();
});

test("shipment map opens on the shipment (not the world), with labels, a themed base and an optional street map", async () => {
  for (const theme of ["dark", "light"]) {
    const ctx = await newContext({ width: 1280, height: 900 });
    await ctx.addInitScript((t) => { try { localStorage.setItem("hx-theme", t); } catch {} }, theme);
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/track.html?code=${codes.good}`);
    await page.waitForSelector(".hx-map[data-zoom] .leaflet-marker-icon", { timeout: 20000 });
    const m = await page.$eval(".hx-map", (e) => ({ zoom: Number(e.dataset.zoom), center: e.dataset.center.split(",").map(Number), cls: e.className,
      labels: [...e.querySelectorAll(".hx-map-label")].map((x) => x.textContent), bg: getComputedStyle(e).backgroundImage }));
    assert.ok(m.zoom > 2, `zoomed past the world view: ${m.zoom}`);
    assert.ok(m.center[0] > 25 && m.center[0] < 45 && m.center[1] > -100 && m.center[1] < 0, `centred on the Atlantic route: ${m.center}`);
    assert.match(m.cls, /hx-base-outline/);
    assert.ok(m.labels.some((l) => /^Origin · Houston/.test(l)) && m.labels.some((l) => /^Destination · Lisbon/.test(l)) && m.labels.some((l) => /^Latest/.test(l)), m.labels.join("|"));
    assert.match(await page.textContent(".hx-routesum"), /Houston.*Lisbon/s);
    assert.match(await page.textContent(".hx-map-note"), /Latest recorded location shown \(approximate, city level\)\. Lines connect recorded places; they aren't a tracked path\./);
    // the street map is optional; tiles are blocked here, so it falls back to the outline with a note
    await page.click(".hx-map-ctl button[aria-pressed]");
    await page.waitForFunction(() => /street map isn't available/.test(document.querySelector('[data-slot="mapnote"]').textContent), null, { timeout: 15000 });
    assert.match(await page.getAttribute(".hx-map", "class"), /hx-base-outline/);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test("recorded vs. live: only a verified GPS / carrier position is labelled live", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  await ctx.route(/\/api\/stream/, (r) => r.abort());
  await ctx.route(/\/api\/track\?/, async (r) => {
    const res = await r.fetch(); const body = await res.json().catch(() => null);
    if (body?.shipment?.currentLocation) {
      const now = new Date().toISOString();
      body.shipment.currentLocation = { ...body.shipment.currentLocation, source: "gps", sourceLabel: "GPS telemetry", updatedAt: now };
      body.shipment.locationState = { ...body.shipment.locationState, updatedAt: now };
      if (body.shipment.map?.current) body.shipment.map.current = { ...body.shipment.map.current, updatedAt: now, sourceLabel: "GPS telemetry" };
    }
    r.fulfill({ response: res, json: body });
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/track.html`);
  await page.fill("#trackingInput", codes.good); await page.keyboard.press("Enter");
  await page.waitForSelector(".hx-fact-loc");
  assert.match(await page.textContent(".hx-fact-loc"), /Current location/);
  assert.match(await page.textContent(".hx-fact-loc .hx-loc-badge"), /Live/);
  assert.match(await page.textContent(".hx-fact-loc"), /GPS/);
  assert.match(await page.textContent('[data-slot="maptitle"]'), /Live tracking map/);
  await ctx.close();
});

test("homepage tracking form: loading, invalid, unknown and network-error states, both themes, no overflow", async () => {
  for (const theme of ["dark", "light"]) for (const w of [390, 768, 1280]) {
    const ctx = await newContext({ width: w, height: w < 800 ? 844 : 900 });
    if (theme === "light") await ctx.addInitScript(() => { try { localStorage.setItem("hx-theme", "light"); } catch {} });
    let hold = null;
    await ctx.route(/\/api\/track\?/, async (r) => { if (hold) await hold; r.continue(); });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/index.html?map=flat`);
    assert.equal(await page.getAttribute("#trackingInput", "placeholder"), "Enter your tracking number");
    assert.ok(parseFloat(await page.$eval("#trackingInput", (i) => getComputedStyle(i).fontSize)) >= 16, "no iOS zoom on focus");
    const bh = await page.$eval(".btn-track", (b) => b.getBoundingClientRect().height); assert.ok(bh >= 44);
    // invalid
    await page.fill("#trackingInput", "!"); await page.click(".btn-track");
    await page.waitForFunction(() => document.getElementById("error").classList.contains("show"));
    assert.match(await page.textContent("#error"), /valid tracking number/);
    assert.equal(await page.getAttribute("#trackingInput", "aria-invalid"), "");
    // loading
    let go; hold = new Promise((r) => { go = r; });
    await page.fill("#trackingInput", "HY-000000"); await page.click(".btn-track");
    await page.waitForFunction(() => document.getElementById("btn-text").textContent === "Tracking…");
    assert.ok(await page.isDisabled(".btn-track")); assert.equal(await page.getAttribute(".btn-track", "aria-busy"), "");
    if (w === 390) await shot(page, `form-loading-${theme}-390`);
    go(); hold = null;
    // unknown
    await page.waitForFunction(() => /Tracking number not found/.test(document.getElementById("error").textContent));
    assert.equal(await page.textContent("#btn-text"), "Track shipment");
    assert.ok(await noOverflow(page), `overflow ${theme} ${w}`);
    await shot(page, `form-error-${theme}-${w}`);
    // network error, then retry recovers
    await ctx.route(/\/api\/track\?/, (r) => r.abort(), { times: 1 });
    await page.fill("#trackingInput", codes.good); await page.click(".btn-track");
    await page.waitForFunction(() => /couldn't load tracking/.test(document.getElementById("trackerRoot").textContent));
    assert.match(await page.textContent("#error"), /couldn't load tracking/);
    await page.click('[data-act="retry"]');
    await page.waitForFunction((c) => document.querySelector(".hx-code")?.textContent === c, codes.good, { timeout: 15000 });
    assert.equal(await page.textContent("#error"), "", "message cleared on success");
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test("light theme reaches every band: daylight hero, light freight copy, light tracking band and map", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  await ctx.addInitScript(() => { try { localStorage.setItem("hx-theme", "light"); } catch {} });
  const page = await ctx.newPage(); const errors = watchErrors(page);
  await page.goto(`${base}/index.html?map=flat`);
  const st = await page.evaluate(() => ({
    hero: getComputedStyle(document.querySelector(".hero3-media")).backgroundImage,
    h1: getComputedStyle(document.getElementById("heroTitle")).color,
    freight: getComputedStyle(document.getElementById("freightTitle")).color,
    card: getComputedStyle(document.querySelector(".track-card")).backgroundColor
  }));
  assert.match(st.hero, /scene-day\.svg/); assert.equal(st.h1, "rgb(11, 26, 61)"); assert.equal(st.freight, "rgb(11, 26, 61)");
  assert.match(st.card, /rgba?\(255, 255, 255/);
  await page.goto(`${base}/track.html`);
  assert.match(await page.$eval(".track-band", (b) => getComputedStyle(b, "::before").backgroundImage), /scene-day\.svg/);
  assert.equal(await page.$eval(".track-band h1", (h) => getComputedStyle(h).color), "rgb(11, 26, 61)");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("admin on iPhone: bottom tab bar, readable text, status breakdown, e-mail field, typed delete confirmation, change history", async () => {
  for (const theme of ["dark", "light"]) {
    const ctx = await newContext({ width: 390, height: 844 });
    if (theme === "light") await ctx.addInitScript(() => { try { localStorage.setItem("hx-theme", "light"); } catch {} });
    const page = await ctx.newPage(); const errors = watchErrors(page);
    await page.goto(`${base}/admin.html`);
    await page.fill("#loginPassword", process.env.ADMIN_PASSWORD); await page.click("#loginBtn");
    await page.waitForSelector("#kpiGrid .kpi", { timeout: 15000 });
    assert.ok(await page.isVisible("#tabBar"));
    assert.equal(await page.getAttribute('#tabBar [data-tab="dashboard"]', "aria-current"), "page");
    const tabs = await page.$$eval("#tabBar button", (b) => b.map((x) => x.getBoundingClientRect().height));
    assert.ok(tabs.every((h) => h >= 56), `tab heights ${tabs}`);
    await page.waitForSelector("#dashStatus .status-bar");
    const small = await page.evaluate(() => [...document.querySelectorAll("#view-dashboard *")].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => [e.tagName + "." + e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(([, f]) => f < 13));
    assert.deepEqual(small, [], "no text below 13px on the overview");
    // create with a notification address through the form, then find it in the list
    await page.click('#tabBar [data-tab="more"]'); await page.click("#btn-create");
    await page.selectOption("#courier", "dhl"); await page.fill("#origin", `Tema, Ghana ${theme}`); await page.fill("#destination", "Lome, Togo"); await page.fill("#notifyEmail", "Customer@Example.com");
    await page.click('#view-create button[type="submit"]');
    await page.waitForFunction(() => /[A-Z]+-\d{6}/.test(document.getElementById("wsCurrent")?.textContent || "") || document.querySelector(".toast"), null, { timeout: 15000 });
    const list = await api(page, { action: "list", q: "", limit: 50 });
    const made = list.json.items.find((i) => i.origin === `Tema, Ghana ${theme}` && i.destination === "Lome, Togo" && !i.archived);
    const full = await api(page, { action: "get", code: made.id });
    assert.equal(full.json.shipment.notifyEmail, "customer@example.com");
    // typed confirmation guards deletion; cancel keeps the record
    await page.click('#tabBar [data-tab="shipments"]');
    await page.fill("#fCode", made.id); await page.click("#fSearch");
    await page.waitForSelector(`[data-act="delete"][data-code="${made.id}"]`, { timeout: 15000 });
    await page.click(`[data-act="delete"][data-code="${made.id}"]`);
    await page.waitForSelector("#confirmModal.show");
    assert.ok(await page.isDisabled("#confirmOk"), "needs the code typed");
    await page.fill("#confirmType", "WRONG"); assert.ok(await page.isDisabled("#confirmOk"));
    await page.click("#confirmCancel");
    assert.equal((await api(page, { action: "get", code: made.id })).status, 200, "cancel keeps the shipment");
    // change history in the workspace
    await page.click('#tabBar [data-tab="tracking"]'); await page.fill("#wsCode", made.id); await page.click("#wsLoad");
    await page.waitForSelector("#trkSummary .trk-actions");
    await page.click('#tabBar [data-tab="more"]'); await page.click("#btn-events");
    await page.waitForFunction(() => /shipment\.created/.test(document.getElementById("evHistory").textContent), null, { timeout: 15000 });
    assert.ok(await noOverflow(page), `overflow ${theme}`);
    await shot(page, `admin-events-${theme}-390`);
    await api(page, { action: "delete", code: made.id, confirm: made.id });
    assert.deepEqual(errors, []);
    await ctx.close();
  }
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
