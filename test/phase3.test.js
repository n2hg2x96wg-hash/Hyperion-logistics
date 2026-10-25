// Operational repairs: coordinate validation, text-first countries, the admin location check (read-only),
// and public/admin separation of the public pages.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

process.env.STORE = "memory";
process.env.GEOCODER = "off";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-secret-test-secret-1234";

const { createServer } = await import("../dev-server.js");
// Interface text now lives in ui/locales/en.js (English is the source and the default). `plain()` removes the translation
// markers from page markup so structural checks still read the English HTML; `EN` holds the English text by key.
const EN = (await import("../ui/locales/en.js")).default;
const plain = (html) => html.replace(/ data-i18n(?:-html|-attr)?="[^"]*"/g, "")
  .replace(/<span>(Track a shipment|Explore freight services|Every milestone time-stamped|Updates appear without refreshing|Real support from our team|Origin|Destination|Recorded position|Travelled|Planned route|Carrier names are trademarks of their owners\.)<\/span>/g, "$1");
const { __setStoreForTests } = await import("../api/_lib/store/index.js");
const { createMemoryStore } = await import("../api/_lib/store/memory.js");
const { validPoint, deriveCountry, coordinateIssue } = await import("../api/_lib/geo.js");

const SHIPMENTS = {
  "OK-100001": { status: "In Transit", origin: "Lagos, Nigeria", destination: "London, United Kingdom", originLat: 6.5244, originLng: 3.3792, destinationLat: 51.5072, destinationLng: -0.1276, latitude: 48.85, longitude: 2.35, location: "Paris, France", createdAt: "2026-10-01T00:00:00.000Z" },
  // lat/lng typed the wrong way round for Lagos
  "SWAP-100002": { status: "In Transit", origin: "Lagos, Nigeria", destination: "Accra, Ghana", originLat: 3.3792, originLng: 6.5244, destinationLat: 5.6037, destinationLng: -0.187, createdAt: "2026-10-01T00:00:00.000Z" },
  // empty form fields that ended up as 0,0
  "ZERO-100003": { status: "In Transit", origin: "Houston, United States", destination: "Lisbon, Portugal", latitude: 0, longitude: 0, location: "Atlantic", createdAt: "2026-10-01T00:00:00.000Z" },
  // a point in Niger for a place typed as Nigeria
  "NIGER-100004": { status: "In Transit", origin: "Kano, Nigeria", destination: "Abuja, Nigeria", originLat: 13.51, originLng: 2.11, createdAt: "2026-10-01T00:00:00.000Z" },
  "NONE-100005": { status: "In Transit", origin: "Somewhere", destination: "Elsewhere", createdAt: "2026-10-01T00:00:00.000Z" },
  "NAN-100006": { status: "In Transit", origin: "Tokyo, Japan", destination: "Osaka, Japan", latitude: Number.NaN, longitude: Number.NaN, createdAt: "2026-10-01T00:00:00.000Z" }
};

