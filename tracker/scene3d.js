// Explorable 3D model for a tracking stage (warehouse, vessel, aircraft, delivery van). Loaded only when a visitor
// taps "Explore in 3D"; Three.js itself comes from the CDN on that first tap. The models are built in code and show a
// TYPICAL place or vehicle for the recorded stage: they carry no shipment data, names, places or positions.
//
// Controls: drag to rotate, pinch / wheel to zoom, arrow keys and +/- on the focused canvas, Reset. The canvas only
// captures touches while it is open, so the page scrolls normally otherwise. Rendering stops when the canvas is
// off-screen or the tab is hidden, and dispose() frees the GPU context.
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const CAMERA = {
  warehouse: { radius: 74, yaw: -0.62, pitch: 0.42, target: [2, 4, 4], min: 34, max: 120 },
  ship: { radius: 88, yaw: 0.78, pitch: 0.38, target: [0, 4, 0], min: 40, max: 150 },
  plane: { radius: 70, yaw: -0.85, pitch: 0.34, target: [0, 4, 0], min: 32, max: 120 },
  delivery: { radius: 34, yaw: -0.7, pitch: 0.35, target: [0, 2, 0], min: 16, max: 60 }
};

function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export async function createViewer(container, model, { reducedMotion = false } = {}) {
  if (!CAMERA[model]) throw new Error("unknown model");
  if (!webglAvailable()) throw new Error("webgl unavailable");
  const THREE = await import(/* @vite-ignore */ THREE_URL);
  const dark = document.documentElement.dataset.theme !== "light";

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.className = "hx-3d-canvas"; canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Interactive 3D model of a typical ${model === "ship" ? "container vessel" : model === "plane" ? "cargo aircraft" : model === "delivery" ? "delivery van" : "distribution warehouse"}. Drag or use the arrow keys to rotate, plus and minus to zoom.`);
  container.prepend(canvas);

  const scene = new THREE.Scene();
  // models are always lit like daytime so they read clearly; only the sky follows the site theme
  const sky = new THREE.Color(dark ? "#1b2f5c" : "#dceaf8");
  scene.background = sky; scene.fog = new THREE.Fog(sky, 140, 320);
  const camera = new THREE.PerspectiveCamera(38, 2, 0.5, 900);

  scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f99", 1.25));
  const sun = new THREE.DirectionalLight("#fff4e0", 2.7);
  sun.position.set(60, 90, 40); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 260 });
  scene.add(sun);

  const tick = build(THREE, scene, model, dark); // returns an optional per-frame animation function

  // ---------- orbit controls (no addon) ----------
  const cfg = CAMERA[model]; const target = new THREE.Vector3(...cfg.target);
  const view = { radius: cfg.radius, yaw: cfg.yaw, pitch: cfg.pitch };
  const place = () => {
    view.pitch = Math.min(1.25, Math.max(0.08, view.pitch)); view.radius = Math.min(cfg.max, Math.max(cfg.min, view.radius));
    const c = Math.cos(view.pitch);
    camera.position.set(target.x + view.radius * c * Math.sin(view.yaw), target.y + view.radius * Math.sin(view.pitch), target.z + view.radius * c * Math.cos(view.yaw));
    camera.lookAt(target); request();
  };
  const pointers = new Map(); let pinch = 0;
  const onDown = (e) => { canvas.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) pinch = spread(); };
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    if (pointers.size === 1) { view.yaw -= (e.clientX - p.x) * 0.008; view.pitch += (e.clientY - p.y) * 0.006; }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) { const d = spread(); view.radius *= pinch / d; pinch = d; }
    place();
  };
  const onUp = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
  const onWheel = (e) => { e.preventDefault(); view.radius *= Math.exp(e.deltaY * 0.0012); place(); };
  const onKey = (e) => {
    const k = e.key; let used = true;
    if (k === "ArrowLeft") view.yaw += 0.12; else if (k === "ArrowRight") view.yaw -= 0.12;
    else if (k === "ArrowUp") view.pitch += 0.08; else if (k === "ArrowDown") view.pitch -= 0.08;
    else if (k === "+" || k === "=") view.radius *= 0.88; else if (k === "-" || k === "_") view.radius *= 1.12;
    else if (k === "0") Object.assign(view, { radius: cfg.radius, yaw: cfg.yaw, pitch: cfg.pitch }); else used = false;
    if (used) { e.preventDefault(); place(); }
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false }); canvas.addEventListener("keydown", onKey);

  // ---------- size, visibility and the render loop ----------
  let raf = 0; let visible = true; let disposed = false; const clock = new THREE.Clock();
  const resize = () => { const w = container.clientWidth || 600; const h = container.clientHeight || 240; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); request(); };
  const animate = !reducedMotion && typeof tick === "function";
  const frame = () => { raf = 0; if (disposed) return; if (animate) tick(clock.getElapsedTime()); renderer.render(scene, camera); if (animate && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  function request() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null; ro?.observe(container);
  const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) request(); }) : null; io?.observe(container);
  const onVis = () => { if (!document.hidden) request(); }; document.addEventListener("visibilitychange", onVis);
  resize(); place();

  return {
    get view() { return { ...view }; },
    reset() { Object.assign(view, { radius: cfg.radius, yaw: cfg.yaw, pitch: cfg.pitch }); place(); },
    dispose() {
      if (disposed) return; disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect(); io?.disconnect(); document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o) => { o.geometry?.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose()); });
      renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    }
  };
}

// ---------- models (metres, y up) ----------
function build(THREE, scene, model, dark) {
  const mats = new Map();
  const mat = (color, o = {}) => { const k = color + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...o })); return mats.get(k); };
  const add = (geo, m, x, y, z, parent = scene, cast = true) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const box = (w, h, d, m, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, parent);
  const cyl = (r, h, m, x, y, z, parent, seg = 16) => add(new THREE.CylinderGeometry(r, r, h, seg), m, x, y + h / 2, z, parent);
  const ground = (size, color) => { const g = add(new THREE.PlaneGeometry(size, size), mat(color, { roughness: 0.95 }), 0, 0, 0, scene, false); g.rotation.x = -Math.PI / 2; return g; };
  const CONTAINER = ["#1d4ed8", "#c2410c", "#0f766e", "#b91c1c", "#475569", "#a16207", "#1e3a8a"];

  const truck = (x, z, rot = 0, trailerColor = "#f1f5f9") => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
    box(12, 3.6, 2.5, mat(trailerColor), 0, 1.1, 0, g);
    box(3, 3, 2.5, mat("#e2e8f0"), 7.6, 0.9, 0, g); box(0.1, 1.2, 2.2, mat("#1e293b", { roughness: 0.2 }), 9.12, 2.3, 0, g);
    for (const wx of [-4.5, -3.2, 3, 7.8]) for (const s of [-1.1, 1.1]) { const w = cyl(0.55, 0.4, mat("#111827"), wx, 0, s, g); w.rotation.x = Math.PI / 2; w.position.y = 0.55; }
    return g;
  };

  if (model === "warehouse") {
    ground(260, "#7c8592");
    box(120, 0.05, 14, mat("#5f8f4e", { roughness: 1 }), 0, 0, 34, scene);
    const hall = new THREE.Group(); scene.add(hall);
    box(46, 11, 26, mat("#3b4252", { roughness: 0.6 }), 0, 0, 0, hall);
    box(46.4, 0.6, 26.4, mat("#9ca3af"), 0, 11, 0, hall);
    box(46.2, 1.2, 0.3, mat("#64748b"), 0, 8.6, 13.1, hall); // light band
    box(47, 1.3, 4, mat("#94a3b8"), 0, 0, 14.6, hall);        // dock platform
    for (let i = 0; i < 6; i++) {
      const x = -19 + i * 6.4;
      box(4.2, 4.6, 0.6, mat("#1f2937"), x, 1.2, 13.3, hall);               // seal
      const door = box(3.4, 3.8, 0.2, mat("#e5e7eb", { roughness: 0.5 }), x, 1.4, 13.65, hall);
      for (let j = 1; j < 6; j++) box(3.4, 0.05, 0.05, mat("#9ca3af"), x, 1.4 + j * 0.63, 13.78, hall);
      cyl(0.18, 1.2, mat("#facc15"), x - 2.4, 0, 17, hall); cyl(0.18, 1.2, mat("#facc15"), x + 2.4, 0, 17, hall);
      door.userData.bay = i;
    }
    // glass office block
    const glass = mat("#7fb3df", { roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.85, emissive: "#3a3016", emissiveIntensity: dark ? 0.5 : 0.15 });
    box(12, 12.5, 10, glass, 29, 0, 8, scene);
    box(12.4, 0.5, 10.4, mat("#e5e7eb"), 29, 12.5, 8, scene);
    for (let k = 0; k < 4; k++) box(12.1, 0.18, 10.1, mat("#e5e7eb"), 29, k * 3.2 + 0.2, 8, scene);
    for (let k = -2; k <= 2; k++) box(0.18, 12.5, 10.1, mat("#e5e7eb"), 29 + k * 2.9, 0, 8, scene);
    truck(-12.6, 22, -Math.PI / 2); truck(0.2, 22, -Math.PI / 2, "#dbeafe");
    // container yard and pallets
    for (let c = 0; c < 4; c++) for (let h = 0; h < 1 + (c % 3); h++) box(6, 2.6, 2.4, mat(CONTAINER[(c + h * 2) % CONTAINER.length], { roughness: 0.55 }), -40, h * 2.6, -8 + c * 2.8, scene);
    for (let c = 0; c < 3; c++) box(6, 2.6, 2.4, mat(CONTAINER[(c + 3) % CONTAINER.length], { roughness: 0.55 }), -33, 0, -6 + c * 2.8, scene);
    for (let p = 0; p < 5; p++) { box(1.2, 0.15, 1.0, mat("#a16207"), 18 + p * 1.6, 0, 18, scene); box(1.0, 0.8, 0.8, mat("#c08a52"), 18 + p * 1.6, 0.15, 18, scene); }
    // forklift
    const fl = new THREE.Group(); fl.position.set(12, 0, 19); fl.rotation.y = 0.5; scene.add(fl);
    box(1.4, 1.2, 2.2, mat("#ea580c"), 0, 0.3, 0, fl); box(1.2, 0.1, 1.2, mat("#111827"), 0, 1.9, -0.2, fl);
    box(0.1, 2.4, 0.1, mat("#1f2937"), -0.5, 0.3, 1.2, fl); box(0.1, 2.4, 0.1, mat("#1f2937"), 0.5, 0.3, 1.2, fl);
    box(0.15, 0.06, 1.2, mat("#374151"), -0.35, 0.2, 1.8, fl); box(0.15, 0.06, 1.2, mat("#374151"), 0.35, 0.2, 1.8, fl);
    return null;
  }

  if (model === "ship") {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 60, 60), mat("#1d6fa5", { roughness: 0.35, metalness: 0.15 }));
    water.rotation.x = -Math.PI / 2; water.receiveShadow = true; scene.add(water);
    const pos = water.geometry.attributes.position;
    const ship = new THREE.Group(); scene.add(ship);
    const hullShape = new THREE.Shape(); hullShape.moveTo(-34, -6.5); hullShape.lineTo(24, -6.5); hullShape.quadraticCurveTo(36, -2, 38, 0); hullShape.quadraticCurveTo(36, 2, 24, 6.5); hullShape.lineTo(-34, 6.5); hullShape.lineTo(-34, -6.5);
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 7, bevelEnabled: false }), mat("#1f2a44", { roughness: 0.5 }));
    hull.rotation.x = -Math.PI / 2; hull.position.y = -2; hull.castShadow = true; hull.receiveShadow = true; ship.add(hull);
    const band = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 1.2, bevelEnabled: false }), mat("#8b1d1d"));
    band.rotation.x = -Math.PI / 2; band.position.y = -2.4; band.scale.set(1.002, 1.01, 1); ship.add(band);
    // containers: one instanced mesh with per-container colours
    const geo = new THREE.BoxGeometry(5.8, 2.5, 2.35);
    const slots = []; for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) { const h = 2 + ((i * 7 + j * 3) % 4); for (let k = 0; k < h; k++) slots.push([-20 + i * 6.1, 6.3 + k * 2.55, -4.2 + j * 2.8]); }
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.55 }), slots.length);
    const m4 = new THREE.Matrix4(); const col = new THREE.Color();
    slots.forEach((p, n) => { m4.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(n, m4); inst.setColorAt(n, col.set(CONTAINER[(n * 5) % CONTAINER.length])); });
    inst.castShadow = true; inst.receiveShadow = true; ship.add(inst);
    box(7, 13, 11, mat("#e5e7eb"), -29, 5, 0, ship); box(7.4, 1.2, 14, mat("#cbd5e1"), -29, 18, 0, ship);
    box(7.05, 1, 11.05, mat("#0f172a", { roughness: 0.2 }), -29, 16, 0, ship);
    cyl(1.1, 5, mat("#c2410c"), -31.5, 19.2, 0, ship);
    const foam = new THREE.Mesh(new THREE.RingGeometry(9, 14, 32, 1, -0.9, 1.8), new THREE.MeshBasicMaterial({ color: "#e0f2fe", transparent: true, opacity: 0.35 }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(30, 0.1, 0); scene.add(foam);
    return (t) => {
      ship.position.y = Math.sin(t * 0.8) * 0.25; ship.rotation.z = Math.sin(t * 0.6) * 0.012; ship.rotation.x = Math.sin(t * 0.5) * 0.008;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const y = pos.getY(i); pos.setZ(i, Math.sin(x * 0.06 + t * 1.1) * 0.35 + Math.cos(y * 0.05 + t * 0.8) * 0.3); }
      pos.needsUpdate = true;
    };
  }

  if (model === "plane") {
    ground(320, "#9aa3ae");
    for (let i = -6; i <= 6; i++) box(0.3, 0.02, 6, mat("#facc15", { roughness: 1 }), i * 9, 0, 26, scene, false);
    const plane = new THREE.Group(); plane.position.y = 3.2; scene.add(plane);
    const white = mat("#eef2f7", { roughness: 0.4, metalness: 0.1 });
    const fus = add(new THREE.CylinderGeometry(2.6, 2.6, 40, 24), white, 0, 3, 0, plane); fus.rotation.z = Math.PI / 2;
    const nose = add(new THREE.SphereGeometry(2.6, 24, 16), white, 20, 3, 0, plane); nose.scale.set(1.6, 1, 1);
    const tail = add(new THREE.ConeGeometry(2.6, 9, 24), white, -24.5, 3.6, 0, plane); tail.rotation.z = Math.PI / 2;
    const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(-7, 20); wingShape.lineTo(-10, 20); wingShape.lineTo(-7, 0); wingShape.lineTo(0, 0);
    for (const s of [1, -1]) {
      const w = add(new THREE.ExtrudeGeometry(wingShape, { depth: 0.5, bevelEnabled: false }), white, 2, 2.2, 0, plane);
      w.rotation.x = s * Math.PI / 2; w.position.z = 0;
      const eng = add(new THREE.CylinderGeometry(1.3, 1.1, 4.5, 20), mat("#cbd5e1", { metalness: 0.4, roughness: 0.3 }), -1.5, 0.6, s * 8, plane); eng.rotation.z = Math.PI / 2;
      const hs = add(new THREE.ExtrudeGeometry(wingShape, { depth: 0.3, bevelEnabled: false }), white, -21, 4, 0, plane); hs.scale.set(0.45, 0.4, 1); hs.rotation.x = s * Math.PI / 2;
    }
    const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-6, 9); fin.lineTo(-9, 9); fin.lineTo(-7, 0); fin.lineTo(0, 0);
    add(new THREE.ExtrudeGeometry(fin, { depth: 0.4, bevelEnabled: false }), mat("#1d4ed8", { roughness: 0.5 }), -21, 5.2, -0.2, plane);
    box(26, 0.35, 0.05, mat("#0f172a", { roughness: 0.2 }), 1, 3.9, 2.58, plane);                 // window line
    const door = box(5, 3.2, 0.25, mat("#dbe3ee"), 9, 1.4, 2.7, plane); door.rotation.x = -0.9;   // open cargo door
    for (const [x, z] of [[-6, 0], [6, 0]]) { const g = cyl(0.5, 0.6, mat("#111827"), x, -3.2, z, plane); g.rotation.x = Math.PI / 2; }
    for (let p = 0; p < 6; p++) { box(2.4, 0.2, 2.4, mat("#64748b"), 6 + p * 3.2, 0, 11, scene); box(2.2, 1.6, 2.2, mat("#c08a52"), 6 + p * 3.2, 0.2, 11, scene); }
    box(5, 1.2, 2.6, mat("#facc15"), 9, 0, 6.5, scene); // loader
    return (t) => { plane.position.y = 3.2 + Math.sin(t * 0.7) * 0.02; };
  }

  // delivery: a van at a house on a quiet street
  ground(140, "#7f9a6a");
  box(80, 0.04, 8, mat("#4b5563", { roughness: 1 }), 0, 0, 10, scene, false);
  box(10, 6, 8, mat("#e7e1d6"), 0, 0, -4, scene);
  const roofShape = new THREE.Shape(); roofShape.moveTo(-5.6, 0); roofShape.lineTo(0, 3.6); roofShape.lineTo(5.6, 0); roofShape.lineTo(-5.6, 0);
  add(new THREE.ExtrudeGeometry(roofShape, { depth: 8.8, bevelEnabled: false }), mat("#7f1d1d", { roughness: 0.8 }), 0, 6, -8.4, scene);
  box(1.6, 2.6, 0.2, mat("#1e3a8a"), 0, 0, 0.05, scene);
  for (const x of [-3, 3]) box(1.8, 1.4, 0.15, mat("#9cc3e6", { roughness: 0.1, metalness: 0.3 }), x, 2.6, 0.05, scene);
  const van = new THREE.Group(); van.position.set(-2, 0, 10); scene.add(van);
  box(5.2, 2.6, 2.3, mat("#f8fafc", { roughness: 0.45 }), -0.6, 0.5, 0, van);
  box(1.8, 1.9, 2.25, mat("#f8fafc", { roughness: 0.45 }), 2.8, 0.5, 0, van);
  box(0.08, 1, 2.0, mat("#0f172a", { roughness: 0.2 }), 3.72, 1.5, 0, van);
  box(5.2, 0.3, 2.32, mat("#2563eb"), -0.6, 1.6, 0, van);
  for (const wx of [-2.2, 2.6]) for (const s of [-1.1, 1.1]) { const w = cyl(0.42, 0.3, mat("#111827"), wx, 0, s, van); w.rotation.x = Math.PI / 2; w.position.y = 0.42; }
  box(0.7, 0.5, 0.6, mat("#c08a52"), 1.2, 0, 2.2, scene);
  return null;
}
