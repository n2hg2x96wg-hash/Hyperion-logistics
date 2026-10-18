// In transit by sea: a generic container vessel on open water. The hull is lofted from cross-sections (rounded bilge
// amidships, fine bow with a bulb, flat transom); the paint follows real practice (antifouling red below the waterline,
// a black boot-top, dark topsides). No name, flag, IMO number or company colours. It does not show where the shipment is.
const L = 210; const B = 32; const KEEL = -11; const DECK = 7.5;

// half-breadth (0..1 of B/2) at t = x/(L/2) in [-1, 1] and height fraction z in [0, 1] (keel -> deck)
function halfBreadth(t, z) {
  const bilge = Math.min(1, Math.sqrt(Math.max(0, z) / 0.12));
  let w = bilge;
  if (t > 0.42) { const f = (t - 0.42) / 0.58; const flare = 0.7 + 0.3 * z; w = Math.sqrt(Math.max(0, 1 - Math.pow(f / flare, 2))) * (0.25 + 0.75 * Math.pow(z, 0.55)) * (1 - f * 0.1); }
  if (t < -0.78) { const f = (-t - 0.78) / 0.22; w *= 1 - f * 0.12 * (1 - z) - f * 0.05; if (z < 0.35) w *= 1 - f * (0.35 - z) * 2.2; }
  return Math.max(0, w);
}

