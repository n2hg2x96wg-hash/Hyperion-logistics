// Public carrier directory. Data: GET /api/public?view=carriers (honest integration status computed on the
// server), falling back to the built-in catalogue if the API is unreachable. Wordmark tiles by default; an
// https logo image is used only when an approved logo URL has been configured for that carrier.
import { CARRIERS, CARRIER_CATEGORIES, carrierCategory, carrierLogoUrl, carrierIntegration } from "../shared/carriers.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORDER = ["express", "ocean", "regional", "custom"];

function fallback() {
  return CARRIERS.map((c) => ({ id: c.id, name: c.name, category: carrierCategory(c), categoryLabel: CARRIER_CATEGORIES[carrierCategory(c)], custom: c.type === "custom",
    brandColor: c.brandColor, logoUrl: carrierLogoUrl(c), description: c.description, coverage: c.coverage, website: c.type === "custom" ? null : c.website || null,
    note: c.note, integration: carrierIntegration(c) }));
}

function card(c) {
  const mark = c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="${esc(c.name)} logo" loading="lazy" decoding="async">` : `<span class="wm">${esc(c.name)}</span>`;
  return `<article class="cr-card" data-category="${esc(c.category)}">
    <div class="cr-mark" style="--brand:${esc(/^#[0-9a-f]{3,6}$/i.test(c.brandColor || "") ? c.brandColor : "#64748b")}">${mark}</div>
    <div class="cr-meta">${esc(c.categoryLabel)}</div>
    ${c.description ? `<p class="cr-desc">${esc(c.description)}</p>` : ""}
    ${c.coverage ? `<p class="cr-cov">Coverage: ${esc(c.coverage)}</p>` : ""}
    ${c.custom && c.note ? `<p class="cr-cov">${esc(c.note)}</p>` : ""}
    <div class="cr-foot"><span class="cr-int ${esc(c.integration?.status)}">${esc(c.integration?.label || "Manual updates by Hyperion")}</span>
      ${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">Official site ↗</a>` : ""}</div>
  </article>`;
}

export async function mountCarrierDirectory(root, tabsRoot) {
  let carriers;
  try {
    const r = await fetch("/api/public?view=carriers", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    carriers = (await r.json()).carriers;
  } catch { carriers = fallback(); }
  let filter = "all";
  const render = () => {
    const groups = ORDER.map((cat) => [cat, carriers.filter((c) => c.category === cat && (filter === "all" || filter === cat))]).filter(([, list]) => list.length);
    root.innerHTML = groups.map(([cat, list]) => `<div class="cr-group"><h3>${esc(CARRIER_CATEGORIES[cat])}</h3><div class="cr-grid">${list.map(card).join("")}</div></div>`).join("")
      || '<p class="cr-note">No carriers in this category yet.</p>';
  };
  if (tabsRoot) {
    const present = ORDER.filter((cat) => carriers.some((c) => c.category === cat));
    tabsRoot.innerHTML = [["all", "All carriers"], ...present.map((c) => [c, CARRIER_CATEGORIES[c]])]
      .map(([k, l]) => `<button type="button" class="cr-tab" data-filter="${k}" aria-pressed="${k === filter}">${esc(l)}</button>`).join("");
    tabsRoot.addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]"); if (!b) return;
      filter = b.dataset.filter; tabsRoot.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.filter === filter))); render();
    });
  }
  render();
}
