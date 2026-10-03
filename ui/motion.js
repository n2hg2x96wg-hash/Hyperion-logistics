// Scroll-driven entrance motion for Hyperion pages (client and admin).
//
// Usage: add `data-reveal` to an element (optionally `data-reveal="fade"` for opacity only, e.g. maps), and
// `data-reveal-stagger` to a parent to cascade its revealed children. Elements added later (tracking results,
// admin tables) are picked up automatically.
//
// Performance: one IntersectionObserver, opacity/transform transitions only (compositor-friendly), each element
// animates once and is then unobserved. No scroll listeners, no animation loops.
// Accessibility: prefers-reduced-motion => everything is shown immediately with no movement.
// Without JavaScript nothing is hidden (the hiding CSS only applies under html.hx-motion).

const SELECTOR = "[data-reveal]";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initMotion() {
  if (window.__hxMotion) return window.__hxMotion;
  const html = document.documentElement;
  const show = (el) => el.classList.add("is-visible");

  if (reduced() || typeof IntersectionObserver === "undefined") {
    html.classList.add("hx-motion-off");
    const showAll = (root) => root.querySelectorAll?.(SELECTOR).forEach(show);
    showAll(document);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches(SELECTOR)) show(n); showAll(n); } }))) : null;
    mo?.observe(document.body, { childList: true, subtree: true });
    return (window.__hxMotion = { scan: showAll });
  }

  html.classList.add("hx-motion");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      show(e.target); io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });

  const prepare = (el) => {
    if (el.__hxRevealed) return;
    el.__hxRevealed = true;
    const group = el.parentElement?.closest("[data-reveal-stagger]");
    if (group) {
      const idx = [...group.querySelectorAll(":scope > [data-reveal], :scope > * > [data-reveal]")].indexOf(el);
      if (idx > 0) el.style.setProperty("--reveal-i", String(Math.min(idx, 8)));
    }
    io.observe(el);
  };
  const scan = (root) => { if (root.nodeType !== 1 && root !== document) return; if (root.matches?.(SELECTOR)) prepare(root); root.querySelectorAll(SELECTOR).forEach(prepare); };
  scan(document);
  const mo = new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n)); });
  mo.observe(document.body, { childList: true, subtree: true });

  // Navigation polish: a sentinel at the top toggles a "scrolled" class (no scroll listeners).
  const nav = document.querySelector("[data-scroll-nav]");
  if (nav) {
    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:24px;pointer-events:none;";
    document.body.prepend(sentinel);
    new IntersectionObserver(([e]) => nav.classList.toggle("is-scrolled", !e.isIntersecting)).observe(sentinel);
  }
  return (window.__hxMotion = { scan });
}

initMotion();
