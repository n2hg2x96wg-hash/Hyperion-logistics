// Public carrier directory. Data: GET /api/public?view=carriers (honest integration status computed on the
// server), falling back to the built-in catalogue if the API is unreachable. Photo or name-led cards (ui/carrier-media.js);
// tapping a card opens its details (description, coverage, official site). An https logo image is used only when an
// approved logo URL has been configured for that carrier. Cards rise into view once (one IntersectionObserver) and
// tilt slightly under a mouse pointer; with reduced motion they simply appear.
import { CARRIERS, CARRIER_CATEGORIES, carrierCategory, carrierLogoUrl, carrierIntegration } from "../shared/carriers.js";
import { carrierMedia } from "./carrier-media.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORDER = ["express", "air", "ocean", "regional", "custom"];
const COLLAPSED = 8; // tiles shown on small screens before "Show all"

function fallback() {
  return CARRIERS.map((c) => ({ id: c.id, name: c.name, category: carrierCategory(c), categoryLabel: CARRIER_CATEGORIES[carrierCategory(c)], custom: c.type === "custom",
    brandColor: c.brandColor, logoUrl: carrierLogoUrl(c), description: c.description, coverage: c.coverage, website: c.type === "custom" ? null : c.website || null,
    note: c.note, integration: carrierIntegration(c), partner: c.verifiedPartner === true }));
}