function hullGeometry(THREE) {
  const S = 90; const P = 22; const pos = []; const col = []; const idx = [];
  const red = new THREE.Color("#7c2a22"); const black = new THREE.Color("#15181c"); const top = new THREE.Color("#25344a"); const c = new THREE.Color();
  const H = DECK - KEEL;
  for (let i = 0; i <= S; i++) {
    const t = -1 + (2 * i) / S; const x = (t * L) / 2;
    for (let side = -1; side <= 1; side += 2) for (let j = 0; j <= P; j++) {
      const z = j / P; const y = KEEL + z * H + (t > 0.6 ? Math.pow((t - 0.6) / 0.4, 2) * 2.2 * z : 0); // sheer rises toward the bow
      pos.push(x, y, side * halfBreadth(t, z) * (B / 2));
      c.copy(y < -0.4 ? red : y < 1.1 ? black : top); col.push(c.r, c.g, c.b);
    }
  }
  const row = (P + 1) * 2;
  for (let i = 0; i < S; i++) for (let side = 0; side < 2; side++) for (let j = 0; j < P; j++) {
    const a = i * row + side * (P + 1) + j; const b = a + row;
    if (side === 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function deckGeometry(THREE) {
  const pts = []; const S = 60;
  for (let i = 0; i <= S; i++) { const t = -1 + (2 * i) / S; pts.push(new THREE.Vector2((t * L) / 2, halfBreadth(t, 1) * (B / 2))); }
  for (let i = S; i >= 0; i--) { const t = -1 + (2 * i) / S; pts.push(new THREE.Vector2((t * L) / 2, -halfBreadth(t, 1) * (B / 2))); }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(-Math.PI / 2); return g; // faces up
}

const WATER_VS = `uniform float time; varying vec3 vWorld; varying float vFog;
float wave(vec2 p, vec2 d, float k, float a, float s){ return a * sin(dot(p, d) * k + time * s); }
void main(){ vec3 p = position; vec2 q = (modelMatrix * vec4(p, 1.0)).xz;
  p.z += wave(q, vec2(0.8, 0.6), 0.045, 0.55, 0.9) + wave(q, vec2(-0.3, 0.95), 0.07, 0.3, 1.3) + wave(q, vec2(0.95, -0.2), 0.11, 0.15, 1.7);
  vec4 w = modelMatrix * vec4(p, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`;
const WATER_FS = `uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyTop; uniform vec3 skyHorizon; uniform vec3 sunDir; uniform vec3 sunColor;
uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; varying vec3 vWorld; varying float vFog;
vec2 grad(vec2 p, vec2 d, float k, float a, float s){ return d * k * a * cos(dot(p, d) * k + time * s); }
void main(){ vec2 p = vWorld.xz; float near = 1.0 - smoothstep(80.0, 600.0, vFog); // ripples fade with distance (no shimmer)
  vec2 g = grad(p, vec2(0.8, 0.6), 0.045, 0.55, 0.9) + grad(p, vec2(-0.3, 0.95), 0.07, 0.3, 1.3) + grad(p, vec2(0.95, -0.2), 0.11, 0.15, 1.7)
    + near * (grad(p, vec2(0.6, -0.8), 0.9, 0.03, 2.3) + grad(p, vec2(-0.85, -0.5), 1.4, 0.018, 2.9) + grad(p, vec2(0.2, 0.98), 2.3, 0.01, 3.7));
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n); vec3 sky = mix(skyHorizon, skyTop, pow(clamp(r.y, 0.0, 1.0), 0.5));
  vec3 base = mix(deep, shallow, clamp(0.5 + g.x * 2.0, 0.0, 1.0) * 0.35);
  vec3 col = mix(base, sky, fres);
  float spec = pow(max(dot(r, normalize(sunDir)), 0.0), 220.0); col += sunColor * spec * 2.4;
  col = mix(col, fogColor, smoothstep(fogNear, fogFar, vFog));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export default {
  label: "a typical container vessel at sea",
  extent: 140, fog: [350, 1600],
  limits: { min: 45, max: 420, minPitch: 0.03, maxPitch: 1.15 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.95, pitch: 0.24, radius: 255, target: [5, 6, 0] },
    { id: "bridge", label: "Bridge", yaw: -2.35, pitch: 0.2, radius: 95, target: [-80, 22, 0] },
    { id: "bow", label: "Bow", yaw: 1.25, pitch: 0.06, radius: 110, target: [90, 2, 0] }
  ],
  build({ THREE, scene, materials: M, kit: K, mood, sun }) {
    // ---------- ocean ----------
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 220, 220), new THREE.ShaderMaterial({
      vertexShader: WATER_VS, fragmentShader: WATER_FS,
      uniforms: { time: { value: 0 }, deep: { value: new THREE.Color("#0b2f4a") }, shallow: { value: new THREE.Color("#1d6a86") },
        skyTop: { value: new THREE.Color(mood.top) }, skyHorizon: { value: new THREE.Color(mood.horizon) }, sunDir: { value: sun.position.clone().normalize() },
        sunColor: { value: new THREE.Color(mood.sun) }, fogColor: { value: scene.fog.color }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far } } }));
    water.rotation.x = -Math.PI / 2; water.userData.noShadow = true; scene.add(water);

    // ---------- hull, deck and forecastle ----------
    const ship = new THREE.Group(); scene.add(ship);
    K.mesh(hullGeometry(THREE), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide }), 0, 0, 0, ship);
    K.mesh(deckGeometry(THREE), M.paint("#47503f", 0.85, 0.1), 0, DECK + 0.02, 0, ship);
    const bulb = K.mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: "#7c2a22", roughness: 0.6 }), L / 2 - 3, -6.5, 0, ship); bulb.scale.set(9, 3.2, 3.2);
    K.box(0.6, DECK + 2, halfBreadth(-1, 1) * B, M.paint("#25344a", 0.55, 0.2), -L / 2 + 0.3, -2, 0, ship);   // transom
    K.box(26, 3, B * 0.62, M.paint("#25344a", 0.55, 0.2), L / 2 - 20, DECK, 0, ship);                 // forecastle
    K.box(4, 4.2, B * 0.5, M.paint("#e8ebee", 0.5, 0.2), L / 2 - 33, DECK, 0, ship);                   // breakwater
    for (const z of [-5, 5]) K.cyl(0.8, 0.8, 1.2, M.paint("#3b3f45", 0.5, 0.6), L / 2 - 14, DECK + 3, z, ship);

    // ---------- accommodation block, bridge with wings, funnel and mast (aft) ----------
    const ax = -L / 2 + 26; const white = M.paint("#eef0f2", 0.45, 0.15); const glass = M.glass("#14202e");
    K.box(16, 21, 24, white, ax, DECK, 0, ship);
    const wins = []; // rows of individual windows on the front and both sides of each accommodation deck
    for (let k = 0; k < 6; k++) { const y = DECK + 2.6 + k * 3.3;
      for (let i = 0; i < 10; i++) wins.push([ax + 8.05, y, -10.8 + i * 2.4, 0]);
      for (const side of [-1, 1]) for (let i = 0; i < 6; i++) wins.push([ax - 6.5 + i * 2.5, y, side * 12.05, Math.PI / 2]); }
    const win = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.0, 1.3), glass, wins.length); const wm = new THREE.Matrix4(); const wq = new THREE.Quaternion();
    wins.forEach(([x, y, z, r], i) => { wq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); wm.compose(new THREE.Vector3(x, y, z), wq, new THREE.Vector3(1, 1, 1)); win.setMatrixAt(i, wm); }); ship.add(win);
    K.box(9, 3.4, B + 1.5, white, ax + 3, DECK + 21, 0, ship);                                        // bridge deck with wings
    K.box(9.1, 1.4, B + 1.6, glass, ax + 3, DECK + 22.4, 0, ship);
    K.box(9.6, 0.4, B + 2, M.paint("#cfd4d9", 0.5, 0.2), ax + 3, DECK + 24.4, 0, ship);
    K.box(1.2, 9, 1.2, M.paint("#e8ebee", 0.5, 0.2), ax + 1, DECK + 24.8, 0, ship);                   // mast
    K.box(4, 0.3, 0.3, M.paint("#e8ebee", 0.5, 0.2), ax + 1, DECK + 32, 0, ship);
    K.mesh(K.roundedBox(8, 13, 7, 1.2), M.paint("#2b3036", 0.5, 0.3), ax - 12, DECK + 10, 0, ship);
    K.box(8.1, 2.2, 7.1, M.paint("#c8ccd1", 0.5, 0.3), ax - 12, DECK + 12, 0, ship).position.y = DECK + 13.2;

    // ---------- hatch covers, lashing bridges and containers ----------
    const bayPitch = 12.9; const firstBay = ax + 12; const bays = Math.floor((L / 2 - 36 - firstBay) / bayPitch);
    const boxes = []; const hatches = []; const bridges = [];
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let b = 0; b < bays; b++) {
      const x = firstBay + b * bayPitch + bayPitch / 2; const t = (x * 2) / L;
      const rows = Math.max(4, Math.min(12, Math.floor((halfBreadth(t, 1) * B * 0.93) / 2.5)));
      hatches.push([x, rows]); bridges.push(x - bayPitch / 2);
      for (let r = 0; r < rows; r++) {
        const z = (r - (rows - 1) / 2) * 2.5; const edge = Math.min(r, rows - 1 - r);
        const tiers = Math.max(1, Math.round(4 + rnd() * 3 - (edge === 0 ? 1.5 : 0) - Math.max(0, b - bays + 3) * 0.8));
        for (let k = 0; k < tiers; k++) boxes.push({ x, y: DECK + 1.3 + k * 2.6, z, long: true, colour: K.CONTAINER_COLOURS[Math.floor(rnd() * K.CONTAINER_COLOURS.length)] });
      }
    }
    K.containers(boxes, ship);
    for (const [x, rows] of hatches) K.box(12.4, 1.3, rows * 2.5 + 0.4, M.paint("#55606b", 0.6, 0.4), x, DECK, 0, ship);
    for (const x of bridges) { const t = (x * 2) / L; K.box(0.45, 6, halfBreadth(t, 1) * B * 0.9, M.paint("#9a9172", 0.6, 0.4), x, DECK, 0, ship); }

    // ---------- foam at the bow and along the hull ----------
    const S = 128; const cvs = document.createElement("canvas"); cvs.width = cvs.height = S; const g = cvs.getContext("2d"); const img = g.createImageData(S, S); const n = M.noise(S, 9, 4, 8);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4; const a = Math.max(0, n(x, y) - 0.48) * 4 * Math.pow(1 - y / S, 1.5); img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255); }
    g.putImageData(img, 0, 0); const foamTex = new THREE.CanvasTexture(cvs);
    const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.85 });
    for (const side of [-1, 1]) { const f = K.mesh(new THREE.PlaneGeometry(L * 0.9, 14), foamMat, 0, 0.35, side * (B / 2 + 6), scene); f.rotation.x = -Math.PI / 2; if (side < 0) f.rotation.z = Math.PI; f.userData.noShadow = true; }
    const bow = K.mesh(new THREE.PlaneGeometry(30, 40), foamMat, L / 2 + 6, 0.4, 0, scene); bow.rotation.x = -Math.PI / 2; bow.rotation.z = Math.PI / 2; bow.userData.noShadow = true;

    // restrained motion: a slow swell under a steady ship (no forward movement)
    return (time) => { water.material.uniforms.time.value = time; ship.position.y = Math.sin(time * 0.5) * 0.35; ship.rotation.x = Math.sin(time * 0.37) * 0.006; ship.rotation.z = Math.sin(time * 0.29) * 0.003; };
  }
};
