// Interface translations for the public (customer-facing) pages. No library: one dictionary per language in
// ui/locales/<code>.js (flat, stable keys), English as the source and the fallback for any missing key.
//
// Rules:
//   - English is the default. A language changes only when the visitor picks one; the choice is remembered on this
//     device (localStorage "hx-lang"). Browser language, IP or country are never used.
//   - Only presentation is translated. Tracking codes, names, addresses, stored statuses and API data never change;
//     known status codes are mapped to a translated label at display time.
//   - Pages opt in by calling initI18n() (ui/site-shell.js does this on the public pages). Until then t() returns
//     English, so shared components (e.g. the tracker in the admin "Preview client view") stay English in the admin.
//   - Translated text is display content only: textContent, or rich() which allows a few inline tags without
//     attributes and escapes everything else.
import EN from "./locales/en.js";

export const STORAGE_KEY = "hx-lang";
export const DEFAULT_LANG = "en";

/** The selector's languages, in display order. `intl` is the locale used for dates and numbers. */
export const LANGUAGES = Object.freeze([
  { code: "en", name: "English", english: "English", intl: "en", dir: "ltr" },
  { code: "pt-PT", name: "Português (Portugal)", english: "Portuguese (Portugal)", intl: "pt-PT", dir: "ltr" },
  { code: "pt-BR", name: "Português (Brasil)", english: "Portuguese (Brazil)", intl: "pt-BR", dir: "ltr" },
  { code: "ro", name: "Română", english: "Romanian", intl: "ro", dir: "ltr" },
  { code: "es", name: "Español", english: "Spanish", intl: "es", dir: "ltr" },
  { code: "fr", name: "Français", english: "French", intl: "fr", dir: "ltr" },
  { code: "de", name: "Deutsch", english: "German", intl: "de", dir: "ltr" },
  { code: "it", name: "Italiano", english: "Italian", intl: "it", dir: "ltr" },
  { code: "nl", name: "Nederlands", english: "Dutch", intl: "nl", dir: "ltr" },
  { code: "ar", name: "العربية", english: "Arabic", intl: "ar-u-nu-latn", dir: "rtl" }, // Western digits keep codes and dates consistent
  { code: "zh-CN", name: "简体中文", english: "Chinese (Simplified)", intl: "zh-CN", dir: "ltr" },
  { code: "pcm", name: "Naijá (Nigerian Pidgin)", english: "Nigerian Pidgin", intl: "en-NG", dir: "ltr" } // no Intl data for pcm
]);
const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
export const isLang = (code) => BY_CODE.has(code);
export const langInfo = (code = current) => BY_CODE.get(code) || BY_CODE.get(DEFAULT_LANG);

const dicts = { en: EN };
let current = DEFAULT_LANG;
let active = false; // set by initI18n(): pages that never call it (admin) always get English
const debug = (() => { try { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]i18n=debug\b/.test(location.search); } catch { return false; } })();
const reported = new Set();

export const getLang = () => (active ? current : DEFAULT_LANG);
export const intlLocale = () => langInfo(getLang()).intl;

/** Saved choice, or English. Never the browser language. */
export function storedLang() {
  try { const v = localStorage.getItem(STORAGE_KEY); return isLang(v) ? v : DEFAULT_LANG; } catch { return DEFAULT_LANG; }
}

function lookup(key) {
  const lang = getLang();
  const d = dicts[lang];
  if (d && Object.hasOwn(d, key)) return d[key];
  if (lang !== DEFAULT_LANG && debug && !reported.has(`${lang}:${key}`)) { reported.add(`${lang}:${key}`); console.warn(`[i18n] missing "${key}" in ${lang}; using English`); }
  if (Object.hasOwn(EN, key)) return EN[key];
  if (debug && !reported.has(key)) { reported.add(key); console.warn(`[i18n] unknown key "${key}"`); }
  return null;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? vars[k] === 0 ? String(vars[k]) : m)) : s);

