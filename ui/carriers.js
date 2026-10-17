// Public carrier directory. Data: GET /api/public?view=carriers (honest integration status computed on the
// server), falling back to the built-in catalogue if the API is unreachable. Compact wordmark tiles; tapping a
// tile opens its details (description, coverage, how updates reach Hyperion, official site). An https logo
// image is used only when an approved logo URL has been configured for that carrier.
import { CARRIERS, CARRIER_CATEGORIES, carrierCategory, carrierLogoUrl, carrierIntegration } from "../shared/carriers.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORDER = ["express", "air", "ocean", "regional", "custom"];
const COLLAPSED = 8; // tiles shown on small screens before "Show all"

function fallback() {
  return CARRIERS.map((c) => ({ id: c.id, name: c.name, category: carrierCategory(c), categoryLabel: CARRIER_CATEGORIES[carrierCategory(c)], custom: c.type === "custom",
    brandColor: c.brandColor, logoUrl: carrierLogoUrl(c), description: c.description, coverage: c.coverage, website: c.type === "custom" ? null : c.website || null,
    note: c.note, integration: carrierIntegration(c) }));
}

const brand = (c) => (/^#[0-9a-f]{3,6}$/i.test(c.brandColor || "") ? c.brandColor : "#64748b");
const intStatus = (c) => (["live", "link"].includes(c.integration?.status) ? c.integration.status : "manual");

function tile(c, open) {
  const mark = c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="${esc(c.name)}" loading="lazy" decoding="async">` : `<span class="wm">${esc(c.name)}</span>`;
  return `<button type="button" class="cr-tile" data-id="${esc(c.id)}" aria-expanded="${open}" aria-controls="cr-detail" style="--brand:${esc(brand(c))}">
    ${mark}<span class="meta"><span>${esc(CARRIER_CATEGORIES[c.category] || c.categoryLabel || "")}</span><i class="cr-dot ${intStatus(c)}" title="${esc(c.integration?.label || "Manual updates by Hyperion")}"></i></span></button>`;
}

function detail(c) {
  return `<div class="cr-detail" id="cr-detail" role="region" aria-label="${esc(c.name)} details">
    <h4>${esc(c.name)}</h4>
    ${c.description ? `<p>${esc(c.description)}</p>` : ""}
    ${c.coverage ? `<p>Coverage: ${esc(c.coverage)}</p>` : ""}
    ${c.custom && c.note ? `<p>${esc(c.note)}</p>` : ""}
    <div class="row"><span class="cr-int ${intStatus(c)}">${esc(c.integration?.label || "Manual updates by Hyperion")}</span>
      ${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">Official site ↗</a>` : ""}</div></div>`;
}

export async function mountCarrierDirectory(root, tabsRoot) {
  let carriers;
  try {
    const r = await fetch("/api/public?view=carriers", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    carriers = (await r.json()).carriers;
  } catch { carriers = fallback(); }
  carriers = carriers.slice().sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  let filter = "all"; let openId = null; let expanded = false;
  const small = window.matchMedia("(max-width: 720px)");

  const render = () => {
    const list = carriers.filter((c) => filter === "all" || c.category === filter);
    const limit = small.matches && !expanded && filter === "all" ? COLLAPSED : list.length;
    const shown = list.slice(0, limit);
    if (openId && !shown.some((c) => c.id === openId)) openId = null;
    const parts = [];
    for (const c of shown) {
      parts.push(tile(c, c.id === openId));
      if (c.id === openId) parts.push(detail(c));
    }
    root.innerHTML = list.length
      ? `<div class="cr-grid" style="grid-auto-flow: row dense">${parts.join("")}</div>${limit < list.length ? `<button type="button" class="btn btn-ghost cr-more" data-more>Show all ${list.length} carriers</button>` : ""}`
      : '<p class="cr-note">No carriers in this category yet.</p>';
  };
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
