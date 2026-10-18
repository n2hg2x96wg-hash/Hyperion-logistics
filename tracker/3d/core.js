// Shared stage for every 3D shipment scene: renderer, sky, image-based lighting, sun and shadows, orbit controls with
// damping, eased view presets, an on-demand render loop and an adaptive-quality check. Scene modules
// (tracker/3d/scenes/*.js) only describe what to build; THREE is passed in because it is loaded from the CDN at
// runtime, so nothing here imports "three" by name.
//
// Honesty: every scene is a TYPICAL place or vehicle for the recorded stage. Nothing here reads shipment data, and no
// object moves along a route or implies a live position.
import { createMaterials } from "./materials.js";
import { createKit } from "./kit.js";

const SKY_VS = "varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }";
const SKY_FS = `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float h = d.y;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.3)) : mix(horizon, ground, pow(clamp(-h * 4.0, 0.0, 1.0), 0.6));
  float s = max(dot(d, normalize(sunDir)), 0.0); c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.28);
  gl_FragColor = vec4(c, 1.0); }`;

// Two lighting moods that follow the site theme; both keep the models clearly lit.
const MOODS = {
  day: { top: "#3d7fd6", horizon: "#cfe3f5", ground: "#9aa6b2", sun: "#fff6e8", sunI: 3.0, hemiSky: "#dbeafe", hemiGround: "#7b8494", hemiI: 0.9, elev: 52, azim: 38, exposure: 1.0 },
  dusk: { top: "#24477f", horizon: "#cfd6e2", ground: "#4b5563", sun: "#ffd6a0", sunI: 2.6, hemiSky: "#9db8e8", hemiGround: "#5b4a3f", hemiI: 0.85, elev: 24, azim: 58, exposure: 1.05 }
};

export function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

/**
 * def: { label, extent, fog:[near,far], views:[{id,label,yaw,pitch,radius,target:[x,y,z]}], limits:{min,max,minPitch,maxPitch},
 *        build(ctx) -> optional tick(t, dt) }
 */
