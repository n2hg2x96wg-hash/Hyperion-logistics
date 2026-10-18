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
  const card = await page.$eval(".hx-header", (c) => ({ bg: getComputedStyle(c).backgroundColor, fg: getComputedStyle(c.querySelector(".hx-code")).color }));
  assert.equal(card.bg, "rgb(255, 255, 255)"); assert.equal(card.fg, "rgb(11, 26, 61)");
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
    const scene = await page.$eval(".hx-scene", (f) => ({ stage: f.dataset.stage, mode: f.dataset.mode, text: f.textContent.replace(/\s+/g, " "), h: f.querySelector(".hx-scene-stage").getBoundingClientRect().height }));
    assert.equal(scene.stage, "transit", "IN_TRANSIT -> transit stage");
    assert.equal(scene.mode, "van", "DHL is an express carrier in the catalogue");
    assert.match(scene.text, /Illustration of the current stage, not a live position\./);
    assert.ok(scene.h > 100, "illustration has its reserved size");
    const head = await page.textContent(".hx-progress-head");
    assert.match(head, /Stage \d of \d/); assert.ok(!head.includes("%"), "no percentage");
    assert.equal(await page.locator(".hx-step.current[aria-current='step']").count(), 1);
    const route = await page.$$eval(".hx-rs", (li) => li.map((x) => ({ place: x.querySelector(".hx-rs-place").textContent, cls: x.className })));
    assert.equal(route[0].place, "Houston, United States"); assert.match(route[0].cls, /k-origin/);
    assert.equal(route.at(-1).place, "Lisbon, Portugal"); assert.match(route.at(-1).cls, /is-upcoming/, "destination upcoming while in transit");
    assert.match(await page.textContent(".hx-fact-updated"), /Last recorded update/);
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
