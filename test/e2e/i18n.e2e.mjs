// Browser tests (Playwright) for the interface languages, against the local dev server with the in-memory store.
//   CHROMIUM_PATH=... node --test --test-concurrency=1 test/e2e/i18n.e2e.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

process.env.STORE = "memory";
process.env.GEOCODER = "off";
process.env.ADMIN_PASSWORD = "e2e-password-123";
process.env.SESSION_SECRET = "e2e-secret-e2e-secret-1234";

const { createServer } = await import("../../dev-server.js");
const { __seedDemo } = await import("../seed.js");
const { LANGUAGES } = await import("../../ui/i18n.js");
const dict = async (code) => (await import(`../../ui/locales/${code}.js`)).default;
const EN = await dict("en");
const plainText = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

let server; let base; let browser; let code;

before(async () => {
  await __seedDemo();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin.html`);
  const api = (body) => page.evaluate(async (b) => { const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; }, body);
  assert.equal((await api({ action: "login", password: process.env.ADMIN_PASSWORD })).status, 200);
  const r = await api({ action: "create", shipment: { courier: "dhl", statusCode: "IN_TRANSIT", origin: "Houston, United States", destination: "Lisbon, Portugal",
    originLat: 29.76, originLng: -95.37, destinationLat: 38.72, destinationLng: -9.14, location: "Atlantic Ocean", latitude: 35.1, longitude: -45.2 } });
  assert.equal(r.status, 200); code = r.json.shipment.id;
  assert.equal((await api({ action: "addEvent", code, statusCode: "IN_TRANSIT", location: "Azores, Portugal", description: "Departed hub", applyToShipment: true })).status, 200);
  await ctx.close();
});
after(async () => { await browser?.close(); server?.close(); });

async function newContext({ width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  await ctx.addInitScript(() => { window.HX_3D_PERF_CHECK = false; });
  // third-party widgets, fonts, map tiles and CDN libraries are not under test
  await ctx.route(/(fonts\.|tawk\.to|smartsupp|gstatic\.com|tile\.|arcgisonline|cdn\.jsdelivr\.net)/, (r) => r.abort());
  return ctx;
}
const watch = (page) => { const errs = []; page.on("pageerror", (e) => errs.push(e.message)); return errs; };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("i18n: English by default, whatever the browser language; a selector in the header shows it", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR", extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9" } });
  await ctx.route(/(fonts\.|tawk\.to|gstatic\.com|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(`${base}/index.html`);
  await page.waitForSelector("#hxLang");
  assert.equal(await page.getAttribute("html", "lang"), "en");
  assert.equal(await page.inputValue("#hxLang"), "en");
  assert.equal(await page.textContent(".lang-pick [data-lang-current]"), "EN");
  assert.equal(await page.textContent("#heroTitle"), "Every shipment. Every milestone. One clear view.");
  const options = await page.$$eval("#hxLang option", (os) => os.map((o) => [o.value, o.textContent]));
  assert.deepEqual(options.map((o) => o[0]), LANGUAGES.map((l) => l.code));
  for (const [, name] of options) assert.ok(name.length > 2, "language names are written out");
  assert.equal(await page.getAttribute("#hxLang", "aria-label"), "Language");
  assert.equal(await page.evaluate(() => localStorage.getItem("hx-lang")), null, "nothing saved until the visitor chooses");
  assert.deepEqual(errs, []);
  await ctx.close();
});

test("i18n: every language can be chosen; the page changes in place and nothing overflows on a phone", async () => {
  const ctx = await newContext({ width: 360, height: 780 });
  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(`${base}/index.html`);
  await page.waitForSelector("#hxLang");
  await page.fill("#trackingInput", "half-typed");
  for (const l of LANGUAGES) {
    const D = await dict(l.code);
    await page.selectOption("#hxLang", l.code);
    await page.waitForFunction((c) => document.documentElement.lang === c, l.code);
    assert.equal(await page.getAttribute("html", "dir"), l.dir, `${l.code}: direction`);
    assert.equal(await page.textContent("#heroTitle"), plainText(D["home.hero.title"]), `${l.code}: hero`);
    assert.equal(await page.textContent('.nav-menu a[href="/track.html"]'), D["nav.tracking"], `${l.code}: menu`);
    assert.equal(await page.getAttribute("#trackingInput", "placeholder"), D["track.placeholder"], `${l.code}: placeholder`);
    assert.equal(await page.title(), D["meta.title.home"], `${l.code}: title`);
    assert.equal(await page.inputValue("#trackingInput"), "half-typed", `${l.code}: typed text kept`);
    assert.equal(await page.evaluate(() => localStorage.getItem("hx-lang")), l.code, `${l.code}: saved`);
    assert.ok(await noOverflow(page), `${l.code}: no sideways scrolling at 360px`);
    if (l.code !== "en") assert.notEqual(D["home.hero.lead"], EN["home.hero.lead"], `${l.code}: translated`);
  }
  assert.deepEqual(errs, []);
  await ctx.close();
});

test("i18n: the choice follows the visitor across pages and later visits; the mobile menu has the selector too", async () => {
  const ctx = await newContext({ width: 390, height: 844 });
  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(`${base}/index.html`);
  await page.click(".nav-toggle");
  await page.waitForSelector("#hxLangMenu", { state: "visible" });
  await page.selectOption("#hxLangMenu", "fr");
  await page.waitForFunction(() => document.documentElement.lang === "fr");
  assert.equal(await page.inputValue("#hxLang"), "fr", "header and menu selectors stay in sync");
  assert.equal(await page.getAttribute(".nav-toggle", "aria-expanded"), "true", "the menu stays open after choosing");
  const FR = await dict("fr");
  for (const [path, sel, key] of [["/track.html", "#trackTitle", "track.title"], ["/carriers.html", "#carriersTitle", "carriers.title"], ["/tracking-enhanced.html", "#trackTitle", "trackpage.enh.title"], ["/", "#heroTitle", "home.hero.title"]]) {
    await page.goto(base + path);
    await page.waitForFunction(() => document.documentElement.lang === "fr" && !document.documentElement.hasAttribute("data-i18n-pending"));
    assert.equal(plainText(await page.textContent(sel)), plainText(FR[key]), `${path}`);
  }
  // a later visit (new tab, same device) starts in French
  const p2 = await ctx.newPage(); await p2.goto(`${base}/carriers.html`);
  await p2.waitForFunction(() => document.documentElement.lang === "fr");
  await p2.waitForSelector(".cr-tile");
  assert.equal(await p2.textContent('#carrierTabs [data-filter="all"]'), `${FR["carriers.all"]}23`);
  // back to English
  await p2.selectOption("#hxLang", "en");
  await p2.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(await p2.textContent("#carriersTitle"), "Global carrier network");
  assert.deepEqual(errs, []);
  await ctx.close();
});

test("i18n: tracking works in any language; statuses are translated for display only; switching keeps the result", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  await ctx.addInitScript(() => localStorage.setItem("hx-lang", "pt-BR"));
  const page = await ctx.newPage(); const errs = watch(page);
  let lookups = 0; page.on("request", (r) => { if (r.url().includes("/api/track?")) lookups++; });
  await page.goto(`${base}/track.html`);
  await page.waitForFunction(() => document.documentElement.lang === "pt-BR");
  await page.fill("#trackingInput", code.toLowerCase());
  await page.click(".btn-search");
  await page.waitForSelector(".hx-header .hx-pill");
  const BR = await dict("pt-BR"); const DE = await dict("de");
  assert.equal(await page.textContent(".hx-code"), code, "the tracking code is shown exactly as stored");
  assert.equal((await page.textContent(".hx-header .hx-pill")).trim(), BR["status.IN_TRANSIT"]);
  assert.match(await page.textContent(".hx-tl-card"), new RegExp(BR["tr.tl.title"]));
  assert.ok((await page.textContent(".hx-tl-card")).includes("Departed hub"), "text typed by operations is shown as recorded");
  assert.ok((await page.textContent(".hx-details")).includes("Lisbon, Portugal"), "places are shown as recorded");
  // the API is unchanged: codes and English labels, whatever the page language
  const apiView = await page.evaluate(async (c) => (await (await fetch(`/api/track?code=${c}`)).json()).shipment, code);
  assert.equal(apiView.status.code, "IN_TRANSIT"); assert.equal(apiView.status.label, "In Transit");
  const before = lookups;
  await page.selectOption("#hxLang", "de");
  await page.waitForFunction((s) => document.querySelector(".hx-header .hx-pill")?.textContent.trim() === s, DE["status.IN_TRANSIT"]);
  assert.equal(await page.textContent(".hx-code"), code, "same result after switching");
  assert.equal(await page.inputValue("#trackingInput"), code.toLowerCase().toUpperCase(), "input kept");
  assert.equal(lookups, before, "switching language makes no new lookup");
  assert.match(await page.textContent(".hx-support-card"), new RegExp(DE["support.title"]));
  assert.ok(await page.locator("#hx-support .hx-support-email").isVisible(), "customer support is still there");
  // unknown codes: translated message, same validation rules
  await page.fill("#trackingInput", "NO-SUCH-CODE-1"); await page.click(".btn-search");
  await page.waitForSelector(".hx-empty h3");
  assert.equal(await page.textContent(".hx-empty h3"), DE["tr.msg.notfound.title"]);
  await page.fill("#trackingInput", "x"); await page.click(".btn-search");
  await page.waitForFunction((s) => document.querySelector(".hx-empty h3")?.textContent === s, DE["tr.msg.invalid.title"]);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test("i18n: Arabic reads right to left; codes stay left to right; switching back restores the layout", async () => {
  for (const width of [360, 1280]) {
    const ctx = await newContext({ width, height: 900 });
    await ctx.addInitScript(() => localStorage.setItem("hx-lang", "ar"));
    const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(`${base}/track.html`);
    await page.waitForFunction(() => document.documentElement.lang === "ar" && !document.documentElement.hasAttribute("data-i18n-pending"));
    assert.equal(await page.getAttribute("html", "dir"), "rtl");
    await page.fill("#trackingInput", code); await page.click(".btn-search");
    await page.waitForSelector(".hx-header .hx-pill");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".hx-code")).direction), "ltr", "tracking code left to right");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".hx-details")).direction), "rtl");
    assert.ok(await noOverflow(page), `no sideways scrolling at ${width}px in Arabic`);
    await page.selectOption("#hxLang", "en");
    await page.waitForFunction(() => document.documentElement.dir === "ltr");
    assert.equal((await page.textContent(".hx-header .hx-pill")).trim(), "In Transit");
    assert.ok(await noOverflow(page));
    assert.deepEqual(errs, []);
    await ctx.close();
  }
});

test("i18n: the admin console stays English even when a visitor language is saved", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  await ctx.addInitScript(() => localStorage.setItem("hx-lang", "fr"));
  const page = await ctx.newPage();
  await page.goto(`${base}/admin.html`);
  await page.waitForLoadState("domcontentloaded");
  assert.notEqual(await page.getAttribute("html", "lang"), "fr");
  assert.equal(await page.locator("[data-lang-select]").count(), 0, "no language selector in the admin");
  assert.equal(await page.evaluate(async () => (await import("/ui/i18n.js")).t("status.IN_TRANSIT")), "In Transit", "shared components render English in the admin");
  await ctx.close();
});

test("i18n: a missing translation falls back to English without breaking the page", async () => {
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(`${base}/index.html`);
  await page.waitForSelector("#hxLang");
  const r = await page.evaluate(async () => {
    const m = await import("/ui/i18n.js");
    await m.setLang("es");
    const d = (await import("/ui/locales/es.js")).default; const saved = d["home.how.title"]; delete d["home.how.title"];
    m.applyI18n(document);
    const shown = document.getElementById("howTitle").textContent; d["home.how.title"] = saved;
    return { shown, unknown: m.t("does.not.exist") };
  });
  assert.equal(r.shown, "From booking to doorstep in three steps");
  assert.equal(r.unknown, "does.not.exist");
  assert.deepEqual(errs, []);
  await ctx.close();
});
