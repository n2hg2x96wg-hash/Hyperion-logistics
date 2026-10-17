// Operational repairs: coordinate validation, text-first countries, the admin location check (read-only),
// and public/admin separation of the public pages.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.STORE = "memory";
process.env.GEOCODER = "off";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-secret-test-secret-1234";

const { createServer } = await import("../dev-server.js");
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

test("homepage: freight showcase sits between global activity and carriers, with real actions and no fabricated proof", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const pos = (id) => html.indexOf(`id="${id}"`);
  assert.ok(pos("activity") > 0 && pos("activity") < pos("freight") && pos("freight") < pos("carriers"), "section order");
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
  assert.ok(pos("freight") < pos("journey") && pos("journey") < pos("carriers"), "order: freight → journey → carriers");
  assert.ok(!html.includes('id="ccStats"') && !html.includes("data-stat="), "statistics block stays hidden");
  const section = html.slice(pos("journey"), pos("carriers"));
  const img = section.match(/<img [^>]+>/)[0];
  assert.match(img, /width="1179" height="638"/); assert.match(img, /loading="lazy"/); assert.match(img, /alt="Illustration:[^"]+"/); assert.match(img, /onerror="/);
  assert.match(section, /<figcaption>Illustrative image<\/figcaption>/);
  assert.match(section, /href="#trackForm" data-focus-track/);
  assert.ok(!/★|rating|review|testimonial|customers|guarantee|\d+\s*%/i.test(section), "no ratings, reviews or invented figures");
  const refs = [...section.matchAll(/(?:src|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0]));
  assert.ok(refs.length >= 10);
  for (const f of refs) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `missing ${f}`);
});
