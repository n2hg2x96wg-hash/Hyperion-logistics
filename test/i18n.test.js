// Interface translations: every language has every key, keeps the {placeholders} and the few allowed inline tags of
// the English source, covers its plural forms, and every key used by the pages exists. Run: node --test test/i18n.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const { LANGUAGES, DEFAULT_LANG, t, tn, tHtml, rich, getLang, storedLang, isLang } = await import("../ui/i18n.js");
const EN = (await import("../ui/locales/en.js")).default;
const STATUS_MOD = await import("../shared/status.js");
const LOCALES = LANGUAGES.filter((l) => l.code !== "en").map((l) => l.code);
const load = async (code) => (await import(`../ui/locales/${code}.js`)).default;

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s) => [...String(s).matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[0]).sort();
const ALLOWED_TAG = /^<\/?(span|strong|em|small|br)\s*\/?>$/;
const pluralBase = (k) => k.replace(/\.(zero|one|two|few|many|other)$/, "");
const PLURAL_BASES = [...new Set(Object.keys(EN).filter((k) => /\.(one|other)$/.test(k)).map(pluralBase))];

test("i18n: twelve languages, English first and the default; codes as specified", () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ["en", "pt-PT", "pt-BR", "ro", "es", "fr", "de", "it", "nl", "ar", "zh-CN", "pcm"]);
  assert.equal(DEFAULT_LANG, "en");
  assert.deepEqual(LANGUAGES.filter((l) => l.dir === "rtl").map((l) => l.code), ["ar"]);
  for (const l of LANGUAGES) assert.ok(l.name && l.english && l.intl, `${l.code}: names and formatting locale`);
  assert.ok(LANGUAGES.find((l) => l.code === "pt-PT").name !== LANGUAGES.find((l) => l.code === "pt-BR").name, "two Portuguese options");
  // outside a browser (and in the admin, which never opts in) the interface is English
  assert.equal(getLang(), "en"); assert.equal(storedLang(), "en");
  assert.ok(isLang("pcm") && !isLang("pt") && !isLang("xx"));
});

test("i18n: no dictionary repeats a key (a repeated key silently replaces the first text)", () => {
  for (const l of LANGUAGES) {
    const keys = [...read(`ui/locales/${l.code}.js`).matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, [], `${l.code}: repeated keys`);
  }
});

test("i18n: English source is well formed (allowed tags only, plural pairs, no empty text)", () => {
  for (const [k, v] of Object.entries(EN)) {
    assert.equal(typeof v, "string", k); assert.ok(v.trim(), `${k}: not empty`);
    for (const tag of tags(v)) assert.match(tag, ALLOWED_TAG, `${k}: only inline tags`);
  }
  for (const b of PLURAL_BASES) assert.ok(`${b}.one` in EN && `${b}.other` in EN, `${b}: one/other`);
});

for (const code of LOCALES) {
  test(`i18n ${code}: same keys, placeholders and tags as English; plural forms complete`, async () => {
    const D = await load(code);
    const cats = new Intl.PluralRules(code === "pcm" ? "en" : code).resolvedOptions().pluralCategories;
    const enKeys = Object.keys(EN).filter((k) => !PLURAL_BASES.includes(pluralBase(k)) || k === pluralBase(k));
    const missing = enKeys.filter((k) => !(k in D));
    assert.deepEqual(missing, [], `${code}: missing keys`);
    for (const b of PLURAL_BASES) {
      for (const c of cats) assert.ok(`${b}.${c}` in D, `${code}: ${b}.${c} (plural category of this language)`);
      assert.ok(`${b}.other` in D, `${code}: ${b}.other`);
    }
    const extra = Object.keys(D).filter((k) => !(k in EN) && !PLURAL_BASES.includes(pluralBase(k)));
    assert.deepEqual(extra, [], `${code}: unknown keys`);
    for (const [k, v] of Object.entries(D)) {
      assert.equal(typeof v, "string", `${code} ${k}`); assert.ok(v.trim(), `${code} ${k}: not empty`);
      const src = EN[k] ?? EN[`${pluralBase(k)}.other`];
      assert.deepEqual(placeholders(v), placeholders(src), `${code} ${k}: placeholders`);
      assert.deepEqual(tags(v), tags(src), `${code} ${k}: inline tags`);
    }
  });
}

test("i18n: Portuguese for Portugal and Brazil are separate translations", async () => {
  const pt = await load("pt-PT"); const br = await load("pt-BR");
  const differ = Object.keys(EN).filter((k) => pt[k] !== br[k]).length;
  assert.ok(differ > Object.keys(EN).length * 0.25, `only ${differ} strings differ`);
});

