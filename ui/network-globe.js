// Homepage "Worldwide freight connections": a slowly turning dotted globe (Canvas 2D, no dependency) with glowing
// arcs between international freight hubs and rotating route cards. The routes come from ui/network-routes.js and are a
// network VISUALISATION: no tracking codes, statuses, transport modes, counts or "live" claims are shown, and nothing
// here reads shipment data. Real published shipments stay in the separate activity section (ui/globe/command-center.js).
//
// Behaviour: one route is swapped every few seconds by a shuffle-bag scheduler (no fixed cycle, regions mixed); the
// globe eases towards the newest route. Animation pauses offscreen, in a background tab and with the Pause button.
// Reduced motion: a still globe and a "Show other routes" button. No canvas / no geography: cards only.
import { loadCountries, prefersReducedMotion } from "./globe/geo.js";
import { hubById, distanceKm, createScheduler } from "./network-routes.js";

const RAD = Math.PI / 180;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const key = ([a, b]) => `${a}>${b}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------- geometry ----------
const vec = (lat, lng) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
function slerp(a, b, t) {
  const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1); const w = Math.acos(d);
  if (w < 1e-6) return a.slice();
  const s = Math.sin(w); const k1 = Math.sin((1 - t) * w) / s; const k2 = Math.sin(t * w) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}
const toLatLng = (v) => ({ lat: Math.asin(clamp(v[2], -1, 1)) / RAD, lng: Math.atan2(v[1], v[0]) / RAD });

/** Arc points as unit-sphere vectors lifted by a height profile (longer routes rise higher). */
function arcPoints(a, b, steps = 64) {
  const va = vec(a.lat, a.lng); const vb = vec(b.lat, b.lng);
  const angle = Math.acos(clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1));
  const lift = 0.04 + 0.22 * (angle / Math.PI);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; const v = slerp(va, vb, t); const h = 1 + lift * Math.sin(Math.PI * t);
    pts.push([v[0] * h, v[1] * h, v[2] * h]);
  }
  return pts;
}

// land dots: Fibonacci sphere sampled against Natural Earth 110m polygons (bbox prefilter, ray casting), cached
let landPromise = null;
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function landDots(count) {
  if (!landPromise) {
    landPromise = loadCountries().then((fc) => new Promise((resolve) => {
      const polys = [];
      for (const f of fc.features) {
        const list = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
        for (const p of list) {
          let minX = 180, maxX = -180, minY = 90, maxY = -90;
          for (const [x, y] of p[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
          polys.push({ p, minX, maxX, minY, maxY });
        }
      }
      const out = []; const golden = Math.PI * (3 - Math.sqrt(5)); let i = 0;
      // idle slices, but with a deadline so busy pages (or slow devices) still finish the dots
      const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 120 }) : (fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 1);
      const chunk = (deadline) => {
        const stop = performance.now() + Math.max(4, deadline.timeRemaining?.() ?? 8);
        for (; i < count && performance.now() < stop; i++) {
          const z = 1 - (2 * i + 1) / count; const lat = Math.asin(z) / RAD; const lng = ((((i * golden) / RAD) % 360) + 540) % 360 - 180;
          if (lat < -60) continue;
          for (const q of polys) {
            if (lng < q.minX || lng > q.maxX || lat < q.minY || lat > q.maxY) continue;
            if (pointInRing(lng, lat, q.p[0]) && !q.p.slice(1).some((h) => pointInRing(lng, lat, h))) { out.push(vec(lat, lng)); break; }
          }
        }
        if (i < count) idle(chunk); else resolve(out);
      };
      idle(chunk);
    }));
    landPromise.catch(() => { landPromise = null; });
  }
  return landPromise;
}

// ---------- palette (CSS custom properties on the section, so both themes are defined in CSS) ----------
function readPalette(el) {
  const cs = getComputedStyle(el); const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    sea1: v("--ng-sea-1", "#10275a"), sea2: v("--ng-sea-2", "#050b1f"), rim: v("--ng-rim", "rgba(56,189,248,.55)"),
    dot: v("--ng-dot", "#7fb4ff"), arc: v("--ng-arc", "#38bdf8"), glow: v("--ng-glow", "rgba(56,189,248,.28)"),
    marker: v("--ng-marker", "#fbbf24"), city: v("--ng-city", "#e2e8f0"), halo: v("--ng-halo", "#050b1f")
  };
}

/**
 * Mounts the network on `root` (the #freightNetwork figure). Returns { pause, play, destroy, visible() } for tests.
 */
export function mountNetworkGlobe(root, { random = Math.random } = {}) {
  const canvas = root.querySelector("canvas"); const cards = root.querySelector("[data-slot='ngcards']");
  const srList = root.querySelector("[data-slot='nglist']"); const toggle = root.querySelector("[data-ng-toggle]");
  const next = root.querySelector("[data-ng-next]");
  const reduced = prefersReducedMotion();
  const scheduler = createScheduler({ random });
  const interval = Number(window.HX_NETWORK_INTERVAL_MS) || 6500;
  const ctx = canvas?.getContext?.("2d");
  const narrow = () => root.clientWidth < 720;
  const maxRoutes = () => (narrow() ? 2 : 3);

  let palette = readPalette(root); let dots = null; let size = 0; let dpr = 1;
  let view = { lng: 10, lat: 12 }; let target = { lng: 10, lat: 12 };
  let routes = []; // { conn, key, a, b, pts, born, dying }
  let clock = 0; let last = 0; let nextSwap = interval; let raf = 0;
  let onscreen = false; let userPaused = false; let hot = null; let destroyed = false;

  root.dataset.state = "loading";

  // ----- route set -----
  function makeRoute(conn) {
    const a = hubById.get(conn[0]); const b = hubById.get(conn[1]);
    return { conn, key: key(conn), a, b, pts: arcPoints(a, b), born: clock, dying: null };
  }
  function aim(route) {
    const mid = toLatLng(slerp(vec(route.a.lat, route.a.lng), vec(route.b.lat, route.b.lng), 0.5));
    target = { lng: mid.lng, lat: clamp(mid.lat * 0.6, -25, 35) };
  }
  function addRoute() {
    const r = makeRoute(scheduler.next(routes.filter((x) => !x.dying).map((x) => x.conn)));
    routes.push(r); aim(r); renderCards();
  }
  function swap() {
    const shown = routes.filter((r) => !r.dying);
    if (shown.length >= maxRoutes()) shown[0].dying = clock;
    addRoute();
  }
  function fill() { while (routes.filter((r) => !r.dying).length < maxRoutes()) addRoute(); }

  // ----- cards -----
  function cardHtml(r) {
    const km = distanceKm(r.a, r.b).toLocaleString("en-US");
    return `<li class="ng-card" data-key="${esc(r.key)}"><span class="ng-kind">Freight connection</span>
      <div class="ng-route"><span class="ng-city"><small>Origin</small><strong>${esc(r.a.city)}</strong><span>${esc(r.a.country)}</span></span>
      <i aria-hidden="true"></i><span class="ng-city"><small>Destination</small><strong>${esc(r.b.city)}</strong><span>${esc(r.b.country)}</span></span></div>
      <span class="ng-dist">${km} km apart · ${esc(r.a.region === r.b.region ? r.a.region : `${r.a.region} – ${r.b.region}`)}</span></li>`;
  }
  function renderCards() {
    if (!cards) return;
    const want = routes.filter((r) => !r.dying);
    const have = new Map([...cards.children].map((li) => [li.dataset.key, li]));
    for (const [k, li] of have) {
      if (!want.some((r) => r.key === k) && !li.classList.contains("is-out")) {
        li.classList.add("is-out"); setTimeout(() => li.remove(), reduced ? 0 : 520);
      }
    }
    for (const r of want) {
      if (have.has(r.key)) continue;
      cards.insertAdjacentHTML("beforeend", cardHtml(r));
      const li = cards.lastElementChild;
      if (!reduced) { li.classList.add("is-in"); requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove("is-in"))); }
      li.addEventListener("mouseenter", () => { hot = r.key; draw(); }); li.addEventListener("mouseleave", () => { hot = null; draw(); });
    }
    root.dataset.routes = want.map((r) => r.key).join(" ");
    if (srList) srList.innerHTML = want.map((r) => `<li>${esc(r.a.city)}, ${esc(r.a.country)} to ${esc(r.b.city)}, ${esc(r.b.country)}</li>`).join("");
  }

  // ----- drawing -----
  function resize() {
    if (!canvas) return;
    const w = canvas.parentElement.clientWidth; if (!w) return;
    dpr = Math.min(2, window.devicePixelRatio || 1); size = w;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr);
    canvas.style.height = `${w}px`;
    draw();
  }
  // rotate a unit-sphere (or lifted) vector into view space: x right, y up, z toward the viewer
  function project(p) {
    const l0 = view.lng * RAD; const p0 = view.lat * RAD;
    const cl = Math.cos(-l0), sl = Math.sin(-l0);
    const x1 = p[0] * cl - p[1] * sl; const y1 = p[0] * sl + p[1] * cl; const z1 = p[2];
    const cp = Math.cos(p0), sp = Math.sin(p0);
    // after the longitude turn the viewer looks along +x; tilt by latitude
    const depth = x1 * cp + z1 * sp; const up = -x1 * sp + z1 * cp;
    return [y1, up, depth];
  }
  function draw() {
    if (!ctx || !size) return;
    const R = size * 0.42; const cx = size / 2; const cy = size / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    // atmosphere
    const atm = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.22);
    atm.addColorStop(0, palette.rim); atm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.fill();
    // sphere
    const sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    sea.addColorStop(0, palette.sea1); sea.addColorStop(1, palette.sea2);
    ctx.fillStyle = sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // land dots, bucketed by depth so there are only a few fill calls
    if (dots) {
      ctx.fillStyle = palette.dot; const s = Math.max(1.4, size / 330);
      for (let b = 0; b < 4; b++) {
        ctx.globalAlpha = 0.32 + b * 0.22; ctx.beginPath();
        for (const d of dots) {
          const [x, y, z] = project(d); if (z <= 0) continue;
          if (Math.min(3, Math.floor(z * 4)) !== b) continue;
          ctx.rect(cx + x * R - s / 2, cy - y * R - s / 2, s, s);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // arcs
    for (const r of routes) drawRoute(r, R, cx, cy);
  }
  function visiblePoint(p, R, cx, cy) {
    const [x, y, z] = project(p);
    const hidden = z < 0 && x * x + y * y < 1; // behind the globe
    return { x: cx + x * R, y: cy - y * R, hidden };
  }
  function drawRoute(r, R, cx, cy) {
    const age = clock - r.born;
    const grow = reduced ? 1 : ease(clamp(age / 1600, 0, 1));
    const fade = r.dying == null ? 1 : 1 - clamp((clock - r.dying) / 700, 0, 1);
    if (fade <= 0) return;
    const n = Math.max(2, Math.round(r.pts.length * grow));
    const pts = r.pts.slice(0, n).map((p) => visiblePoint(p, R, cx, cy));
    const hotRoute = hot === r.key;
    const stroke = (width, color, alpha) => {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.globalAlpha = alpha * fade; ctx.beginPath();
      let pen = false;
      for (const p of pts) { if (p.hidden) { pen = false; continue; } if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    };
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    stroke(hotRoute ? 9 : 7, palette.glow, 0.7); stroke(hotRoute ? 3 : 2, palette.arc, 1);
    // endpoints
    for (const [hub, show] of [[r.a, true], [r.b, grow >= 1]]) {
      if (!show) continue;
      const p = visiblePoint(vec(hub.lat, hub.lng), R, cx, cy); if (p.hidden) continue;
      ctx.globalAlpha = fade; ctx.fillStyle = palette.marker; ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35 * fade; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      if (size >= 260) {
        ctx.globalAlpha = fade; ctx.font = `600 ${size < 480 ? 11 : 12}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.lineWidth = 3; ctx.strokeStyle = palette.halo; ctx.fillStyle = palette.city;
        ctx.strokeText(hub.city, p.x + 8, p.y - 6); ctx.fillText(hub.city, p.x + 8, p.y - 6);
      }
    }
    // a small marker gliding along the finished arc
    if (!reduced && grow >= 1) {
      const t = ((age - 1600) / 4200) % 1; const i = Math.floor(t * (r.pts.length - 1));
      const p = visiblePoint(r.pts[i], R, cx, cy);
      if (!p.hidden) {
        ctx.globalAlpha = 0.35 * fade; ctx.fillStyle = palette.arc; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = fade; ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ----- clock (only advances while running, so swaps pause with the animation) -----
  const running = () => onscreen && !userPaused && !document.hidden && !destroyed;
  function frame(now) {
    raf = 0;
    if (!running()) return;
    const dt = last ? Math.min(64, now - last) : 16; last = now; clock += dt;
    if (clock >= nextSwap) { swap(); nextSwap = clock + interval * (0.85 + random() * 0.3); }
    routes = routes.filter((r) => r.dying == null || clock - r.dying < 720);
    // ease the view towards the newest route, with the shortest way round
    let dl = ((target.lng - view.lng + 540) % 360) - 180;
    view.lng += dl * Math.min(1, dt / 1400) + dt * 0.0015; view.lat += (target.lat - view.lat) * Math.min(1, dt / 1600);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && running() && !reduced) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function setPaused(v) {
    userPaused = v;
    if (toggle) { toggle.setAttribute("aria-pressed", String(v)); toggle.querySelector("span").textContent = v ? "Play" : "Pause"; toggle.dataset.paused = String(v); }
    if (v) stop(); else kick();
  }

  // ----- start -----
  fill();
  if (routes[routes.length - 1]) { aim(routes[routes.length - 1]); view = { ...target }; }
  if (!ctx) { root.dataset.state = "fallback"; root.classList.add("no-globe"); }
  else {
    resize();
    root.dataset.state = reduced ? "static" : "ready"; // routes and cards work at once; the land dots fade in when sampled
    landDots(narrow() ? 5200 : 8200).then((d) => { dots = d; root.dataset.land = "ready"; draw(); })
      .catch(() => { root.classList.add("no-land"); draw(); });
  }
  if (reduced) { if (toggle) toggle.hidden = true; if (next) next.hidden = false; }
  else if (next) next.hidden = true;

  toggle?.addEventListener("click", () => setPaused(!userPaused));
  next?.addEventListener("click", () => { for (const r of routes) r.dying = clock - 10000; routes = []; fill(); view = { ...target }; renderCards(); draw(); });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null; ro?.observe(root);
  const io = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((e) => { onscreen = e.some((x) => x.isIntersecting); if (onscreen) kick(); else stop(); }, { rootMargin: "80px" })
    : null;
  if (io) io.observe(root); else { onscreen = true; kick(); }
  const onVis = () => (document.hidden ? stop() : kick());
  const onTheme = () => { palette = readPalette(root); draw(); };
  document.addEventListener("visibilitychange", onVis); document.addEventListener("hx-theme", onTheme);

  return {
    pause: () => setPaused(true), play: () => setPaused(false),
    visible: () => routes.filter((r) => !r.dying).map((r) => r.key),
    destroy() { destroyed = true; stop(); ro?.disconnect(); io?.disconnect(); document.removeEventListener("visibilitychange", onVis); document.removeEventListener("hx-theme", onTheme); }
  };
}