export function createStage(THREE, container, def, { reducedMotion = false, animate = true, perfCheck = true } = {}) {
  const dark = document.documentElement.dataset.theme !== "light";
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mood = MOODS[dark ? "dusk" : "day"];

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = mood.exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "hx-3d-canvas"; canvas.tabIndex = 0; canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Interactive 3D illustration: ${def.label}. Drag or use the arrow keys to rotate, plus and minus to zoom.`);
  container.prepend(canvas);

  // ---------- sky, fog and image-based lighting ----------
  const scene = new THREE.Scene();
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - mood.elev), THREE.MathUtils.degToRad(mood.azim));
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(mood.top) }, horizon: { value: new THREE.Color(mood.horizon) }, ground: { value: new THREE.Color(mood.ground) },
      sunDir: { value: sunDir }, sunColor: { value: new THREE.Color(mood.sun) } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat); sky.scale.setScalar(1500); sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
  const [fogNear, fogFar] = def.fog || [180, 900];
  scene.fog = new THREE.Fog(new THREE.Color(mood.horizon).lerp(new THREE.Color(mood.top), 0.15), fogNear, fogFar);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(sky.geometry, skyMat));
  const env = pmrem.fromScene(envScene, 0.02); scene.environment = env.texture;

  const hemi = new THREE.HemisphereLight(mood.hemiSky, mood.hemiGround, mood.hemiI); scene.add(hemi);
  const sun = new THREE.DirectionalLight(mood.sun, mood.sunI);
  const ext = def.extent || 80;
  sun.position.copy(sunDir).multiplyScalar(ext * 2.2); sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = Math.max(0.04, ext * 0.0009); // scaled to the shadow texel size (no acne bands)
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 5 });
  scene.add(sun); scene.add(sun.target);

  const camera = new THREE.PerspectiveCamera(36, 2, 0.3, 2500);
  const materials = createMaterials(THREE, renderer);
  const kit = createKit(THREE, materials);
  const ctx = { THREE, scene, renderer, camera, materials, kit, dark, coarse, sun, mood, reducedMotion };
  const tick = def.build(ctx);
  // every solid casts and receives shadows; ground planes and decals opt out of casting with userData.noShadow
  scene.traverse((o) => { if (o.isMesh && o !== sky) { o.castShadow = o.userData.noShadow !== true; o.receiveShadow = true; } });

  // ---------- camera: goal + damped current, view presets ----------
  const L = { min: 10, max: 200, minPitch: 0.06, maxPitch: 1.3, ...def.limits };
  const views = def.views;
  const toState = (v) => ({ yaw: v.yaw, pitch: v.pitch, radius: v.radius, tx: v.target[0], ty: v.target[1], tz: v.target[2] });
  const goal = toState(views[0]); const cur = { ...goal };
  const clampGoal = () => { goal.pitch = Math.min(L.maxPitch, Math.max(L.minPitch, goal.pitch)); goal.radius = Math.min(L.max, Math.max(L.min, goal.radius)); };
  const place = () => {
    const c = Math.cos(cur.pitch);
    camera.position.set(cur.tx + cur.radius * c * Math.sin(cur.yaw), cur.ty + cur.radius * Math.sin(cur.pitch), cur.tz + cur.radius * c * Math.cos(cur.yaw));
    camera.lookAt(cur.tx, cur.ty, cur.tz);
  };
  const settled = () => Object.keys(goal).every((k) => Math.abs(goal[k] - cur[k]) < (k === "radius" ? 0.01 : 0.0005));
  const go = (v) => { Object.assign(goal, toState(v)); request(); };

  // ---------- input: drag (touch: sideways only so vertical swipes scroll the page), pinch, focused wheel, keys ----------
  const pointers = new Map(); let pinch = 0;
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const onDown = (e) => { if (e.pointerType === "mouse") canvas.focus({ preventScroll: true }); canvas.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) pinch = spread(); };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    if (pointers.size === 1) { goal.yaw -= (e.clientX - p.x) * 0.0085; if (e.pointerType !== "touch") goal.pitch += (e.clientY - p.y) * 0.006; }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) { const d = spread(); goal.radius *= pinch / d; pinch = d; }
    clampGoal(); request();
  };
  const onUp = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
  const onWheel = (e) => { if (document.activeElement !== canvas) return; /* never hijack page scrolling */ e.preventDefault(); goal.radius *= Math.exp(e.deltaY * 0.0012); clampGoal(); request(); };
  const onKey = (e) => {
    const k = e.key; let used = true;
    if (k === "ArrowLeft") goal.yaw += 0.14; else if (k === "ArrowRight") goal.yaw -= 0.14;
    else if (k === "ArrowUp") goal.pitch += 0.08; else if (k === "ArrowDown") goal.pitch -= 0.08;
    else if (k === "+" || k === "=") goal.radius *= 0.86; else if (k === "-" || k === "_") goal.radius *= 1.16;
    else if (k === "0") Object.assign(goal, toState(views[0])); else used = false;
    if (used) { e.preventDefault(); clampGoal(); request(); }
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false }); canvas.addEventListener("keydown", onKey);

  // ---------- render loop: on demand; continuous only for scenes with motion, while visible ----------
  const moving = animate && !reducedMotion && typeof tick === "function";
  let raf = 0; let visible = true; let disposed = false; let last = 0; let t = 0;
  const frameTimes = []; let measuring = 0; let onMeasured = null; let measureEnd = 0;
  function frame(now) {
    raf = 0; if (disposed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    if (measuring) { if (last) frameTimes.push(now - last); if (--measuring === 0 || now > measureEnd) { measuring = 0; onMeasured?.(); } } // bounded by frames and by time
    last = now;
    const k = 1 - Math.exp(-dt * 9);
    for (const key of Object.keys(goal)) cur[key] += (goal[key] - cur[key]) * k;
    place();
    if (moving) { t += dt; tick(t, dt); }
    renderer.render(scene, camera); firstFrame();
    if ((moving && visible && !document.hidden) || !settled() || measuring) raf = requestAnimationFrame(frame); else last = 0;
  }
  function request() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  let firstFrame; const firstDrawn = new Promise((r) => { firstFrame = r; });

  const resize = () => { const w = container.clientWidth || 640; const h = container.clientHeight || 360; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); request(); };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null; ro?.observe(container);
  const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) request(); }) : null; io?.observe(container);
  const onVis = () => { if (!document.hidden) request(); }; document.addEventListener("visibilitychange", onVis);
  if (!moving && typeof tick === "function") tick(0, 0); // static scenes still get their resting pose
  resize(); place();

  // ---------- adaptive quality: measure a short burst of frames; lighten, then give up on genuinely slow devices ----------
  const median = () => { const a = frameTimes.slice(frameTimes.length > 6 ? 3 : 1).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  const measure = (n, budgetMs) => new Promise((r) => { frameTimes.length = 0; measuring = n; measureEnd = performance.now() + budgetMs; onMeasured = r; last = 0; request(); });
  const SLOW_MS = 70; const GIVE_UP_MS = 140; const perf = { median: 0, lightened: false };
  const ready = (async () => {
    await firstDrawn;
    if (!perfCheck || document.hidden) return; // can't measure in a background tab
    await measure(14, 2500); perf.median = median();
    if (perf.median <= SLOW_MS) return;
    renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; perf.lightened = true;
    scene.traverse((o) => { const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.needsUpdate = true; }); });
    resize(); await measure(10, 2500); perf.median = median();
    if (perf.median > GIVE_UP_MS) { const err = new Error("slow"); err.code = "slow"; throw err; } // e.g. software-rendered WebGL
  })();

  return {
    get view() { return { ...goal }; },
    ready, perf,
    views: views.map((v) => ({ id: v.id, label: v.label })),
    setView(id) { const v = views.find((x) => x.id === id); if (v) go(v); },
    zoom(f) { goal.radius *= f; clampGoal(); request(); },
    reset() { go(views[0]); },
    dispose() {
      if (disposed) return; disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect(); io?.disconnect(); document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o) => { o.geometry?.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose()); });
      materials.dispose(); env.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    }
  };
}