test("i18n: every key used by the pages and scripts exists in English", () => {
  const files = ["ui/site-shell.js", "ui/theme.js", "ui/carriers.js", "ui/status-text.js", "ui/network-globe.js", "ui/globe/command-center.js",
    "tracker/tracker.js", "tracker/scene.js", "tracker/map.js", "index.html", "track.html", "tracking-enhanced.html", "carriers.html",
    "account.html", "ui/account.js", "ui/notification-center.js"];
  const PREFIX = /^(lang|meta|nav|cta|theme|foot|common|track|trackpage|home|svc|cc|map|route|status|event|exception|source|loc|help|eta|time|tr|stage|mode|stagePhoto|scene3d|view3d|support|carriers|carrier|region)\.[A-Za-z0-9_.-]+$/;
  const missing = [];
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/["'`]([A-Za-z][A-Za-z0-9_.-]+)["'`]/g)) {
      const k = m[1]; if (!PREFIX.test(k) || /\.(js|css|html|svg|jpg|png)$/.test(k)) continue;
      if (!(k in EN) && !(`${k}.other` in EN)) missing.push(`${f}: ${k}`);
    }
    for (const m of s.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
    for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(";")) { const k = p.split(":")[1]?.trim(); if (k && !(k in EN)) missing.push(`${f}: ${k}`); }
  }
  assert.deepEqual(missing, []);
  // dynamic keys: every status, milestone, exception, carrier and 3D view has its text
  const { STATUS_CODES, EXCEPTION_TYPES, EVENT_SOURCES } = STATUS_MOD;
  for (const c of STATUS_CODES) for (const p of ["status", "status.short", "event", "help"]) assert.ok(`${p}.${c}` in EN, `${p}.${c}`);
  for (const x of Object.keys(EXCEPTION_TYPES)) assert.ok(`exception.${x}` in EN, x);
  for (const x of Object.keys(EVENT_SOURCES)) assert.ok(`source.${x}` in EN, x);
});

test("i18n: catalogue carriers and 3D views have their text", async () => {
  const { CARRIERS } = await import("../shared/carriers.js");
  for (const c of CARRIERS) {
    if (c.description) assert.equal(EN[`carrier.${c.id}.desc`], c.description, `${c.id} description`);
    if (c.coverage) assert.equal(EN[`carrier.${c.id}.coverage`], c.coverage, `${c.id} coverage`);
    if (c.note) assert.equal(EN[`carrier.${c.id}.note`], c.note, `${c.id} note`);
  }
  for (const f of fs.readdirSync(new URL("../tracker/3d/scenes/", import.meta.url))) {
    for (const m of read(`tracker/3d/scenes/${f}`).matchAll(/\{ id: "([a-z-]+)", label: "([^"]+)"/g)) assert.ok(`view3d.${m[1]}` in EN, `view3d.${m[1]}`);
  }
});

test("i18n: English rendering and fallbacks (missing keys never break a page)", () => {
  assert.equal(t("status.IN_TRANSIT"), "In Transit");
  assert.equal(t("tr.stageOf", { i: 2, n: 8 }), "Stage 2 of 8");
  assert.equal(t("no.such.key"), "no.such.key", "unknown key: the key, never a crash");
  assert.equal(t("no.such.key", null, "Stored text"), "Stored text", "unknown key with stored text: the stored text");
  assert.equal(tn("tr.tl.count", 1), "1 recorded update"); assert.equal(tn("tr.tl.count", 3), "3 recorded updates");
  // translated text is escaped; only the allowed inline tags survive
  assert.equal(rich("A <span>B</span> <img src=x onerror=alert(1)> <strong>C</strong>"), "A <span>B</span> &lt;img src=x onerror=alert(1)&gt; <strong>C</strong>");
  assert.equal(tHtml("tr.stageOf", { i: "<strong>2</strong>" }, { n: "<b>8</b>" }), "Stage <strong>2</strong> of &lt;b&gt;8&lt;/b&gt;");
});

test("i18n: pages opt in, the admin does not; the language is never taken from the browser", () => {
  const src = read("ui/i18n.js");
  assert.ok(!/navigator\.(language|languages)|Accept-Language|geoip|ipapi/i.test(src), "no automatic language detection");
  assert.match(read("ui/site-shell.js"), /initI18n\(\)/);
  for (const f of ["index.html", "track.html", "tracking-enhanced.html", "carriers.html"]) {
    const html = read(f);
    assert.match(html, /localStorage\.getItem\("hx-lang"\)/, `${f}: saved language applied before first paint`);
    assert.match(html, /ui\/i18n\.css/, `${f}: selector styles`);
    assert.match(html, /ui\/site-shell\.js/, `${f}: selector`);
  }
  for (const f of ["admin.html", "dashboard.html", "login.html"]) assert.ok(!/initI18n|site-shell\.js|hx-lang/.test(read(f)), `${f}: admin stays English`);
});

test("i18n: system-written event sentences match the server's wording, so they can be shown in the visitor's language", async () => {
  const svc = read("api/_lib/service.js");
  assert.ok(svc.includes(`"${EN["desc.registered"]}"`));
  assert.ok(svc.includes("`Status updated to ${STATUS_META[newStatus].label}.`"));
  assert.ok(svc.includes("`Shipment location updated to ${where}.`") && svc.includes(`"${EN["desc.locationUpdated"]}"`));
  const { eventDescription, eventTitle } = await import("../ui/status-text.js");
  assert.equal(eventDescription({ description: "Status updated to Out for Delivery." }), "Status updated to Out for Delivery.");
  assert.equal(eventDescription({ description: "Customs hold: papers missing" }), "Customs hold: papers missing");
  assert.equal(eventDescription({ description: "Typed by operations." }), "Typed by operations.");
  assert.equal(eventTitle({ title: "Facility Arrival", statusCode: "AT_FACILITY" }), "Facility Arrival");
  assert.equal(eventTitle({ title: "Custom title", statusCode: "AT_FACILITY" }), "Custom title", "custom titles are kept");
});

test("i18n: old links to the removed Image Credits page go to the Carrier Network page", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.deepEqual(v.redirects, [{ source: "/credits.html", destination: "/carriers.html", permanent: true }]);
  assert.match(read("ui/site-shell.js"), /link\[href\$="i18n\.css"\]/, "the selector loads its own styles when a page lacks them");
});