let server; let base; let cookie = ""; let store; let before0;
before(async () => {
  store = createMemoryStore({ shipments: structuredClone(SHIPMENTS) });
  __setStoreForTests(store);
  before0 = structuredClone(await Promise.all(Object.keys(SHIPMENTS).map((c) => store.getShipment(c))));
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
const track = async (code) => (await (await fetch(`${base}/api/track?code=${code}`)).json()).shipment;

test("validPoint rejects empty, non-numeric, out-of-range and 0,0 values", () => {
  assert.deepEqual(validPoint(6.5, 3.3), { lat: 6.5, lng: 3.3 });
  for (const [a, b] of [[0, 0], [null, 3], ["", ""], ["6.5", "3.3"], [NaN, 1], [91, 0], [10, 181], [undefined, undefined]]) assert.equal(validPoint(a, b), null, `${a},${b}`);
  assert.deepEqual(validPoint(0, 10), { lat: 0, lng: 10 }); // the equator is fine
});

test("country comes from the typed place first; coordinates only as a fallback", () => {
  assert.equal(deriveCountry(13.51, 2.11, "Kano, Nigeria"), "NG"); // point is in Niger, text wins
  assert.equal(deriveCountry(13.51, 2.11, "Warehouse 4"), "NE");   // no country in text: coordinates
  assert.equal(deriveCountry(0, 0, "Warehouse 4"), null);           // 0,0 is never used
});

test("coordinateIssue classifies swapped, zero, invalid and mismatched points", () => {
  assert.equal(coordinateIssue(6.5244, 3.3792, "Lagos, Nigeria"), null);
  assert.equal(coordinateIssue(3.3792, 6.5244, "Lagos, Nigeria").issue, "swapped");
  assert.equal(coordinateIssue(0, 0, "Houston, United States").issue, "zero");
  assert.equal(coordinateIssue(NaN, NaN, "Tokyo").issue, "invalid");
  assert.equal(coordinateIssue(13.51, 2.11, "Kano, Nigeria").issue, "mismatch");
  assert.equal(coordinateIssue(undefined, undefined, "Kano, Nigeria"), null);
});

test("client map never draws 0,0 or invalid points; valid ones are kept", async () => {
  const ok = await track("OK-100001");
  assert.deepEqual(ok.map.origin, { lat: 6.5244, lng: 3.3792 });
  assert.equal(ok.map.current.lat, 48.85);
  const zero = await track("ZERO-100003");
  assert.equal(zero.map.current, null);
  const nan = await track("NAN-100006");
  assert.equal(nan.map.current, null);
});

test("location check: admin-only, lists problems, changes nothing", async () => {
  assert.equal((await admin({ action: "locationHealth" }, { auth: false })).status, 401);
  const r = await admin({ action: "locationHealth" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const by = Object.fromEntries(r.json.issues.map((i) => [`${i.code}:${i.field}`, i]));
  assert.equal(by["SWAP-100002:origin"].issue, "swapped");
  assert.equal(by["SWAP-100002:origin"].canSwap, true);
  assert.equal(by["ZERO-100003:current"].issue, "zero");
  assert.equal(by["NIGER-100004:origin"].issue, "mismatch");
  assert.equal(by["NIGER-100004:origin"].foundCountry, "NE");
  assert.equal(by["NAN-100006:current"].issue, "invalid");
  assert.ok(!r.json.issues.some((i) => i.code === "OK-100001"));
  assert.ok(r.json.missingCoordinates >= 2); // NONE + NAN (+ ZERO)
  const after0 = await Promise.all(Object.keys(SHIPMENTS).map((c) => store.getShipment(c)));
  assert.deepEqual(after0, before0, "the check must not modify any record");
  assert.equal((await admin({ action: "audit" })).json.entries?.filter?.((e) => e.action !== "admin.login").length || 0, 0);
});

test("a swap fix goes through the normal audited update and clears the issue", async () => {
  const r = await admin({ action: "update", code: "SWAP-100002", changes: { originLat: 6.5244, originLng: 3.3792 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const h = await admin({ action: "locationHealth" });
  assert.ok(!h.json.issues.some((i) => i.code === "SWAP-100002"));
  const audit = await admin({ action: "audit", code: "SWAP-100002" });
  assert.ok(JSON.stringify(audit.json).includes("SWAP-100002"));
});

test("public pages: one shared header, no Admin or Investments links", () => {
  const pages = ["index.html", "track.html", "tracking-enhanced.html"];
  const headers = pages.map((p) => {
    const html = fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    assert.ok(!/href="[^"]*(admin|investment)\.html/i.test(html), `${p} links to admin/investments`);
    const m = html.match(/<!-- site-header -->([\s\S]*?)<!-- \/site-header -->/);
    assert.ok(m, `${p} uses the shared header`);
    return m[1].replace(/\s+/g, " ").trim();
  });
  assert.equal(headers[1], headers[0]);
  assert.equal(headers[2], headers[0]);
});

test("public statistics count countries from the typed place, not a mistyped coordinate", async () => {
  const { __clearPublicCache } = await import("../api/public.js");
  // a record whose stored country was derived from a wrong point before the fix
  await store.mutateShipment("NIGER-100004", (s) => ({ next: { ...s, originCountry: "NE" } }));
  __clearPublicCache();
  const o = await (await fetch(`${base}/api/public?view=overview`)).json();
  const isos = o.stats.activeCountries.map((c) => c.iso);
  assert.ok(!isos.includes("NE"), JSON.stringify(o.stats.activeCountries));
  assert.ok(isos.includes("NG"));
});

test("homepage: freight showcase follows the optional shared-shipments section, with real actions and no fabricated proof", () => {
  const html = plain(fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  const pos = (id) => html.indexOf(`id="${id}"`);
  assert.ok(pos("activity") > 0 && pos("activity") < pos("freight") && pos("freight") < pos("journey"), "section order");
  const section = html.slice(pos("freight"), pos("journey"));
  assert.ok(!/★|rating|review|testimonial|\d+(\.\d+)?\s*\/\s*5|customers|on[- ]time|guarantee/i.test(section), "no ratings, reviews or invented claims");
  assert.match(section, /href="#services"[^>]*>Explore freight services/);
  assert.match(section, /href="#trackForm" data-focus-track>Track a shipment/);
  for (const id of section.match(/href="#(svc-[a-z]+)"/g).map((m) => m.slice(7, -1))) assert.ok(html.includes(`id="${id}"`), `${id} target exists`);
  assert.ok(fs.existsSync(new URL("../assets/hero/freight-ship.svg", import.meta.url)));
  // image: reserved size, alt text, fallback to an existing file, every referenced file exists
  const img = section.match(/<img [^>]+>/)[0];
  assert.match(img, /width="\d+" height="\d+"/); assert.match(img, /alt="[^"]{20,}"/); assert.match(img, /loading="lazy"/);
  assert.match(img, /onerror="[^"]*assets\/hero\/freight-ship\.svg/);
  const refs = [...section.matchAll(/(?:src|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0]));
  for (const f of refs) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `missing ${f}`);
  // four compact service cards, each linking to an existing service
  const cards = section.match(/class="freight-card"/g) || [];
  assert.equal(cards.length, 4);
});

test("homepage: public statistics block hidden (presentation only); map, feed and table kept; API still computes stats", async () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const gone of ['id="ccStats"', "data-stat=", "data-countries", "How these numbers are counted", "statsEl"]) assert.ok(!html.includes(gone), `${gone} still on the homepage`);
  for (const kept of ['id="ccMap"', 'id="ccFeed"', 'id="ccTable"', 'id="ccCard"']) assert.ok(html.includes(kept), `${kept} missing`);
  const { __clearPublicCache } = await import("../api/public.js");
  __clearPublicCache();
  const o = await (await fetch(`${base}/api/public?view=overview`)).json();
  for (const k of ["active", "inTransit", "delivered", "countriesActive"]) assert.equal(typeof o.stats[k], "number", `stats.${k} still computed`);
});

test("search information: canonical, social tags, honest structured data, robots and sitemap", async () => {
  const SITE = "https://hyperion-logistics.vercel.app";
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const index = read("index.html"); const track = read("track.html"); const enhanced = read("tracking-enhanced.html");
  assert.match(index, new RegExp(`<link rel="canonical" href="${SITE}/">`));
  assert.match(track, new RegExp(`<link rel="canonical" href="${SITE}/track.html">`));
  assert.match(enhanced, new RegExp(`<link rel="canonical" href="${SITE}/track.html">`), "duplicate tracking page points to /track.html");
  for (const html of [index, track, enhanced]) {
    assert.match(html, /<meta name="description" content="[^"]{60,}">/);
    for (const t of ["og:title", "og:description", "og:url", "og:image"]) assert.ok(html.includes(`property="${t}"`), t);
    assert.ok(html.includes('rel="icon"'));
  }
  // structured data parses and only states verifiable facts
  const blocks = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const graph = blocks.flatMap((b) => b["@graph"] || [b]);
  const org = graph.find((n) => n["@type"] === "Organization");
  assert.ok(org && graph.some((n) => n["@type"] === "WebSite"));
  assert.equal(org.contactPoint[0].email, "hyperionlogistics.com@gmail.com");
  assert.ok(index.includes("mailto:hyperionlogistics.com@gmail.com"), "the same email is shown on the page");
  const raw = JSON.stringify(blocks);
  for (const banned of ["aggregateRating", "review", "telephone", "address", "sameAs", "award", "foundingDate"]) assert.ok(!raw.includes(banned), `no unverified ${banned}`);
  for (const f of ["assets/brand/og-image.png", "assets/brand/logo-512.png", "assets/brand/favicon.svg"]) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
  // robots + sitemap are served
  const robots = await fetch(`${base}/robots.txt`); assert.equal(robots.status, 200);
  const rtxt = await robots.text();
  for (const d of ["Disallow: /api/", "Disallow: /admin.html", `Sitemap: ${SITE}/sitemap.xml`]) assert.ok(rtxt.includes(d), d);
  const sm = await fetch(`${base}/sitemap.xml`); assert.equal(sm.status, 200);
  const locs = [...(await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${SITE}/`, `${SITE}/track.html`]);
  // private pages are not indexed; public ones are
  for (const f of ["admin.html", "login.html", "dashboard.html", "client-dashboard.html"]) assert.match(read(f), /<meta name="robots" content="noindex, nofollow">/, f);
  for (const html of [index, track]) assert.ok(!/name="robots" content="noindex/.test(html));
});

test("carriers: integration and partnership are separate, evidence-backed states; ids and catalogue unchanged", async () => {
  const { CARRIERS, carrierPartnership, carrierIntegration } = await import("../shared/carriers.js");
  for (const c of CARRIERS) {
    assert.equal(carrierPartnership(c), "none", `${c.id} must not claim a partnership`);
    assert.notEqual(carrierIntegration(c).status, "live", `${c.id} must not claim a live API`);
  }
  assert.equal(carrierIntegration({ id: "dhl", lastProviderUpdateAt: "2026-10-01T00:00:00Z" }).status, "manual", "a past update alone is not 'live'");
  assert.equal(carrierIntegration({ id: "dhl" }, { configuredProviders: ["dhl"] }).status, "manual", "a configured adapter that never reported is not 'live'");
  assert.equal(carrierIntegration({ id: "dhl", lastProviderUpdateAt: "2026-10-01T00:00:00Z" }, { configuredProviders: ["dhl"] }).status, "live");

  const { __clearPublicCache } = await import("../api/public.js");
  const pub = async () => { __clearPublicCache(); return (await (await fetch(`${base}/api/public?view=carriers`)).json()).carriers; };
  let list = await pub();
  assert.ok(list.length >= CARRIERS.length - 1 && list.every((c) => c.partner === false));
  assert.deepEqual(list.map((c) => c.id).sort(), CARRIERS.map((c) => c.id).sort(), "catalogue ids unchanged");

  // marking a partnership requires internal evidence; public output never includes it
  const base0 = { name: "DHL", prefix: "DHL" };
  let r = await admin({ action: "saveCourier", mode: "update", id: "dhl", courier: { ...base0, verifiedPartner: true } });
  assert.equal(r.status, 400); assert.equal(r.json.field, "partnerEvidence");
  r = await admin({ action: "saveCourier", mode: "update", id: "dhl", courier: { ...base0, verifiedPartner: "yes" } });
  assert.equal(r.status, 400);
  r = await admin({ action: "saveCourier", mode: "update", id: "dhl", courier: { ...base0, verifiedPartner: true, partnerEvidence: "Contract HX-TEST-1, 2026-10-01, confirmed by ops" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  list = await pub();
  const dhl = list.find((c) => c.id === "dhl");
  assert.equal(dhl.partner, true);
  const raw = JSON.stringify(list);
  for (const k of ["partnerEvidence", "HX-TEST-1", "apiEndpoint", "email"]) assert.ok(!raw.includes(k), `public carriers leak ${k}`);
  const audit = await admin({ action: "audit" });
  assert.ok(JSON.stringify(audit.json).includes('"verifiedPartner":true'), "partnership change is audited");
  // an edit that does not send the field keeps it; unticking removes the badge
  r = await admin({ action: "saveCourier", mode: "update", id: "dhl", courier: { ...base0, description: "Express parcels." } });
  assert.equal((await pub()).find((c) => c.id === "dhl").partner, true);
  r = await admin({ action: "saveCourier", mode: "update", id: "dhl", courier: { ...base0, verifiedPartner: false, partnerEvidence: "" } });
  assert.equal(r.status, 200);
  assert.equal((await pub()).find((c) => c.id === "dhl").partner, false);
  assert.equal((await admin({ action: "saveCourier", mode: "update", id: "dhl", courier: { ...base0, verifiedPartner: true, partnerEvidence: "x" } }, { auth: false })).status, 401);
});

test("homepage: logistics journey section follows the freight showcase, with an honest illustrative image", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const pos = (id) => html.indexOf(`id="${id}"`);
  assert.ok(pos("freight") < pos("journey") && pos("journey") < pos("services"), "order: freight → journey → services");
  assert.ok(!html.includes('id="ccStats"') && !html.includes("data-stat="), "statistics block stays hidden");
  const section = html.slice(pos("journey"), pos("services"));
  const img = section.match(/<img [^>]+>/)[0];
  assert.match(img, /width="1179" height="638"/); assert.match(img, /loading="lazy"/); assert.match(img, /alt="Illustration:[^"]+"/); assert.match(img, /onerror="/);
  assert.ok(!/<figcaption/.test(section), "no label over the photo");
  assert.match(section, /href="#trackForm" data-focus-track/);
  assert.ok(!/★|rating|review|testimonial|customers|guarantee|\d+\s*%/i.test(section), "no ratings, reviews or invented figures");
  const refs = [...section.matchAll(/(?:src|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0]));
  assert.ok(refs.length >= 10);
  for (const f of refs) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `missing ${f}`);
});

test("public carrier directory shows no internal update methods; admin list keeps them; API unchanged", async () => {
  const ui = fs.readFileSync(new URL("../ui/carriers.js", import.meta.url), "utf8");
  for (const t of ["Manual updates", "Live API", "Official tracking link", "How updates reach"]) assert.ok(!ui.includes(t), `ui/carriers.js still renders "${t}"`);
  assert.ok(!fs.readFileSync(new URL("../index.html", import.meta.url), "utf8").includes('"Live API"'));
  const admin = fs.readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(admin, /<th>Updates<\/th>/); assert.match(admin, /Manual \(operations\)/);
  const { __clearPublicCache } = await import("../api/public.js"); __clearPublicCache();
  const list = (await (await fetch(`${base}/api/public?view=carriers`)).json()).carriers;
  assert.ok(list.length > 0 && list.every((c) => c.integration && typeof c.partner === "boolean"), "public API response shape unchanged");
});

test("homepage flow: hero → optional shared shipments → freight → journey → services → carriers → support, each section once", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const order = ["track", "results-section", "activity", "freight", "journey", "services", "about", "carriers", "how", "support"];
  const at = order.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(at.every((p) => p > 0), "every section present");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "sections in order");
  for (const id of order) assert.equal(html.split(`id="${id}"`).length, 2, `${id} appears once`);
  // every in-page link still has a target
  for (const [, id] of html.matchAll(/href="\/?#([a-zA-Z][\w-]*)"/g)) assert.ok(html.includes(`id="${id}"`), `#${id} has no target`);
});

test("homepage hero: headline and tracking form unchanged; drawn scene present and decorative layers hidden from assistive tech", () => {
  const html = plain(fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  assert.match(html, /<h1 id="heroTitle">Every shipment\. Every milestone\. <span>One clear view\.<\/span><\/h1>/);
  for (const kept of ['id="trackingInput"', 'onclick="track()"', 'href="#trackForm" data-focus-track>Track a shipment', 'href="#services">Explore our services', 'id="error"'])
    assert.ok(html.includes(kept), `${kept} missing`);
  assert.match(html, /class="hero3-media" role="img" aria-label="Photo:[^"]+"/);
  assert.match(html, /<svg class="hero3-routes"[^>]*aria-hidden="true"/);
  const css = fs.readFileSync(new URL("../ui/site-v2.css", import.meta.url), "utf8");
  // a real photograph (licence recorded in assets/hero/CREDITS.md), local files only, in AVIF, WebP and JPEG per size
  for (const f of ["port-1280", "port-1920", "port-2560", "port-mobile-1080"]) {
    assert.ok(css.includes(`assets/hero/${f}.avif`) && css.includes(`assets/hero/${f}.jpg`), `${f} used`);
    for (const ext of ["avif", "webp", "jpg"]) {
      const size = fs.statSync(new URL(`../assets/hero/${f}.${ext}`, import.meta.url)).size;
      assert.ok(size < 420 * 1024, `${f}.${ext} is compressed (${size} bytes)`);
    }
  }
  assert.ok(!/assets\/hero\/scene(-mobile)?\.svg/.test(css), "the drawn scene is no longer the hero");
  assert.ok(!/url\("?https?:/.test(css), "no remote images");
  assert.match(read("assets/hero/CREDITS.md"), /port-\*[\s\S]*CC0/);
  // the entrance animation only runs when motion is allowed; the hero has a solid fallback colour
  const hero = css.slice(css.indexOf("/* ---------- hero ---------- */"), css.indexOf("/* ---------- tracking pages"));
  assert.match(hero, /\.hero3 \{[^}]*background: #030712/);
  const anim = hero.slice(hero.indexOf("/* hero entrance"));
  assert.match(anim, /^[^{]*\{\s*@media \(prefers-reduced-motion: no-preference\)|@media \(prefers-reduced-motion: no-preference\) \{/);
  // the only looping motion is one thin dotted route line drifting slowly; everything else plays once
  const loops = [...anim.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^}]*animation:[^;]*infinite/g)].map((m) => m[1].trim());
  assert.deepEqual(loops, [".hero3-routes .r3"], `looping hero animations: ${loops}`);
  assert.match(css, /@media \(max-width: 1023px\) \{ \.hero3-routes \{ display: none; \} \}/, "route lines (and their drift) only on wide screens");
  assert.ok(!/(^|\n)\.hero3[^{]*\{[^}]*animation:/.test(hero.slice(0, hero.indexOf("/* hero entrance"))), "animations only inside the motion media query");
});

test("homepage shared shipments: hidden unless public data loaded with at least one route; errors are not treated as empty", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<section class="section" id="activity" aria-labelledby="activityTitle" hidden data-state="loading">/);
  assert.match(html, /document\.documentElement\.dataset\.activity = state;[\s\S]*setActivity\("loading"\);/, "links to the section follow it");
  assert.match(fs.readFileSync(new URL("../ui/site-v2.css", import.meta.url), "utf8"), /html\[data-activity\]:not\(\[data-activity="ready"\]\) [^{]*a\[href="\/#activity"\]\) \{ display: none; \}/);
  const script = html.slice(html.indexOf("const activity = document.getElementById(\"activity\")"));
  assert.match(script, /onData: \(d\) => \{ setActivity\(Array\.isArray\(d\?\.routes\) && d\.routes\.length \? "ready" : "empty"\);/);
  assert.match(script, /if \(activity\.dataset\.state !== "ready"\) setActivity\("error"\)/, "a failed load is recorded as an error");
  assert.match(script, /throw err;/, "the command center still sees the failure (status text, retry back-off)");
  assert.match(script, /const show = state === "ready";/);
  // the public API rules are unchanged: routes only for opted-in shipments, masked codes
  const view = fs.readFileSync(new URL("../api/_lib/public-view.js", import.meta.url), "utf8");
  assert.match(view, /maskCode/);
});

test("journey: three explanatory milestones joined by a connector; reduced motion and no-JS keep everything visible", () => {
  const html = plain(fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  const section = html.slice(html.indexOf('id="journey"'), html.indexOf('id="services"'));
  const steps = [...section.matchAll(/<li data-reveal>(?:<picture class="js-thumb">[\s\S]*?<\/picture>)?<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ["Warehouse processing", "Transit and handling", "Final delivery"]);
  assert.match(section, /<ol class="journey-steps" data-reveal="line"/);
  assert.ok(!/(in transit|delivered|out for delivery|on hold|HY-\d)/i.test(section.replace(/Final delivery|delivery is recorded|final delivery/gi, "")), "no live statuses or shipment numbers");
  const css = fs.readFileSync(new URL("../ui/site-v2.css", import.meta.url), "utf8");
  // hiding rules only exist under html.hx-motion (set by ui/motion.js when motion is allowed)
  for (const m of css.matchAll(/[^}]*journey-steps[^{]*:not\(\.is-visible\)[^{]*\{[^}]*\}/g)) assert.match(m[0], /html\.hx-motion/);
  assert.match(css, /\.journey-steps::after \{ transform: none !important; transition: none !important; \}/, "connector fully drawn under reduced motion");
  const motion = fs.readFileSync(new URL("../ui/motion.css", import.meta.url), "utf8");
  assert.match(motion, /prefers-reduced-motion: reduce[\s\S]*\[data-reveal\] \{ opacity: 1 !important; transform: none !important;/);
});

// ---------- theme toggle, tracking presentation, admin UI ----------
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("theme: saved choice applied in <head> before any stylesheet on every page; dark is the default; toggle in the shared header", () => {
  for (const f of ["index.html", "track.html", "tracking-enhanced.html", "admin.html"]) {
    const html = read(f);
    const head = html.indexOf('localStorage.getItem("hx-theme")==="light"');
    assert.ok(head > 0, `${f}: early theme script`);
    assert.ok(head < html.indexOf('rel="stylesheet"'), `${f}: theme applied before the first stylesheet (no flash)`);
    assert.match(html, /data-theme-toggle aria-pressed="false" aria-label="Switch to light theme"/, `${f}: toggle button`);
    assert.ok(html.includes('href="ui/theme-light.css"'), `${f}: light styles`);
  }
  for (const f of ["index.html", "track.html", "tracking-enhanced.html"]) {
    const header = read(f).match(/<!-- site-header -->([\s\S]*?)<!-- \/site-header -->/)[1];
    assert.match(header, /class="theme-toggle"/, `${f}: toggle sits in the shared header`);
  }
  const js = read("ui/theme.js");
  assert.ok(!/prefers-color-scheme/.test(js), "no system detection: dark until the visitor chooses");
  assert.match(js, /try \{ localStorage\.setItem\(KEY, theme\); \} catch/, "storage failures never break the page");
  assert.match(read("ui/site-shell.js"), /import "\.\/theme\.js";/);
  assert.match(read("admin.html"), /<script type="module" src="ui\/theme\.js"><\/script>/);
  // the tracking code itself is still never stored: the new tracker module stays storage-free
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(read("tracker/scene.js")), "tracker/scene.js"); // tracker.js: test/api.test.js
});

test("theme: text colours meet WCAG AA contrast in both themes", () => {
  const css = read("ui/tokens.css");
  const block = (sel) => Object.fromEntries([...css.slice(css.indexOf(sel)).split("}")[0].matchAll(/--(hy-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const dark = block(":root {"); const light = { ...dark, ...block('html[data-theme="light"] {') };
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [name, t] of [["dark", dark], ["light", light]]) {
    for (const bg of ["hy-bg-0", "hy-bg-1", "hy-bg-2"]) {
      assert.ok(ratio(t["hy-text"], t[bg]) >= 7, `${name}: body text on ${bg}`);
      assert.ok(ratio(t["hy-text-2"], t[bg]) >= 4.5, `${name}: secondary text on ${bg}`);
      assert.ok(ratio(t["hy-muted"], t[bg]) >= 4.5, `${name}: muted text on ${bg} (${ratio(t["hy-muted"], t[bg]).toFixed(2)})`);
    }
  }
  assert.ok(ratio("#ffffff", light["hy-blue"]) >= 4.5, "white text on the light-theme primary button");
});

test("tracking presentation: the stage comes from the recorded status, the vehicle only from carrier/service data", async () => {
  const { presentation, shipmentMode, sceneSvg } = await import("../tracker/scene.js");
  const { STATUS } = await import("../shared/status.js");
  const expected = { CREATED: "registered", PROCESSING: "processing", PICKED_UP: "transit", IN_TRANSIT: "transit", AT_FACILITY: "facility", CUSTOMS: "facility",
    OUT_FOR_DELIVERY: "out-for-delivery", DELIVERED: "delivered", DELAYED: "held", EXCEPTION: "held", CANCELLED: "cancelled" };
  for (const code of Object.values(STATUS)) assert.equal(presentation({ status: { code } }).stage, expected[code], code);
  assert.equal(presentation({ status: { code: "SOMETHING_NEW" } }).stage, "neutral", "unknown status -> neutral");
  assert.equal(presentation({}).stage, "neutral");
  assert.equal(shipmentMode({ carrier: { name: "Maersk" } }), "ship");
  assert.equal(shipmentMode({ carrier: { name: "Emirates SkyCargo" } }), "plane");
  for (const name of ["DHL", "FedEx", "UPS", "2GoExpress"]) assert.equal(shipmentMode({ carrier: { name } }), null, `${name}: multi-mode carrier, no guessed vehicle`);
  assert.equal(shipmentMode({ carrier: { name: "DHL", serviceType: "Air freight" } }), "plane");
  assert.equal(shipmentMode({ carrier: { name: "DHL", serviceType: "Road freight" } }), "truck");
  assert.equal(shipmentMode({ carrier: { name: "DHL", serviceType: "Express" } }), null, "express says nothing about the mode");
  assert.equal(shipmentMode({ carrier: { name: "DHL", serviceType: "Ocean freight (FCL)" } }), "ship", "recorded service type wins");
  assert.equal(shipmentMode({ carrier: { name: "Some Local Mover", custom: true } }), null, "custom carrier: no guessed vehicle");
  assert.equal(shipmentMode({ carrier: { name: "Unknown Co" } }), null);
  assert.equal(shipmentMode({}), null);
  assert.equal(presentation({ status: { code: "IN_TRANSIT" }, carrier: { name: "Maersk" } }).label, "In transit · sea freight");
  assert.equal(presentation({ status: { code: "IN_TRANSIT" } }).label, "In transit", "no mode claimed without data");
  const svg = sceneSvg({ stage: "transit", mode: "ship" });
  assert.match(svg, /aria-hidden="true"/); assert.ok(!/<text/.test(svg), "the picture carries no text (no invented place names)");
  const tracker = read("tracker/tracker.js");
  assert.equal(EN["tr.scene.cap"], "Illustration of the current shipment stage."); assert.match(tracker, /t\(!photo \? "tr\.scene\.cap" : photo\.key === "ship" \? "tr\.scene\.capShip" : "tr\.scene\.capPhoto"\)/);
  assert.match(EN["tr.scene.capPhoto"], /^Representative photo .*not the actual vessel, vehicle or facility\.$/); assert.match(EN["tr.scene.capShip"], /not the actual vessel\.$/);
  assert.ok(!/% of the journey|%<\/|pct\}%/.test(tracker), "no invented percentage in the progress display");
  assert.equal(EN["tr.stageOf"], "Stage {i} of {n}"); assert.match(tracker, /tHtml\("tr\.stageOf", \{ i: `<strong>\$\{cur \+ 1\}<\/strong>` \}, \{ n \}\)/);
});

test("recorded route: oldest first, consecutive repeats merged, nothing invented, destination upcoming until delivered", async () => {
  const { routeStops } = await import("../tracker/scene.js");
  const ev = (location, timestamp, title = "In Transit") => ({ location, timestamp, title });
  const view = { origin: "Shanghai, China", destination: "Rotterdam, Netherlands", status: { code: "IN_TRANSIT" },
    timeline: [ev("Suez Canal, Egypt", "2026-10-05T00:00:00Z"), ev("", "2026-10-04T00:00:00Z", "Note without a place"), ev("Singapore", "2026-10-03T00:00:00Z"),
      ev("Singapore", "2026-10-02T12:00:00Z"), ev("Shanghai, China", "2026-10-01T00:00:00Z", "Picked Up")] };
  const stops = routeStops(view);
  assert.deepEqual(stops.map((s) => s.place), ["Shanghai, China", "Singapore", "Suez Canal, Egypt", "Rotterdam, Netherlands"]);
  assert.deepEqual(stops.map((s) => s.state), ["done", "done", "current", "upcoming"]);
  assert.equal(stops.at(-1).title, "Destination");
  const delivered = routeStops({ ...view, status: { code: "DELIVERED" }, timeline: [...view.timeline, ev("Rotterdam, Netherlands", "2026-10-09T00:00:00Z", "Delivered")] });
  assert.deepEqual(delivered.map((s) => s.state), ["done", "done", "done", "current"]);
  assert.equal(delivered.at(-1).title, "Delivered");
  const bare = routeStops({ origin: "A", destination: "B", status: { code: "CREATED" }, timeline: [] });
  assert.deepEqual(bare.map((s) => [s.place, s.state]), [["A", "current"], ["B", "upcoming"]], "only two points when nothing is recorded");
  assert.deepEqual(routeStops({ timeline: [] }), [], "no origin/destination: no route at all");
});

test("homepage pictures: owner's step pictures on the journey, freight photo without printed shipment details, docs updated", () => {
  const html = read("index.html");
  for (const n of ["warehouse", "transit", "delivery"]) for (const ext of ["avif", "webp", "jpg"]) for (const sz of [96, 192])
    assert.ok(fs.existsSync(new URL(`../assets/journey/step-${n}-${sz}.${ext}`, import.meta.url)), `step-${n}-${sz}.${ext}`);
  assert.equal((html.match(/<picture class="js-thumb">/g) || []).length, 3);
  for (const m of html.matchAll(/<picture class="js-thumb">[\s\S]*?<img ([^>]+)>/g)) { assert.match(m[1], /alt=""/); assert.match(m[1], /width="96" height="96"/); assert.match(m[1], /loading="lazy"/); }
  assert.match(html, /assets\/freight\/ship-1179\.jpg/); assert.ok(!html.includes("ship-1536"));
  assert.match(read("assets/freight/README.md"), /blurred out/);
  assert.match(read("assets/freight/CREDITS.md"), /step-\{warehouse,transit,delivery\}/);
});

test("hero: shipment indicators run once along the drawn route lines and are hidden with reduced motion", () => {
  const html = read("index.html");
  const pkts = html.slice(html.indexOf('<g class="hero3-pkts">'), html.indexOf("</g>", html.indexOf('<g class="hero3-pkts">')));
  assert.equal((pkts.match(/<animateMotion /g) || []).length, 2);
  assert.ok(!/repeatCount|indefinite/.test(pkts), "no looping");
  assert.match(pkts, /fill="freeze"/);
  assert.match(read("ui/site-v2.css"), /@media \(prefers-reduced-motion: reduce\) \{ \.hero3-pkts \{ display: none; \} \}/);
});

test("admin: tracking numbers copyable, archive/delete set apart, a real-data 'needs attention' figure, theme switch", () => {
  const center = read("admin/center.js");
  assert.match(center, /data-act="copy" data-code="\$\{esc\(s\.id\)\}"/);
  assert.match(center, /<span class="row-actions-risky">/);
  assert.match(center, /copy: \(\) => copyCode\(code\)/);
  assert.match(center, /const attention = \(t\.delayed \|\| 0\) \+ \(t\.exceptions \|\| 0\);/, "derived only from the existing totals");
  // destructive actions still need confirmation (in-page dialog; deleting needs the code typed)
  assert.match(center, /confirmDialog\(\{ title: `Permanently delete \$\{code\}\?`[^)]*typed: code \}\)/); assert.match(center, /confirmDialog\(\{ title: `Archive \$\{code\}\?`/);
  assert.ok(!/confirm\(`(Archive|Permanently delete)/.test(center), "no browser confirm for archive/delete");
  const admin = read("admin.html");
  for (const id of ["loginForm", "loginPassword", "loginBtn", "appRoot", "loginOverlay"]) assert.ok(admin.includes(`id="${id}"`), id);
  assert.match(admin, /toast\.setAttribute\("role", type === "error" \? "alert" : "status"\)/);
  const css = read("admin/console.css");
  assert.match(css, /\.row-actions \.btn-action \{ flex: 1 1 auto; min-height: 44px; \}/);
  assert.match(css, /html\[data-theme="light"\] body\.console/);
});

test("tracker: manual check never overlaps, reports its real outcome, and the timeline reads oldest first by default", () => {
  const t = read("tracker/tracker.js");
  assert.match(t, /if \(!refreshing\) refreshing = \(async \(\) => \{/, "one manual check at a time");
  assert.match(t, /b\.disabled = true; b\.setAttribute\("aria-busy", "true"\);/);
  for (const k of ["updated", "unchanged", "error"]) assert.ok(EN[`tr.refresh.${k}`], `feedback for ${k}`);
  assert.match(t, /refreshNote = \["updated", "unchanged", "error"\]\.includes\(r\) \? r : ""/);
  assert.match(t, /role="status" aria-live="polite"/);
  assert.equal(EN["tr.lastChecked"], "Last checked {time}", "check time labelled separately from the last recorded event"); assert.match(t, /t\("tr\.lastChecked"/);
  assert.match(t, /let timelineOrder = "oldest";/);
  assert.match(t, /const latestId = items\[0\]\?\.id;/, "'Latest' still marks the newest recorded event in either order");
});

test("tracker: no back-office timestamps or labels for clients; only verified feeds read as live", () => {
  const t = read("tracker/tracker.js");
  assert.doesNotMatch(t, /sourceLabel\)/, "back-office source labels (e.g. \"Operations update\") are never rendered");
  assert.doesNotMatch(t, /fmtDateTime\(v\.lastUpdated\)|data-ago="\$\{esc\(v\.lastUpdated/, "the record-edit time is not shown as an event time");
  assert.doesNotMatch(t, /recordedAt/, "the exception entry time is not shown");
  assert.doesNotMatch(t, /\["Recorded", /, "the map fallback has no entry-time row");
  assert.match(t, /const LIVE_SOURCES = new Set\(\["gps", "carrier_api"\]\);/);
  assert.match(t, /if \(!verifiedFeed\(v\)\) \{ const s = ls\.state === "none" \? "none" : "last";/, "manual locations never read as live or recent");
  assert.match(t, /const latest = v\.timeline\?\.\[0\] \|\| null;/, "the latest milestone is the newest recorded event");
  assert.match(t, /🕒 \$\{esc\(t\("tr\.latestMilestone"\)\)\}/); assert.equal(EN["tr.latestMilestone"], "Latest recorded milestone");
  assert.match(t, /<time datetime="\$\{esc\(ev\.timestamp\)\}">/, "event times stay in the timeline");
  assert.match(read("tracker/map.js"), /cur\?\.updatedAt \? t\("map\.reportedAt", \{ when: fmt\(cur\.updatedAt\) \}\) : null/);
  const cc = read("ui/globe/command-center.js");
  assert.match(cc, /o\.mode === "admin" \? ` · \$\{esc\(a\.sourceLabel\)\}` : VERIFIED_LABELS\.has\(a\.sourceLabel\)/, "homepage feed hides back-office labels");
});

test("tracker: 3D starts by itself when the scene is in view, with a loading state, timeout and photo fallback", () => {
  const t = read("tracker/tracker.js");
  assert.match(t, /v3io = new IntersectionObserver\(/, "lazy: starts when the scene scrolls into view");
  assert.match(t, /scene3dMod = scene3dMod \|\| await import\("\.\/scene3d\.js"\);/, "the 3D module is loaded lazily");
  assert.equal(EN["tr.3d.loading"], "Loading 3D view…"); assert.match(t, /t\("tr\.3d\.loading"\)/);
  assert.match(t, /const V3_TIMEOUT = 15000;/);
  assert.equal(EN["tr.3d.unavailable"], "Showing photo — 3D view isn't available on this device.");
  assert.equal(EN["tr.3d.slow"], "Showing photo — 3D view turned off to keep this page smooth on this device.", "slow devices get the photo");
  assert.match(t, /t\(kind === "slow" \? "tr\.3d\.slow" : "tr\.3d\.unavailable"\)/);
  for (const a of ["3d", "3d-close", "3d-reset", "3d-zoom-in", "3d-zoom-out", "3d-view"]) assert.ok(t.includes(`data-act="${a}"`) || t.includes(`act === "${a}"`), a);
  assert.doesNotMatch(t, /Explore in 3D/);
  const core = read("tracker/3d/core.js");
  assert.match(core, /if \(document\.activeElement !== canvas\) return;/, "wheel never hijacks page scrolling");
  assert.match(core, /if \(e\.pointerType !== "touch"\) goal\.pitch/, "touch drags only rotate sideways");
  assert.match(read("tracker/tracker.css"), /touch-action: pan-y;/);
  // lazily imported modules are not loaded by other unit tests, so check that they parse
  const lazy = ["tracker/scene3d.js", "tracker/tracker.js", "tracker/map.js", "ui/network-globe.js", "ui/network-routes.js", ...fs.readdirSync(new URL("../tracker/3d", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `tracker/3d/${f}`),
    ...fs.readdirSync(new URL("../tracker/3d/scenes", import.meta.url)).map((f) => `tracker/3d/scenes/${f}`)];
  for (const f of lazy) assert.equal(spawnSync(process.execPath, ["--check", new URL(`../${f}`, import.meta.url).pathname]).status, 0, f);
});

test("homepage tracking form: ids kept, neutral placeholder, loading and error states", () => {
  const h = read("index.html");
  for (const id of ['id="trackForm"', 'id="trackingInput"', 'id="trackHint"', 'id="error"', 'id="btn-text"', 'onclick="track()"', "btn-track"]) assert.ok(h.includes(id), id);
  assert.match(h, /placeholder="Enter your tracking number"/);
  assert.doesNotMatch(h, /HY-\d{3,}/, "no example code that could look like a real shipment");
  assert.match(h, /label\.textContent = busy \? t\("track\.btn\.busy"\) : found \? t\("track\.btn\.found"\) : t\("track\.btn\.idle"\)/);
  assert.deepEqual([EN["track.btn.busy"], EN["track.btn.found"], EN["track.btn.idle"]], ["Tracking…", "Shipment found", "Track shipment"]);
  assert.match(h, /found = s\.phase === "ready" && !s\.update;/);
  for (const k of ["invalid", "notfound", "error"]) { assert.match(h, new RegExp(`${k}: t\\("track\\.err\\.${k}"\\)`), k); assert.ok(EN[`track.err.${k}`], k); }
  assert.match(read("ui/site-v2.css"), /\.track-field:focus-within \{/);
});

test("stage photos and 3D scenes: every status maps safely, files exist, captions are honest, Three.js only on demand", async () => {
  const { stagePhoto, stageScene, routeOverlaySvg, modelCaption } = await import("../tracker/scene.js");
  const { SCENES } = await import("../tracker/scene3d.js");
  const { STATUS } = await import("../shared/status.js");
  const sea = { carrier: { name: "Maersk" } }; const courier = { carrier: { name: "DHL" } };
  const expectPhoto = { CREATED: "dock", PROCESSING: "dock", AT_FACILITY: "aerial", CUSTOMS: "campus", OUT_FOR_DELIVERY: "dusk", PICKED_UP: "dusk", IN_TRANSIT: "dock", DELIVERED: "delivered", DELAYED: "dock", EXCEPTION: "aerial", CANCELLED: "dock" };
  for (const code of Object.values(STATUS)) {
    assert.equal(stagePhoto({ status: { code }, ...courier })?.key ?? null, expectPhoto[code], code);
    const p = stagePhoto({ status: { code }, ...courier });
    if (p) for (const w of p.widths) for (const ext of ["avif", "webp", "jpg"]) assert.ok(fs.existsSync(new URL(`../assets/stages/${p.file}-${w}.${ext}`, import.meta.url)), `${p.file}-${w}.${ext}`);
  }
  assert.equal(stagePhoto({ status: { code: "IN_TRANSIT" }, ...sea }).key, "ship");
  assert.equal(stagePhoto({ status: { code: "IN_TRANSIT" }, carrier: { name: "Emirates SkyCargo" } }).key, "air");
  assert.equal(stagePhoto({ status: { code: "IN_TRANSIT" }, carrier: { name: "DHL", serviceType: "Road freight" } }).key, "road");
  assert.equal(stagePhoto({ status: { code: "PICKED_UP" }, ...sea }).key, "dusk", "collection shows the van, whatever the mode");
  assert.equal(stagePhoto({ status: { code: "SOMETHING_NEW" } }), null, "unknown status keeps the neutral drawing");
  // every status x mode gives a known scene; movement only for normal stages
  const expectScene = { CREATED: "processing", PROCESSING: "processing", PICKED_UP: "collection", AT_FACILITY: "facility", CUSTOMS: "customs", OUT_FOR_DELIVERY: "delivery", DELIVERED: "delivered", DELAYED: "delayed", EXCEPTION: "hold", CANCELLED: "cancelled" };
  for (const code of Object.values(STATUS)) for (const carrier of [{ name: "Maersk" }, { name: "Emirates SkyCargo" }, { name: "DHL", serviceType: "Road freight" }, { name: "DHL" }, null]) {
    const r = stageScene({ status: { code }, carrier });
    assert.ok(SCENES.includes(r.scene), `${code}/${carrier?.name}: ${r.scene}`);
    if (expectScene[code]) assert.equal(r.scene, expectScene[code], code);
    if (["DELAYED", "EXCEPTION", "CANCELLED"].includes(code)) assert.equal(r.animate, false, `${code} is shown without movement`);
  }
  assert.equal(stageScene({ status: { code: "IN_TRANSIT" }, ...sea }).scene, "ship");
  assert.equal(stageScene({ status: { code: "IN_TRANSIT" }, carrier: { name: "Emirates SkyCargo" } }).scene, "air");
  assert.equal(stageScene({ status: { code: "IN_TRANSIT" }, carrier: { name: "DHL", serviceType: "Road freight" } }).scene, "road");
  assert.equal(stageScene({ status: { code: "IN_TRANSIT" }, ...courier }).scene, "neutral", "no recorded mode: no vehicle implied");
  assert.deepEqual(stageScene({ status: { code: "EXCEPTION" }, progress: { stage: "AT_FACILITY" } }), { scene: "hold", animate: false, state: "held" }, "on hold: its own still scene, never a moving stage");
  assert.deepEqual(stageScene({ status: { code: "DELAYED" }, progress: { stage: "IN_TRANSIT" } }), { scene: "delayed", animate: false, state: "held" });
  assert.deepEqual(stageScene({ status: { code: "CANCELLED" } }), { scene: "cancelled", animate: false, state: "cancelled" });
  for (const f of ["delayed", "hold", "cancelled"]) assert.match(read(`tracker/3d/scenes/${f}.js`), /mood: "(overcast|dim)"/, `${f} has its own still mood`);
  assert.deepEqual(stageScene({ status: { code: "SOMETHING_NEW" } }), { scene: "neutral", animate: false, state: "unknown" });
  for (const sc of SCENES) assert.match(modelCaption(sc), /^3D illustration of a typical .+ for this stage — not the actual facility, vehicle or parcel\.$/, sc);
  assert.match(modelCaption("ship", "held"), /without movement while the shipment is on hold/);
  // overlay: labels only from recorded places, schematic (no coordinates), at most 4 + "N earlier"
  const svg = routeOverlaySvg({ status: { code: "IN_TRANSIT" }, origin: "Shanghai, China", destination: "Rotterdam, Netherlands",
    timeline: ["A", "B", "C", "D"].map((p, i) => ({ location: `Port ${p}`, timestamp: `2026-10-0${i + 1}T00:00:00Z`, title: "In Transit" })) });
  const texts = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(texts.slice(0, 4), ["Shanghai", "Port C", "Port D", "Rotterdam"]); assert.match(texts[4], /\+2 earlier checkpoints/);
  assert.equal(routeOverlaySvg({ status: { code: "CREATED" }, timeline: [] }), "", "no route without recorded places");
  const s3d = read("tracker/scene3d.js");
  assert.match(s3d, /const THREE_URL = "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/build\/three\.module\.min\.js";/);
  assert.ok(!/^import /m.test(s3d), "no static imports: Three.js loads only when the scene is shown");
  assert.match(s3d, /if \(!core\.webglAvailable\(\)\) throw/);
  const core = read("tracker/3d/core.js"); assert.match(core, /renderer\.dispose\(\)/); assert.match(core, /err\.code = "slow"/);
  for (const f of fs.readdirSync(new URL("../tracker/3d/scenes", import.meta.url))) {
    const src = read(`tracker/3d/scenes/${f}`);
    assert.ok(!/^import /m.test(src), `${f}: THREE comes in as a parameter`);
    assert.ok(!/localStorage|sessionStorage|document\.cookie|fetch\(/.test(src), `${f}: no storage or network`);
    assert.ok(!/<text|fillText|TextGeometry/.test(src), `${f}: no lettering (no names, numbers or brands)`);
    assert.ok(SCENES.includes(f.replace(".js", "")), f);
  }
  assert.match(read("tracker/tracker.js"), /scene3dMod = scene3dMod \|\| await import\("\.\/scene3d\.js"\)/);
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(s3d));
  const credits = read("assets/stages/CREDITS.md");
  for (const f of ["stage-warehouse", "stage-facility", "stage-customs", "stage-sea", "stage-air", "stage-road", "stage-delivery", "stage-delivered"]) assert.match(credits, new RegExp(`\`${f}-\\*\``), f);
  assert.ok(!/rights to be confirmed/i.test(credits.split("## Earlier pictures")[0]), "every picture in use has a recorded licence");
  assert.match(credits, /built entirely in code/);
});

test("light theme: daylight hero photo and tracking band, map palette follows the theme, no forced dark bands", () => {
  const css = read("ui/theme-light.css");
  assert.match(css, /\.hero3-media \{[^}]*filter: none/, "the photo is shown at full brightness"); assert.match(css, /port-1280\.jpg/);
  assert.ok(!/color-scheme: dark/.test(css), "no section is forced dark in the light theme");
  for (const f of ["assets/hero/scene-day.svg", "assets/hero/scene-mobile-day.svg"]) { const svg = read(f); assert.ok(svg.length < 48000); assert.ok(!/<image|href="http/.test(svg)); }
  assert.match(read("ui/globe/palette.js"), /data-theme|dataset\.theme/);
  for (const f of ["ui/globe/globe.js", "ui/globe/flatmap.js"]) assert.match(read(f), /onPalette\(/, f);
  const html = read("index.html");
  assert.ok(!/freightRoutes|renderFreightRoutes/.test(html), "the old 3-item panel stays removed");
  assert.match(read("ui/theme-light.css"), /html\[data-theme="light"\] \.freight-network \{ --ng-sea-1/, "the network globe has a light palette");
  assert.match(read("ui/network-globe.js"), /document\.addEventListener\("hx-theme", onTheme\)/, "the globe re-reads its palette on a theme switch");
  assert.match(read("tracker/3d/core.js"), /document\.addEventListener\("hx-theme", onTheme\)/, "an open 3D scene is re-lit on a theme switch");
  assert.match(read("tracker/map.js"), /document\.addEventListener\("hx-theme", onTheme\)/, "the shipment map follows the theme");
});

test("homepage network: a worldwide connections globe that needs no admin data and never claims live shipments", async () => {
  const { HUBS, CONNECTIONS, REGIONS, hubById, distanceKm, createScheduler } = await import("../ui/network-routes.js");
  const ids = new Set(HUBS.map((h) => h.id));
  assert.equal(ids.size, HUBS.length, "unique hub ids");
  for (const h of HUBS) { assert.ok(Math.abs(h.lat) <= 90 && Math.abs(h.lng) <= 180 && !(h.lat === 0 && h.lng === 0), h.id); assert.ok(REGIONS.includes(h.region), h.id); assert.ok(h.city && h.country, h.id); }
  for (const [a, b] of CONNECTIONS) { assert.ok(ids.has(a) && ids.has(b), `${a}>${b}`); assert.notEqual(a, b); }
  assert.equal(new Set(CONNECTIONS.map(([a, b]) => `${a}>${b}`)).size, CONNECTIONS.length, "no duplicate connections");
  const used = new Set(CONNECTIONS.flat()); for (const h of HUBS) assert.ok(used.has(h.id), `${h.id} is used`);
  for (const r of REGIONS) assert.ok(HUBS.some((h) => h.region === r), r);
  assert.ok(HUBS.length >= 80 && CONNECTIONS.length >= 300, `a large network, not a fixed list: ${HUBS.length} hubs, ${CONNECTIONS.length} connections`);
  for (const r of REGIONS) assert.ok(HUBS.filter((h) => h.region === r).length >= 5, `${r} is well represented`);
  for (const id of ["lagos", "accra", "abidjan", "dakar", "casablanca", "cairo", "nairobi", "london", "frankfurt", "hamburg", "amsterdam", "antwerp", "rotterdam", "shanghai", "hongkong", "singapore", "tokyo", "dubai", "newyork", "toronto", "losangeles", "saopaulo", "buenosaires", "santiago", "sydney", "melbourne"]) assert.ok(ids.has(id), id);
  const pairs = new Set(CONNECTIONS.map(([a, b]) => [hubById.get(a).region, hubById.get(b).region].sort().join("|")));
  assert.ok(pairs.size >= 18, `many continent pairings: ${pairs.size}`);
  assert.ok(CONNECTIONS.filter((c) => c.includes("lagos")).length >= 8, "Lagos is well connected");
  for (const pair of [["shanghai", "newyork"], ["frankfurt", "london"], ["tokyo", "sydney"], ["dubai", "lagos"], ["singapore", "rotterdam"], ["toronto", "amsterdam"], ["hongkong", "singapore"], ["nairobi", "dubai"]])
    assert.ok(CONNECTIONS.some((c) => c[0] === pair[0] && c[1] === pair[1]), pair.join(">"));
  const km = distanceKm(hubById.get("lagos"), hubById.get("london")); assert.ok(km > 4900 && km < 5100, String(km));
  // scheduler: no repeats inside its window, never a duplicate on screen, and the visible set mixes regions
  let seed = 7; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const sch = createScheduler({ random }); const seen = []; let visible = [];
  const rp = ([a, b]) => [hubById.get(a).region, hubById.get(b).region].sort().join("|");
  for (let i = 0; i < 300; i++) {
    const c = sch.next(visible); const k = c.join(">");
    assert.ok(!visible.some((v) => v.join(">") === k), "never shown twice at once");
    assert.ok(!seen.slice(-24).includes(k), `no repeat within the window (${k})`);
    assert.ok(!visible.some((v) => rp(v) === rp(c)), `no continent pairing twice on screen (${rp(c)})`);
    seen.push(k); visible = [...visible.slice(-2), c];
    if (visible.length === 3) assert.ok(new Set(visible.flatMap(([a, b]) => [hubById.get(a).region, hubById.get(b).region])).size >= 2, "regions are mixed");
  }
  assert.equal(new Set(seen).size, 300, "300 picks, 300 different connections");
  // deterministic with a seeded random, varied without one
  const run = (sd) => { let x = sd; const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; const sc = createScheduler({ random: rnd }); return Array.from({ length: 10 }, () => sc.next().join(">")).join(","); };
  assert.equal(run(11), run(11)); assert.notEqual(run(11), run(12));
  // copy: a visualisation, never shipment data
  const src = read("ui/network-globe.js"); const h = read("index.html");
  assert.ok(!/not live shipments|Network visualisation/.test(h), "no disclaimer band around the globe (owner's choice); cards say 'Freight connection', never a shipment");
  assert.ok(!/data-ng-toggle|data-ng-next|ng-btn|>Play<|>Pause</.test(h + src), "no play/pause or manual controls: it runs by itself");
  assert.match(h, /Worldwide freight connections/);
  const prose = (src + read("ui/network-routes.js")).replace(/\/\/.*$/gm, "");
  assert.ok(!/\b(live|in transit|delivered|tracking (code|number)|shipments? (count|total)|active)\b/i.test(prose), "no live/status/code/count wording");
  assert.ok(!/fetch\(|\/api\//.test(src), "the globe reads no shipment data");
  assert.match(src, /new IntersectionObserver/, "pauses offscreen"); assert.match(src, /visibilitychange/, "pauses in a background tab");
  assert.match(src, /prefersReducedMotion\(\)/); assert.match(src, /function stillSwap\(\)/, "reduced motion still changes routes, without movement");
  assert.match(src, /li\.classList\.toggle\("is-focus"/, "the focused route's card is marked"); assert.match(src, /root\.dataset\.focus = focus/);
  assert.ok(!/Illustrative network — not live shipment activity|nw-tag/.test(h), "the old orange disclaimer is gone");
  // the real published-shipment feed stays separate (command centre), and still never shows record-edit times
  const cc = read("ui/globe/command-center.js");
  assert.match(cc, /o\.mode === "admin" \? r\.current\?\.recordedAt \|\| r\.updatedAt : activity\.find/, "public table never shows the record-edit time");
  assert.match(h, /import\("\.\/ui\/network-globe\.js"\)/); assert.ok(!/ui\/network\.js/.test(h));
});

test("tracking polish: heading, route line, 'Latest recorded milestone', a status explainer for every status", async () => {
  const { STATUS_HELP } = await import("../tracker/scene.js");
  const { STATUS } = await import("../shared/status.js");
  for (const code of Object.values(STATUS)) assert.ok(STATUS_HELP[code] && STATUS_HELP[code].length > 20, code);
  assert.ok(!/because|due to/i.test(Object.values(STATUS_HELP).join(" ")), "no invented reasons");
  const t = read("tracker/tracker.js");
  assert.match(t, /<div class="hx-od">/); assert.equal(EN["tr.help.q"], "What does “{status}” mean?"); assert.match(t, /t\("tr\.help\.q", \{ status: statusText\(v\.status\) \}\)/);
  assert.match(plain(read("index.html")), /<h2 class="track-title">Track your shipment<\/h2>/);
  const tp = read("track.html"); assert.match(tp, /<div id="error" class="error-message" role="alert"><\/div>/); assert.match(tp, /notfound: t\("track\.err\.notfound"\)/);
  assert.equal(EN["track.err.notfound"], "Tracking number not found.");
  assert.match(t, /function routeSummaryHtml\(v\)/); assert.equal(EN["tr.map.cap"], "Lines connect recorded places; they aren't a tracked path."); assert.match(t, /t\("tr\.map\.cap"\)/);
  assert.match(t, /data-slot="mapnote"/, "the map note has a place to render");
});

test("admin on iPhone: bottom tab bar, readable text, status breakdown from real counts, change history, e-mail field", () => {
  const h = read("admin.html"); const c = read("admin/center.js"); const css = read("admin/console.css");
  for (const tab of ["dashboard", "shipments", "tracking", "more"]) assert.ok(h.includes(`data-tab="${tab}"`), tab);
  assert.match(css, /body\.console \.tabbar button \{[^}]*min-height: 56px/); assert.match(css, /font-size: 13px !important/);
  assert.match(c, /const by = d\.byStatus \|\| \{\}/, "status breakdown uses the server's counts");
  assert.match(c, /if \(can\("clients"\)\) api\("listClients"\)/, "client count only for permitted admins");
  assert.match(c, /api\("audit", \{ limit: 50, code \}\)/, "change history reuses the audit log");
  assert.match(h, /id="notifyEmail"/); assert.match(h, /id="shipmentNotifyEmailInput"/); assert.match(c, /cmp\("notifyEmail"/);
});

test("shipment map places: a verified city table, read-time only, never a guess", async () => {
  const { PLACES, resolvePlace } = await import("../shared/places.js");
  const { countryAt } = await import("../api/_lib/geo.js");
  const fc = JSON.parse(read("assets/geo/countries-110m.json"));
  // every city sits in its country (or within 0.7° of its outline: coastal cities on a 1:110m map); a few small states
  // have no outline at this scale
  const NO_OUTLINE = new Set(["BH", "MU", "HK", "MO", "SG"]);
  const near = (p) => { let best = Infinity;
    for (const f of fc.features) { if (f.properties.iso !== p.country) continue; const g = f.geometry; const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      for (const poly of polys) for (const [x, y] of poly[0]) best = Math.min(best, Math.hypot(x - p.lng, y - p.lat)); }
    return best; };
  assert.ok(PLACES.length >= 200, String(PLACES.length));
  assert.equal(new Set(PLACES.map((p) => `${p.name}|${p.country}`)).size, PLACES.length, "no duplicate cities");
  for (const p of PLACES) {
    assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0), p.name);
    if (NO_OUTLINE.has(p.country)) continue;
    assert.ok(countryAt(p.lat, p.lng) === p.country || near(p) <= 0.9, `${p.name} (${p.country}) is not in its country: ${countryAt(p.lat, p.lng)}, ${near(p).toFixed(2)}°`);
  }
  const at = (t) => { const r = resolvePlace(t); return r && [r.name, r.country, r.approx]; };
  assert.deepEqual(at("Los Angeles, California"), ["Los Angeles", "US", true]);
  assert.deepEqual(at("Seoul, Republic of Korea"), ["Seoul", "KR", true]);
  assert.deepEqual(at("Atlanta, Georgia"), ["Atlanta", "US", true], "a US state name that is also a country");
  assert.deepEqual(at("Port of Shanghai, China"), ["Shanghai", "CN", true]);
  assert.deepEqual(at("Honolulu, Hawaii"), ["Honolulu", "US", true]);
  for (const t of ["Somewhere", "Atlantic Ocean", "Lagos, Portugal", "Suez Canal, Egypt", "", null, 42]) assert.equal(resolvePlace(t), null, String(t));
});

test("shipment map data: recorded coordinates first, city-level fallbacks flagged, nothing invented, the short way round", async () => {
  const { resolveMapData, hasPoints } = await import("../tracker/map-data.js");
  const { unwrapRoute, pointsOf } = await import("../tracker/map.js");
  // no stored coordinates at all (what the live LA → Seoul shipment has): endpoints come from the city table, flagged
  let d = resolveMapData({ origin: "Los Angeles, California", destination: "Seoul, Republic of Korea", map: { origin: null, destination: null, current: null, trail: [] }, timeline: [] });
  assert.equal(d.origin.approx, true); assert.equal(d.destination.approx, true); assert.equal(d.current, null, "no latest location invented");
  assert.deepEqual(d.resolved, { origin: true, destination: true, current: false });
  // recorded coordinates always win; invalid ones are dropped
  d = resolveMapData({ origin: "Los Angeles, California", map: { origin: { lat: 34, lng: -118 }, destination: { lat: 0, lng: 0 }, destinationLabel: "Atlantis", current: { lat: 200, lng: 5 }, trail: [{ lat: 21.3, lng: -157.9, name: "Honolulu", timestamp: "2026-10-01T00:00:00Z" }, { lat: "x", lng: 1 }] }, timeline: [] });
  assert.deepEqual([d.origin.lat, d.origin.approx], [34, undefined]); assert.equal(d.destination, null, "0,0 and unknown names are not drawn");
  assert.equal(d.trail.length, 1); assert.equal(d.current.fromTrail, true, "the newest recorded checkpoint is the latest location");
  assert.equal(d.current.name, "Honolulu"); assert.equal(d.current.at, "2026-10-01T00:00:00Z");
  // no coordinates anywhere, but a recorded event names a known city: city level, with the event's own time
  d = resolveMapData({ map: { trail: [] }, timeline: [{ title: "Arrived", location: "Incheon, South Korea", timestamp: "2026-10-05T00:00:00Z" }, { title: "Departed", location: "Los Angeles, CA" }] });
  assert.deepEqual([d.current.name, d.current.approx, d.current.at], ["Incheon, South Korea", true, "2026-10-05T00:00:00Z"]);
  assert.equal(hasPoints(resolveMapData({ origin: "Somewhere", destination: "Elsewhere", map: {}, timeline: [] })), false, "nothing to draw → the honest 'awaiting' panel");
  // date line: Los Angeles → Honolulu → Seoul stays continuous and spans the Pacific, not the long way round
  const seq = unwrapRoute([[34.05, -118.24], [21.31, -157.86], null, [37.57, 126.98]]);
  assert.equal(seq[2], null); assert.ok(Math.abs(seq[3][1] - seq[1][1]) <= 180, JSON.stringify(seq));
  const pts = pointsOf({ origin: { lat: 34.05, lng: -118.24 }, trail: [{ lat: 21.31, lng: -157.86 }], destination: { lat: 37.57, lng: 126.98 } });
  const lngs = pts.map((p) => p[1]); assert.ok(Math.max(...lngs) - Math.min(...lngs) < 180, `bounds span ${Math.max(...lngs) - Math.min(...lngs)}°`);
  const tokyoLa = unwrapRoute([[35.68, 139.69], [34.05, -118.24]]); assert.ok(Math.abs(tokyoLa[1][1] - tokyoLa[0][1]) < 180);
  // the map never waits for a visitor to press anything: it frames on load and on resize, and user intent comes only from input
  const src = read("tracker/map.js");
  assert.match(src, /for \(const t of \["pointerdown", "wheel", "keydown"\]\) el\.addEventListener\(t, handled/);
  assert.ok(!/map\.on\("dragstart zoomstart"/.test(src), "Leaflet's own move events no longer count as the visitor moving the map");
  assert.match(src, /if \(!layers\.current\) \{ fit\(\); onStatus\?\.\("no-current"\); return; \}/, "Locate never pretends");
  assert.match(src, /renderer: outlineRenderer/); assert.match(src, /shifted\(-360\), \.\.\.shifted\(0\), \.\.\.shifted\(360\)/);
});

test("tawk.to: one chat loader on each public page, guarded against double loads, no HubSpot/Smartsupp; none on admin pages", () => {
  const src = "https://embed.tawk.to/6ad58a3eb5a48e34d3f1d2de/default";
  for (const page of ["index.html", "track.html", "tracking-enhanced.html", "investment.html", "client-dashboard.html"]) {
    const h = read(page);
    assert.equal(h.split(src).length - 1, 1, `${page}: the tawk.to loader exactly once`);
    assert.equal((h.match(/Start of Tawk\.to Script/g) || []).length, 1, `${page}: one tawk.to block`);
    assert.match(h, /if \(document\.querySelector\('script\[src\*="embed\.tawk\.to"\]'\)\) return;/, `${page}: never loads twice`);
    assert.ok(h.indexOf(src) < h.indexOf("</head>"), `${page}: in <head>`);
    assert.ok(!/hs-scripts|hs-script-loader|smartsupp/i.test(h), `${page}: one chat only (HubSpot and Smartsupp removed)`);
  }
  for (const page of ["admin.html", "login.html", "dashboard.html"]) assert.ok(!/tawk\.to|hs-scripts/i.test(read(page)), `${page}: staff pages have no customer chat`);
});

test("carrier cards: own photo by carrier id or a name-led card; never a stage photo or drawing; no credit lines needed", async () => {
  const { CARRIERS, carrierCategory } = await import("../shared/carriers.js");
  const { carrierMedia, CARRIER_PHOTOS } = await import("../ui/carrier-media.js");
  const exists = (f) => fs.existsSync(new URL(`../${f}`, import.meta.url));
  for (const c of CARRIERS) {
    const m = carrierMedia({ id: c.id, category: carrierCategory(c) });
    if (m.type === "photo") {
      assert.ok(m.base.startsWith("assets/carriers/"), `${c.id}: carrier photos live in assets/carriers`);
      for (const w of m.widths) for (const ext of ["avif", "webp", "jpg"]) assert.ok(exists(`${m.base}-${w}.${ext}`), `${c.id}: ${m.base}-${w}.${ext}`);
      assert.ok(m.alt && m.alt.length > 10);
    } else assert.deepEqual(m, { type: "name", category: carrierCategory(c) }, `${c.id}: name-led card`);
  }
  // public domain or CC0 photos only (no attribution required), each of the carrier it is mapped to
  const ids = CARRIERS.map((c) => c.id);
  assert.equal(Object.keys(CARRIER_PHOTOS).length, 19);
  for (const [id, p] of Object.entries(CARRIER_PHOTOS)) {
    assert.ok(ids.includes(id), `${id} is a real carrier`);
    assert.match(p.base, /^assets\/carriers\/[a-z0-9-]+$/, `${id}: a descriptive file name in assets/carriers`);
    assert.match(p.license, /^(CC0|Public domain)$/, `${id}: no attribution required`);
    assert.match(p.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, `${id}: source on record`);
    assert.ok(!p.credit && !p.illustrative, `${id}: no credit or stand-in`);
  }
  for (const id of ["2goexpress", "aramex", "giglogistics", "redstarexpress"]) assert.equal(carrierMedia({ id, category: "regional" }).type, "name", `${id}: name-led card`);
  assert.equal(carrierMedia({ id: "tesla-transport", category: "custom" }).base, "assets/carriers/tesla-semi-silver");
  assert.equal(carrierMedia({ id: "ups", category: "express" }).base, "assets/carriers/ups-tractor-trailer");
  const cardFiles = fs.readdirSync(new URL("../assets/carriers/", import.meta.url)).filter((f) => /-(480|960)\.(avif|webp|jpg)$/.test(f));
  assert.equal(cardFiles.length, 19 * 6, "only the mapped photos are shipped");
  // no credit text, credits page or credits link anywhere on the site
  assert.ok(!/cr-credit|photoCredit|Wikimedia|Illustrative photo|cr-illus/.test(read("ui/carriers.js") + read("ui/command-center.css")), "no photo credits on the cards");
  assert.ok(!exists("credits.html"), "no Image Credits page");
  for (const f of ["index.html", "track.html", "tracking-enhanced.html", "carriers.html"]) {
    const html = read(f);
    assert.ok(!/credits\.html|Image credits/i.test(html), `${f}: no credits link`);
    assert.match(html, /<span data-i18n="foot.trademarks">Carrier names are trademarks of their owners\.<\/span><\/div>/, `${f}: trademark disclaimer kept`);
  }
  assert.equal(carrierMedia({ id: "constructor", category: "air" }).type, "name", "no prototype lookups");
  assert.equal(carrierMedia({ id: "new-carrier", category: "nonsense" }).category, "custom");
  const shuffled = CARRIERS.slice().reverse().map((c) => [c.id, JSON.stringify(carrierMedia({ id: c.id, category: carrierCategory(c) }))]);
  for (const [id, m] of shuffled) assert.equal(m, JSON.stringify(carrierMedia({ id, category: carrierCategory(CARRIERS.find((c) => c.id === id)) })));
  const sources = read("assets/carriers/SOURCES.md");
  for (const [id, m] of Object.entries(CARRIER_PHOTOS)) assert.ok(sources.includes(`| ${id} |`) && sources.includes(m.source) && sources.includes(m.base.split("/").pop()), `source recorded for ${id}`);
  assert.ok(!exists("assets/carriers/ATTRIBUTION.md"));
  assert.ok(!fs.existsSync(new URL("../assets/carriers/CREDITS.md", import.meta.url)), "owner screenshots with unverified rights are gone");
  const src = read("ui/carriers.js");
  assert.ok(!/<svg class="cr-art"|categoryArtSvg/.test(src + read("ui/carrier-media.js")), "no drawn stand-in pictures");
  assert.match(src, /alt=""/); assert.match(src, /loading="lazy"/); assert.match(src, /prefers-reduced-motion: reduce/);
  // monograms are taken from the carrier's own name
  const mono = new Function(`${src.match(/export function carrierMonogram[\s\S]*?\n}/)[0].replace("export ", "")}; return carrierMonogram;`)();
  assert.deepEqual(["DHL", "Australia Post", "EMS (Express Mail Service)", "SF Express", "Qatar Airways Cargo", "Correios"].map(mono), ["DHL", "AP", "EMS", "SF", "QAC", "Correios"]);
});

test("clients never see staff entry/edit times: only verified carrier/GPS times reach the tracking and public views", async () => {
  const { buildClientView, shipmentVersion } = await import("../api/_lib/client-view.js");
  const { buildPublicOverview } = await import("../api/_lib/public-view.js");
  const t1 = "2026-10-18T08:00:00.000Z"; const t2 = "2026-10-19T09:30:00.000Z"; const t3 = "2026-10-20T02:05:00.000Z";
  const shipment = { id: "HX-TIME-1", rev: 7, statusCode: "AT_FACILITY", origin: "Lagos, Nigeria", destination: "London, United Kingdom", location: "Lagos, Nigeria",
    latitude: 6.52, longitude: 3.38, locationSource: "admin", locationUpdatedAt: t3, statusUpdatedAt: t3, updatedAt: t3, createdAt: t1, publicMap: true,
    originLat: 6.52, originLng: 3.38, destinationLat: 51.5, destinationLng: -0.12, exception: null };
  const events = [
    { id: "e1", statusCode: "CREATED", title: "Shipment Registered", timestamp: t1, createdAt: t1, source: "admin", clientVisible: true, seq: 1 },
    { id: "e2", statusCode: "IN_TRANSIT", title: "In Transit", location: "Accra, Ghana", timestamp: t2, createdAt: t2, source: "carrier_api", clientVisible: true, seq: 2 },
    { id: "e3", statusCode: "AT_FACILITY", title: "Facility Arrival", location: "Lagos, Nigeria", timestamp: t3, createdAt: t3, source: "admin", clientVisible: true, seq: 3 }
  ];
  const locations = [{ lat: 6.52, lng: 3.38, name: "Lagos", timestamp: t3, source: "admin" }, { lat: 5.6, lng: -0.19, name: "Accra", timestamp: t2, source: "gps" }];
  const v = buildClientView({ shipment, events, locations });
  const json = JSON.stringify(v);
  for (const t of [t1, t3]) assert.ok(!json.includes(t) && !json.includes(t.slice(0, 16)), `staff time ${t} never reaches the client`);
  assert.ok(!("lastUpdated" in v) && !("createdAt" in v), "no record edit / creation time");
  assert.deepEqual(v.timeline.map((e) => [e.id, e.timestamp]), [["e3", null], ["e2", t2], ["e1", null]], "order kept; only the carrier event keeps its time");
  assert.equal(v.timeline[0].title, "Facility Arrival");
  assert.equal(v.currentLocation.updatedAt, null); assert.equal(v.locationState.updatedAt, null);
  assert.deepEqual(v.map.trail.map((p) => p.timestamp), [t2, null]);
  assert.equal(v.version, "7");
  assert.match(shipmentVersion({ updatedAt: t3 }), /^h[0-9a-f]{12}$/, "old records get an opaque version, not their edit time");
  const delivered = buildClientView({ shipment: { ...shipment, statusCode: "DELIVERED" }, events: [{ ...events[2], id: "e4", statusCode: "DELIVERED" }] });
  assert.equal(delivered.eta.state, "delivered"); assert.equal(delivered.eta.deliveredAt, null, "a staff-recorded delivery has no client-visible time");
  const overview = buildPublicOverview({ summaries: [shipment], publicShipments: [shipment], eventsByCode: new Map([[shipment.id, events.slice().reverse()]]) });
  const oj = JSON.stringify(overview);
  assert.ok(!oj.includes(t3) && !oj.includes(t1), "the homepage overview carries no staff times");
  assert.ok(!("lastUpdated" in overview.stats));
  assert.deepEqual(overview.activity.map((a) => a.at), [null, t2, null]);
  assert.ok(overview.routes.every((r) => !("updatedAt" in r) && !("sortKey" in r)));
  // the tracker shows a milestone time only when the server sent one
  const tr = read("tracker/tracker.js");
  assert.match(tr, /\$\{ev\.timestamp \? `<div class="hx-tl-time">/);
  assert.match(tr, /\$\{latest\.timestamp \? `<div class="hx-fact-sub"><time/);
});

test("admin dashboard: compact KPI tiles from real totals, total shows archived, registered clients and orphan sign-in accounts reported", async () => {
  const { createMemoryStore } = await import("../api/_lib/store/memory.js");
  const store = createMemoryStore({ clients: { a: { name: "A", email: "a@x.test", status: "active" } },
    authUsers: { a: { email: "a@x.test" }, b: { email: "b@x.test" }, adm: { email: "o@x.test", admin: true } } });
  assert.equal(await store.countAccountsWithoutProfile(), 1, "b has no profile; admins are not clients");
  const c = read("admin/center.js");
  assert.match(c, /incl\. \$\{t\.archived\} archived/);
  assert.match(c, /accountsWithoutProfile/);
  assert.match(c, /kpi-alert/);
  assert.ok(!/Math\.random|demo|sample/i.test(c.match(/async function loadDashboard[\s\S]*?\n {2}}\n/)[0]), "no invented figures");
  assert.match(read("admin.html"), /admin\/dashboard\.css/);
  assert.match(read("admin.html"), /id="dashStack"/);
});

test("Carrier Network page: public carrier directory with the shared header, no admin tools, linked from every public menu", () => {
  const page = read("carriers.html");
  assert.match(page, /mountCarrierDirectory\(document\.getElementById\("carrierDirectory"\), document\.getElementById\("carrierTabs"\), \{ collapse: false \}\)/);
  assert.ok(!/api\/admin|admin\.js|center\.js/.test(page), "no admin code");
  assert.equal(page.split("embed.tawk.to/6ad58a3eb5a48e34d3f1d2de/default").length - 1, 1, "one guarded tawk.to loader");
  const header = (f) => read(f).match(/<!-- site-header -->[\s\S]*?<!-- \/site-header -->/)[0];
  for (const f of ["index.html", "track.html", "tracking-enhanced.html"]) {
    assert.equal(header(f), header("carriers.html"), `${f}: same header`);
    assert.match(plain(read(f)), /<a href="\/carriers\.html">Carrier network<\/a>/);
  }
});

test("carrier images and shipment-stage images are separate: no shared files, imports or fallbacks", async () => {
  const media = read("ui/carrier-media.js"); const cards = read("ui/carriers.js");
  for (const src of [media, cards]) {
    assert.ok(!/assets\/(stages|journey|freight)\//.test(src), "carrier cards never use stage, journey or freight pictures");
    assert.ok(!/tracker\//.test(src), "carrier cards don't import tracking code");
  }
  for (const f of ["tracker/scene.js", "tracker/tracker.js"]) {
    const t = read(f);
    assert.ok(!/carrier-media|assets\/carriers\//.test(t), `${f} never uses carrier pictures`);
  }
  // the stage photo depends on the recorded status and transport mode only, never on the carrier
  const { stagePhoto } = await import("../tracker/scene.js");
  const view = (courier, code, mode) => ({ courier, courierName: courier, status: { code }, transportMode: mode, timeline: [] });
  for (const code of ["CREATED", "PROCESSING", "AT_FACILITY", "CUSTOMS", "OUT_FOR_DELIVERY"]) {
    const keys = ["dhl", "ups", "maersk", "emiratesskycargo", "giglogistics"].map((c) => stagePhoto(view(c, code))?.key);
    assert.equal(new Set(keys).size, 1, `${code}: same stage picture for every carrier (${keys})`);
  }
  assert.equal(stagePhoto(view("dhl", "AT_FACILITY")).key, "aerial");
  assert.equal(stagePhoto(view("ups", "AT_FACILITY")).file, "stage-facility", "UPS's own photo never replaces the stage picture");
});