/** Translated text for `key` with {placeholders} filled in. `fallback` (e.g. the stored text) is used for unknown keys. */
export function t(key, vars, fallback) {
  const s = lookup(key);
  if (s == null) return fallback != null ? String(fallback) : key;
  return fill(s, vars);
}

/** Like t(), but only when the key exists; otherwise null (for mapping stored values that may be custom text). */
export function tMaybe(key, vars) {
  const d = dicts[getLang()];
  const s = (d && Object.hasOwn(d, key) ? d[key] : null) ?? (Object.hasOwn(EN, key) ? EN[key] : null);
  return s == null ? null : fill(s, vars);
}

/**
 * Escaped HTML for `key`: the translated text and `vars` are escaped; only `html` values (markup built by the caller,
 * e.g. a <strong> count) are inserted as they are.
 */
export function tHtml(key, html = {}, vars = {}) {
  const s = lookup(key) ?? key;
  return esc(s).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(html, k) ? String(html[k]) : Object.hasOwn(vars, k) ? esc(vars[k]) : m));
}

const pluralKey = (key, n) => {
  let cat = "other";
  try { cat = new Intl.PluralRules(intlLocale()).select(n); } catch { /* keep "other" */ }
  return tMaybe(`${key}.${cat}`) != null ? `${key}.${cat}` : `${key}.other`;
};
/** tHtml() with plural forms. */
export function tnHtml(key, n, html = {}, vars = {}) { return tHtml(pluralKey(key, n), html, { n: fmtNumber(n), ...vars }); }

/** Plural-aware text: `${key}.${category}` (Intl.PluralRules), falling back to `${key}.other`. {n} is the count. */
export function tn(key, n, vars = {}) { return t(pluralKey(key, n), { n: fmtNumber(n), ...vars }); }


export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
/** Escaped text in which only <strong> <em> <span> <small> <br> (no attributes) are kept as markup. */
export const rich = (s) => esc(s).replace(/&lt;(\/?)(strong|em|span|small|br)\s*\/?&gt;/g, "<$1$2>");