const brand = (c) => (/^#[0-9a-f]{3,6}$/i.test(c.brandColor || "") ? c.brandColor : "#64748b");

// The public directory identifies carriers only. The way each carrier's updates arrive is an internal detail shown in the
// admin carrier list, not here. A "Verified partner" badge appears only for a partnership an admin recorded with
// evidence (none today).
const PARTNER_BADGE = '<span class="cr-chip partner"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 12 2 2 4-4"/><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/></svg>Verified partner</span>';

// category icon: on name-led cards and when a card's photo cannot load
const CAT_ICON = {
  air: '<path d="M2 16.5 22 9l-1.5-2-7 2.5L8 4H5.5l3.5 6.5L4 12l-2-1.5L1 11l2 3.5Z"/><path d="M3 20h18"/>',
  ocean: '<path d="M3 15h18l-2.5 4h-13Z"/><path d="M6 15V9h12v6"/><path d="M10 9V5h4v4"/>',
  express: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
};
const catIcon = (cat) => `<svg class="cr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAT_ICON[cat] || '<path d="M3 7h11v9H3Z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'}</svg>`;

// the carrier's own photo; a carrier without one gets a name-led panel (its name in display type over its brand colour),
// which never pretends to be a picture of that carrier
// monogram: short names as written (DHL, FedEx, CMA CGM), an all-caps first word as written (SF, GIG), a single long word
// whole (Correios), else initials (AP, QAC)
export function carrierMonogram(name) {
  const n = String(name || "").replace(/\s*\(.*?\)\s*/g, " ").trim();
  if (n.length <= 7) return n;
  const words = n.split(/\s+/);
  if (/^[A-Z0-9]{2,4}$/.test(words[0])) return words[0];
  return words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join("").toUpperCase() : n; // one long word: shown whole, smaller
}
// the credit each photo's licence requires: a short line on the card, the full linked credit in the details
const creditText = (cr) => `Photo: ${cr.author} · ${cr.license}`;
function media(c) {
  const m = carrierMedia(c);
  if (m.type === "photo") return picture(m) + (m.credit ? `<span class="cr-credit">${esc(creditText(m.credit))}</span>` : "");
  return `<span class="cr-name" aria-hidden="true"><span class="cr-name-mark${carrierMonogram(c.name).length > 5 ? " is-long" : ""}">${esc(carrierMonogram(c.name))}</span></span>`;
}

function picture(m) {
  const set = (ext) => m.widths.map((w) => `${m.base}-${w}.${ext} ${w}w`).join(", ");
  const sizes = "(max-width: 374px) 40vw, (max-width: 720px) 50vw, (max-width: 1099px) 25vw, 240px";
  return `<picture><source type="image/avif" srcset="${set("avif")}" sizes="${sizes}"><source type="image/webp" srcset="${set("webp")}" sizes="${sizes}">
      <img src="${m.base}-${m.widths[0]}.jpg" srcset="${set("jpg")}" sizes="${sizes}" alt="" width="480" height="300" loading="lazy" decoding="async" style="object-position:${m.position}"></picture>`;
}

function tile(c, open, seen) {
  const cat = c.category;
  const logo = c.logoUrl ? `<img class="cr-logo" src="${esc(c.logoUrl)}" alt="" loading="lazy" decoding="async">` : "";
  return `<button type="button" class="cr-tile${seen ? " is-in" : ""}" data-id="${esc(c.id)}" data-cat="${esc(cat)}" aria-expanded="${open}" aria-controls="cr-detail" style="--brand:${esc(brand(c))}">
    <span class="cr-media" data-media="${carrierMedia(c).type}">${media(c)}<span class="cr-cat-ico">${catIcon(cat)}</span>${logo}</span>
    <span class="cr-body"><span class="wm">${esc(c.name)}</span><span class="meta">${esc(CARRIER_CATEGORIES[cat] || c.categoryLabel || "")}</span>
    ${c.partner === true ? `<span class="chips">${PARTNER_BADGE}</span>` : ""}</span></button>`;
}

function photoCredit(c) {
  const m = carrierMedia(c); const cr = m.type === "photo" ? m.credit : null;
  if (!cr) return "";
  const lic = cr.licenseUrl ? `<a href="${esc(cr.licenseUrl)}" target="_blank" rel="noopener noreferrer license">${esc(cr.license)}</a>` : esc(cr.license);
  return `<p class="cr-photo-credit">Photo: <a href="${esc(cr.source)}" target="_blank" rel="noopener noreferrer">${esc(cr.author)}</a>, ${lic}, via Wikimedia Commons. Illustrates the carrier; not a Hyperion shipment.</p>`;
}

function detail(c) {
  return `<div class="cr-detail" id="cr-detail" role="region" aria-label="${esc(c.name)} details">
    <h4>${esc(c.name)}</h4>
    ${c.description ? `<p>${esc(c.description)}</p>` : ""}
    ${c.coverage ? `<p>Coverage: ${esc(c.coverage)}</p>` : ""}
    ${photoCredit(c)}
    ${c.custom && c.note ? `<p>${esc(c.note)}</p>` : ""}
    ${c.partner === true || c.website ? `<div class="row">${c.partner === true ? PARTNER_BADGE : ""}${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">Official site ↗</a>` : ""}</div>` : ""}</div>`;
}

export async function mountCarrierDirectory(root, tabsRoot, { collapse = true } = {}) {
  let carriers;
  try {
    const r = await fetch("/api/public?view=carriers", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    carriers = (await r.json()).carriers;
  } catch { carriers = fallback(); }
  carriers = carriers.slice().sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  let filter = "all"; let openId = null; let expanded = false;
  const small = window.matchMedia("(max-width: 720px)");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined";
  const seen = new Set(); // cards already revealed: re-renders (tabs, details) show them at once
  const io = still ? null : new IntersectionObserver((entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const t = e.target; io.unobserve(t); seen.add(t.dataset.id);
      t.style.setProperty("--i", String(Math.min(i++, 5))); t.classList.add("is-in");
      setTimeout(() => t.style.removeProperty("--i"), 1400); // the stagger only applies to the entrance
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  if (still) root.classList.add("cr-still");

  const render = () => {
    const list = carriers.filter((c) => filter === "all" || c.category === filter);
    const limit = collapse && small.matches && !expanded && filter === "all" ? COLLAPSED : list.length;
    const shown = list.slice(0, limit);
    if (openId && !shown.some((c) => c.id === openId)) openId = null;
    const parts = [];
    for (const c of shown) {
      parts.push(tile(c, c.id === openId, still || seen.has(c.id)));
      if (c.id === openId) parts.push(detail(c));
    }
    io?.disconnect();
    root.innerHTML = list.length
      ? `<div class="cr-grid" style="grid-auto-flow: row dense">${parts.join("")}</div>${limit < list.length ? `<button type="button" class="btn btn-ghost cr-more" data-more>Show all ${list.length} carriers</button>` : ""}`
      : '<p class="cr-note">No carriers in this category yet.</p>';
    if (io) root.querySelectorAll(".cr-tile:not(.is-in)").forEach((t) => io.observe(t));
  };
  // a picture that fails to load leaves the brand-colour panel and category icon, never a broken image
  root.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.closest(".cr-tile")?.classList.add("no-img"); }, true);
  // gentle 3D tilt under a mouse pointer (not on touch, not with reduced motion)
  if (!still && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    let raf = 0; let cur = null; let pt = null;
    const apply = () => {
      raf = 0; if (!cur || !pt) return;
      const r = cur.getBoundingClientRect();
      const x = (pt.x - r.left) / r.width - 0.5; const y = (pt.y - r.top) / r.height - 0.5;
      cur.style.setProperty("--ry", `${(x * 12).toFixed(2)}deg`); cur.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
    };
    const reset = (t) => { t?.style.removeProperty("--rx"); t?.style.removeProperty("--ry"); t?.classList.remove("is-tilt"); };
    root.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const t = e.target.closest(".cr-tile.is-in");
      if (t !== cur) { reset(cur); cur = t; cur?.classList.add("is-tilt"); }
      pt = { x: e.clientX, y: e.clientY }; if (cur && !raf) raf = requestAnimationFrame(apply);
    });
    root.addEventListener("pointerleave", () => { reset(cur); cur = null; });
  }
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-more]")) { expanded = true; render(); return; }
    const t = e.target.closest(".cr-tile"); if (!t) return;
    openId = openId === t.dataset.id ? null : t.dataset.id; render();
    root.querySelector(`.cr-tile[data-id="${CSS.escape(t.dataset.id)}"]`)?.focus({ preventScroll: true });
  });
  if (tabsRoot) {
    const present = ORDER.filter((cat) => carriers.some((c) => c.category === cat));
    tabsRoot.innerHTML = [["all", "All", carriers.length], ...present.map((c) => [c, CARRIER_CATEGORIES[c], carriers.filter((x) => x.category === c).length])]
      .map(([k, l, n]) => `<button type="button" class="cr-tab" data-filter="${k}" aria-pressed="${k === filter}">${esc(l)}<span class="n">${n}</span></button>`).join("");
    tabsRoot.addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]"); if (!b) return;
      filter = b.dataset.filter; openId = null;
      tabsRoot.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.filter === filter))); render();
    });
  }
  small.addEventListener?.("change", render);
  render();
}