// ---------- locale-aware formatting (presentation only; the stored values never change) ----------
const cacheFmt = new Map();
function formatter(kind, opts) {
  const k = `${intlLocale()}|${kind}`;
  if (!cacheFmt.has(k)) { try { cacheFmt.set(k, kind.startsWith("rel") ? new Intl.RelativeTimeFormat(intlLocale(), opts) : kind.startsWith("num") ? new Intl.NumberFormat(intlLocale(), opts) : new Intl.DateTimeFormat(intlLocale(), opts)); } catch { cacheFmt.set(k, null); } }
  return cacheFmt.get(k);
}
/** A recorded timestamp in the visitor's time zone (the instant is unchanged; only its wording follows the language). */
export function fmtDateTime(iso) {
  const d = new Date(iso); if (Number.isNaN(+d)) return "";
  const f = formatter("dt", { dateStyle: "medium", timeStyle: "short" }); return f ? f.format(d) : d.toLocaleString();
}
/** A calendar date stored as YYYY-MM-DD (no time zone shift). */
export function fmtDate(ymd, style = "full") {
  const d = new Date(`${ymd}T00:00:00Z`); if (Number.isNaN(+d)) return String(ymd ?? "");
  const f = formatter(`d-${style}`, { dateStyle: style, timeZone: "UTC" }); return f ? f.format(d) : String(ymd);
}
export function fmtWeekday(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`); if (Number.isNaN(+d)) return "";
  const f = formatter("wd", { weekday: "long", timeZone: "UTC" }); return f ? f.format(d) : "";
}
export function fmtTime(ms) {
  const d = new Date(ms); if (Number.isNaN(+d)) return "";
  const f = formatter("tm", { hour: "2-digit", minute: "2-digit" }); return f ? f.format(d) : d.toLocaleTimeString();
}
export function fmtNumber(n, opts) { const f = formatter(`num${opts ? JSON.stringify(opts) : ""}`, opts); return f ? f.format(n) : String(n); }
/** "just now" / "5 minutes ago" for a real timestamp, in the selected language. */
export function fmtAgo(iso, now = Date.now()) {
  const ts = Date.parse(iso); if (!Number.isFinite(ts)) return null;
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return t("time.justNow");
  const f = formatter("rel", { numeric: "always" });
  const mins = Math.round(s / 60); const hours = Math.round(mins / 60); const days = Math.round(hours / 24);
  const [v, unit] = mins < 60 ? [mins, "minute"] : hours < 24 ? [hours, "hour"] : [days, "day"];
  return f ? f.format(-v, unit) : `${v} ${unit}${v === 1 ? "" : "s"} ago`;
}

// ---------- DOM ----------
/**
 * Applies translations to elements marked in the HTML (the English text stays in the markup as the no-script fallback):
 *   data-i18n="key"            textContent
 *   data-i18n-html="key"       rich() markup
 *   data-i18n-attr="attr:key; attr2:key2"
 */
export function applyI18n(root = document) {
  if (!active) return;
  const all = (sel) => [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  for (const el of all("[data-i18n]")) { const s = tMaybe(el.dataset.i18n); if (s != null) el.textContent = s; }
  for (const el of all("[data-i18n-html]")) { const s = tMaybe(el.dataset.i18nHtml); if (s != null) el.innerHTML = rich(s); }
  for (const el of all("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((x) => x.trim()); if (!attr || !key) continue;
      const s = tMaybe(key); if (s != null) el.setAttribute(attr, s);
    }
  }
  const title = document.querySelector("title[data-i18n]"); if (title && root === document) document.title = title.textContent;
}

function applyDocument() {
  const html = document.documentElement; const info = langInfo(current);
  html.lang = info.code; html.dir = info.dir;
  delete html.dataset.i18nPending;
  document.querySelectorAll("[data-lang-select]").forEach((s) => { s.value = current; });
  document.querySelectorAll("[data-lang-current]").forEach((el) => { el.textContent = info.code === "zh-CN" ? "中文" : info.code === "pcm" ? "PCM" : info.code.toUpperCase(); });
}

async function load(code) {
  if (dicts[code]) return dicts[code];
  const mod = await import(`./locales/${code}.js`);
  dicts[code] = mod.default || {};
  return dicts[code];
}

/** Switch language: loads its dictionary, updates <html lang/dir>, the marked elements, and tells components ("hx-lang"). */
export async function setLang(code, { persist = true } = {}) {
  const next = isLang(code) ? code : DEFAULT_LANG;
  try { await load(next); }
  catch (err) { console.warn(`[i18n] could not load ${next}:`, err?.message); if (next !== DEFAULT_LANG) return setLang(DEFAULT_LANG, { persist: false }); }
  current = next; active = true;
  if (persist) { try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode: lasts for this page */ } }
  applyDocument(); applyI18n(document);
  document.dispatchEvent(new CustomEvent("hx-lang", { detail: next }));
  return next;
}

let initPromise = null;
/** Called once by public pages: applies the saved language (English when none was chosen). */
export function initI18n() {
  if (!initPromise) {
    initPromise = setLang(storedLang(), { persist: false });
    // another tab changed the language
    window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY && isLang(e.newValue) && e.newValue !== current) setLang(e.newValue, { persist: false }); });
  }
  return initPromise;
}

/** Run `fn` now (if needed) and on every later language change. Returns an unsubscribe function. */
export function onLang(fn) {
  const h = (e) => fn(e.detail);
  document.addEventListener("hx-lang", h);
  return () => document.removeEventListener("hx-lang", h);
}

/** Every key in the English source dictionary (used by tests and the coverage report). */
export const SOURCE_KEYS = Object.freeze(Object.keys(EN));
