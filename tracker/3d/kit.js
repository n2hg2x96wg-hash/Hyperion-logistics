// Reusable, generic parts for the stage scenes (metres, y up, vehicles face +x). No logos, liveries, registrations or
// lettering: every vehicle and building is unbranded. Repeated parts are merged or instanced to keep draw calls low.
export function createKit(THREE, M) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  /** Merge simple geometries (each optionally transformed) into one non-indexed geometry with position/normal/uv. */
  function merge(parts) {
    const pos = []; const nor = []; const uv = [];
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    for (const p of parts) {
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      e.set(...(p.rot || [0, 0, 0])); q.setFromEuler(e);
      m.compose(V(...(p.pos || [0, 0, 0])), q, p.scale ? V(...p.scale) : V(1, 1, 1)); g.applyMatrix4(m);
      pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
      uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array((g.attributes.position.count) * 2)));
      g.dispose(); p.geo.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }

  /** Box with rounded edges (vertices of a segmented box pushed onto rounded corners). */
  function roundedBox(w, h, d, r = 0.1, seg = 3) {
    const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2); const p = g.attributes.position; const v = V(); const inner = V(w / 2 - r, h / 2 - r, d / 2 - r);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const c = V(Math.max(-inner.x, Math.min(inner.x, v.x)), Math.max(-inner.y, Math.min(inner.y, v.y)), Math.max(-inner.z, Math.min(inner.z, v.z)));
      const off = v.clone().sub(c); if (off.lengthSq() > 0) off.setLength(r); p.setXYZ(i, c.x + off.x, c.y + off.y, c.z + off.z);
    }
    g.computeVertexNormals(); return g;
  }

  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent?.add(o); return o; };
  /** Box resting on y (its base), centred on x/z. */
  const box = (w, h, d, mat, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, parent);
  const cyl = (rt, rb, h, mat, x, y, z, parent, seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z, parent);
  const ground = (w, d, mat, y = 0, parent) => { const g = mesh(new THREE.PlaneGeometry(w, d), mat, 0, y, 0, parent); g.rotation.x = -Math.PI / 2; g.userData.noShadow = true; return g; };

  // ---------- wheels: tyre cross-section turned on a lathe, steel rim, hub (axis along z) ----------
  const wheelGeo = new Map();
  function wheel(r = 0.5, w = 0.32) {
    const key = `${r}${w}`;
    if (!wheelGeo.has(key)) {
      const pts = []; const rr = r * 0.62;
      for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push(new THREE.Vector2(r - (w * 0.18) + Math.cos(a) * w * 0.18, Math.sin(a) * w / 2)); }
      pts.unshift(new THREE.Vector2(rr, -w / 2)); pts.push(new THREE.Vector2(rr, w / 2));
      const tyre = new THREE.LatheGeometry(pts, 28); tyre.rotateX(Math.PI / 2);
      const rim = new THREE.CylinderGeometry(rr, rr, w * 0.82, 24); rim.rotateX(Math.PI / 2);
      const hub = new THREE.CylinderGeometry(rr * 0.35, rr * 0.4, w * 0.95, 12); hub.rotateX(Math.PI / 2);
      wheelGeo.set(key, { tyre, rim, hub });
    }
    const g = new THREE.Group(); const { tyre, rim, hub } = wheelGeo.get(key);
    g.add(new THREE.Mesh(tyre, M.rubber()), new THREE.Mesh(rim, M.paint("#9aa1aa", 0.35, 0.8)), new THREE.Mesh(hub, M.paint("#5b616a", 0.4, 0.7)));
    return g;
  }
  function axle(parent, x, r, track, w = 0.32, dual = false) {
    for (const s of [-1, 1]) { const wl = wheel(r, w); wl.position.set(x, r, s * track / 2); parent.add(wl); if (dual) { const w2 = wheel(r, w); w2.position.set(x, r, s * (track / 2 - w - 0.02)); parent.add(w2); } }
  }

  // ---------- tractor unit + trailer ----------
  function truck({ trailer = "box", trailerColor = "#eef1f4", cabColor = "#f4f5f7", containerColor = "#2f5f8a", length = 13.6, cab: withCab = true } = {}) {
    const g = new THREE.Group();
    const cabX = length / 2 + 0.35; // cab sits ahead of the trailer
    if (withCab) {
    // chassis rails and fifth wheel
    box(length * 0.32 + 4.2, 0.28, 0.9, M.paint("#1f2328", 0.6, 0.4), cabX - 0.6, 0.62, 0, g);
    // cab-over cab: rounded body, raked windscreen, sun visor, grille, bumper, lights, mirrors
    const body = M.paint(cabColor, 0.3, 0.25);
    mesh(roundedBox(2.3, 3.05, 2.48, 0.22), body, cabX + 1.65, 2.55, 0, g);
    const ws = mesh(new THREE.BoxGeometry(0.05, 1.15, 2.2), M.glass("#132235"), cabX + 2.82, 3.05, 0, g); ws.rotation.z = 0.08;
    box(0.35, 0.12, 2.3, M.paint("#22272d", 0.5, 0.3), cabX + 2.75, 3.66, 0, g);                       // sun visor
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.95, 0.8, 0.03), M.glass("#132235"), cabX + 2.1, 3.0, s * 1.245, g);
    box(0.08, 0.95, 1.95, M.paint("#20252b", 0.5, 0.5), cabX + 2.82, 1.4, 0, g);                     // grille
    for (let i = 0; i < 5; i++) box(0.1, 0.05, 1.85, M.paint("#8a929b", 0.3, 0.8), cabX + 2.86, 1.5 + i * 0.18, 0, g);
    box(0.34, 0.55, 2.5, M.paint("#2f353c", 0.55, 0.3), cabX + 2.72, 0.5, 0, g);                      // bumper
    for (const s of [-1, 1]) { box(0.06, 0.2, 0.46, M.lamp("#fffaf0", 1.6), cabX + 2.9, 0.82, s * 0.88, g); box(0.06, 0.08, 0.3, M.lamp("#ffb347", 1.2), cabX + 2.9, 1.1, s * 1.0, g); }
    for (const s of [-1, 1]) { box(0.06, 0.06, 0.45, M.paint("#2a2f35", 0.5, 0.5), cabX + 2.55, 3.35, s * 1.42, g); box(0.12, 0.7, 0.22, M.paint("#2a2f35", 0.4, 0.4), cabX + 2.5, 2.8, s * 1.7, g); }
    for (const s of [-1, 1]) { box(0.6, 0.06, 0.25, M.paint("#3b4148", 0.6, 0.4), cabX + 2.2, 0.75, s * 1.32, g); cyl(0.32, 0.32, 1.0, M.chrome(), cabX + 0.7, 0.45, s * 1.0, g).rotation.x = Math.PI / 2; }
    axle(g, cabX + 2.15, 0.52, 2.05); axle(g, cabX - 0.05, 0.52, 1.9, 0.3, true);
    }
    // trailer
    const tl = new THREE.Group(); g.add(tl);
    if (trailer === "container") {
      box(length - 0.8, 0.22, 2.3, M.paint("#22262b", 0.6, 0.4), -0.2, 1.12, 0, tl);
      const c = mesh(new THREE.BoxGeometry(12.19, 2.59, 2.44), M.container(), -0.2, 1.34 + 1.295, 0, tl); c.material = c.material.clone(); c.material.color.set(containerColor);
    } else {
      mesh(roundedBox(length, 2.75, 2.5, 0.05, 2), M.paint(trailerColor, 0.42, 0.15), 0, 1.25 + 1.375, 0, tl);
      for (let i = -6; i <= 6; i++) box(0.04, 2.7, 2.52, M.paint("#d7dbe0", 0.5, 0.2), i * (length / 13.2), 1.27, 0, tl);   // panel seams
      box(length, 0.12, 2.54, M.paint("#9aa1a9", 0.4, 0.6), 0, 3.98, 0, tl); box(length, 0.18, 2.54, M.paint("#3b4148", 0.6, 0.4), 0, 1.16, 0, tl);
      for (const s of [-1, 1]) box(7.5, 0.55, 0.04, M.paint("#cfd5dc", 0.5, 0.2), -0.6, 0.6, s * 1.24, tl);                 // side skirts
      box(0.05, 2.6, 2.4, M.paint("#cdd2d8", 0.45, 0.3), -length / 2 - 0.01, 1.3, 0, tl);                                   // rear doors
      box(0.06, 2.55, 0.03, M.paint("#555c64", 0.5, 0.6), -length / 2 - 0.04, 1.32, 0, tl);
      for (const s of [-1, 1]) box(0.05, 0.14, 0.3, M.lamp("#ff3b30", 1.4), -length / 2 - 0.04, 1.0, s * 1.0, tl);
    }
    for (let i = 0; i < 3; i++) axle(tl, -length / 2 + 1.6 + i * 1.32, 0.48, 2.05, 0.38);
    box(0.25, 0.8, 0.2, M.paint("#33383e", 0.6, 0.4), 1.5, 0.35, 0.8, tl); box(0.25, 0.8, 0.2, M.paint("#33383e", 0.6, 0.4), 1.5, 0.35, -0.8, tl); // landing legs
    return g;
  }

  // ---------- high-roof panel van ----------
  function van({ color = "#f6f7f9", doorsOpen = false, parcels = false } = {}) {
    const g = new THREE.Group(); const paint = M.paint(color, 0.3, 0.3); const glass = M.glass("#132235"); const trim = M.paint("#2c3138", 0.6, 0.2);
    mesh(roundedBox(4.0, 2.2, 2.02, 0.2), paint, -0.75, 1.55, 0, g);                        // cargo body
    mesh(roundedBox(1.25, 1.75, 2.0, 0.22), paint, 1.75, 1.37, 0, g);                       // cab
    mesh(roundedBox(0.75, 1.0, 1.98, 0.26), paint, 2.6, 1.0, 0, g);                         // bonnet
    const ws = mesh(new THREE.BoxGeometry(0.04, 1.0, 1.8), glass, 2.28, 1.86, 0, g); ws.rotation.z = 0.5;
    for (const s of [-1, 1]) box(0.8, 0.6, 0.02, glass, 1.75, 1.5, s * 1.005, g);           // door windows
    box(0.3, 0.42, 2.06, trim, 2.95, 0.3, 0, g);                                            // bumper
    box(0.06, 0.32, 1.2, M.paint("#1f242a", 0.5, 0.4), 2.98, 0.72, 0, g);                   // grille
    for (const s of [-1, 1]) { box(0.06, 0.14, 0.36, M.lamp("#fffaf0", 1.4), 2.96, 1.0, s * 0.72, g); box(0.18, 0.28, 0.08, trim, 2.2, 1.75, s * 1.12, g); }
    box(4.0, 0.08, 2.06, trim, -0.75, 0.62, 0, g);                                          // rubbing strip
    for (const s of [-1, 1]) box(0.04, 0.16, 0.24, M.lamp("#ff3b30", 1.2), -2.77, 1.0, s * 0.85, g);
    axle(g, 2.25, 0.37, 1.75, 0.22); axle(g, -1.85, 0.37, 1.75, 0.22);
    if (doorsOpen) {
      box(0.04, 1.95, 1.84, M.paint("#2a2f36", 0.8, 0), -2.73, 0.52, 0, g);                  // dark interior opening
      for (const s of [-1, 1]) { const d = new THREE.Group(); d.position.set(-2.77, 0, s * 0.98); g.add(d); box(0.05, 1.95, 0.96, paint, 0, 0.52, -s * 0.48, d); d.rotation.y = s * 1.75; }
      if (parcels) cartons([[-2.25, 0.5, -0.45, 0.6], [-2.25, 0.5, 0.35, 0.5], [-2.25, 0.95, -0.3, 0.45], [-1.65, 0.5, 0.1, 0.55]], g);
    }
    return g;
  }

  // ---------- warehouse equipment and goods ----------
  function forklift(color = "#e8a317") {
    const g = new THREE.Group();
    mesh(roundedBox(2.0, 1.0, 1.15, 0.12), M.paint(color, 0.4, 0.25), 0, 0.75, 0, g);
    mesh(roundedBox(0.7, 0.9, 1.1, 0.15), M.paint("#2a2e33", 0.6, 0.3), -0.85, 0.95, 0, g);          // counterweight
    box(0.5, 0.15, 0.5, M.paint("#1b1e22", 0.7, 0.1), -0.1, 1.25, 0, g);                              // seat
    for (const s of [-1, 1]) { box(0.07, 1.25, 0.07, M.paint("#1b1e22", 0.5, 0.5), 0.55, 1.25, s * 0.5, g); box(0.07, 1.25, 0.07, M.paint("#1b1e22", 0.5, 0.5), -0.55, 1.25, s * 0.5, g); }
    box(1.2, 0.06, 1.1, M.paint("#1b1e22", 0.5, 0.5), 0, 2.5, 0, g);                                  // overhead guard
    for (const s of [-1, 1]) box(0.1, 2.6, 0.1, M.paint("#30353b", 0.4, 0.6), 1.08, 0.1, s * 0.32, g); // mast
    for (const s of [-1, 1]) box(1.1, 0.05, 0.12, M.paint("#30353b", 0.4, 0.6), 1.62, 0.15, s * 0.3, g); // forks
    axle(g, 0.6, 0.32, 1.0, 0.25); axle(g, -0.65, 0.26, 0.95, 0.2);
    return g;
  }
  function pallet() {
    const parts = [];
    for (let i = 0; i < 5; i++) parts.push({ geo: new THREE.BoxGeometry(1.2, 0.022, 0.14), pos: [0, 0.133, -0.43 + i * 0.215] });
    for (let i = 0; i < 3; i++) parts.push({ geo: new THREE.BoxGeometry(1.2, 0.022, 0.1), pos: [0, 0.011, -0.45 + i * 0.45] });
    for (const x of [-0.55, 0, 0.55]) for (const z of [-0.45, 0, 0.45]) parts.push({ geo: new THREE.BoxGeometry(0.1, 0.1, 0.1), pos: [x, 0.072, z] });
    return merge(parts);
  }
  /** Instanced cartons: list of [x, y, z, size] (y = base). */
  function cartons(list, parent) {
    const geo = new THREE.BoxGeometry(1, 0.72, 0.82); geo.translate(0, 0.36, 0);
    const im = new THREE.InstancedMesh(geo, M.cardboard(), list.length); const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
    list.forEach(([x, y, z, s, ry = 0], i) => { q.setFromAxisAngle(V(0, 1, 0), ry); m.compose(V(x, y, z), q, V(s, s, s)); im.setMatrixAt(i, m); });
    parent?.add(im); return im;
  }
  /** Palletised load: pallet + stacked cartons. */
  function palletLoad(x, z, parent, { layers = 3, ry = 0, seed = 1 } = {}) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent?.add(g);
    mesh(pallet(), M.wood(), 0, 0, 0, g);
    const list = []; for (let l = 0; l < layers; l++) for (const cx of [-0.3, 0.3]) for (const cz of [-0.25, 0.25]) if (!(l === layers - 1 && (seed + cx * 7 + cz * 3) % 3 < 0.5)) list.push([cx, 0.144 + l * 0.43, cz, 0.58]);
    cartons(list, g); return g;
  }

  // ---------- shipping containers (instanced, tinted per container) ----------
  const CONTAINER_COLOURS = ["#2f5f8a", "#9c3b2e", "#3d6b4f", "#b8892f", "#6b6f76", "#c9ccd0", "#7a3f5a", "#2d4a6b", "#a8552a", "#4e7f8f"];
  /** list of { x, y (base), z, ry, long (40 ft), colour } */
  function containers(list, parent) {
    const geo = new THREE.BoxGeometry(6.06, 2.59, 2.44); geo.translate(0, 1.295, 0);
    const im = new THREE.InstancedMesh(geo, M.container(), list.length); const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const c = new THREE.Color();
    list.forEach((k, i) => { q.setFromAxisAngle(V(0, 1, 0), k.ry || 0); m.compose(V(k.x, k.y, k.z), q, V(k.long ? 2.01 : 1, 1, 1)); im.setMatrixAt(i, m);
      im.setColorAt(i, c.set(k.colour || CONTAINER_COLOURS[i % CONTAINER_COLOURS.length])); });
    parent?.add(im); return im;
  }

  // ---------- site furniture ----------
  function lightPole(h = 9, lit = false, parent) {
    const g = new THREE.Group(); parent?.add(g);
    cyl(0.08, 0.12, h, M.paint("#7d858f", 0.4, 0.7), 0, 0, 0, g, 10);
    box(1.4, 0.08, 0.1, M.paint("#7d858f", 0.4, 0.7), 0.6, h - 0.1, 0, g);
    box(0.7, 0.12, 0.35, M.paint("#3b4148", 0.4, 0.5), 1.2, h - 0.22, 0, g);
    box(0.6, 0.02, 0.28, lit ? M.lamp("#fff1d0", 3) : M.paint("#e5e7eb", 0.3, 0), 1.2, h - 0.24, 0, g);
    return g;
  }
  function fence(len, parent, { h = 2.2 } = {}) {
    const g = new THREE.Group(); parent?.add(g);
    const posts = Math.max(2, Math.round(len / 2.5) + 1);
    const pim = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, h, 6), M.paint("#4b5563", 0.5, 0.7), posts); const m = new THREE.Matrix4();
    for (let i = 0; i < posts; i++) { m.makeTranslation(-len / 2 + (i / (posts - 1)) * len, h / 2, 0); pim.setMatrixAt(i, m); } g.add(pim);
    const panel = mesh(new THREE.PlaneGeometry(len, h * 0.95), M.paint("#5b6470", 0.6, 0.5, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }), 0, h / 2, 0, g); panel.userData.noShadow = true;
    box(len, 0.04, 0.04, M.paint("#4b5563", 0.5, 0.7), 0, h - 0.04, 0, g);
    return g;
  }
  function tree(x, z, parent, s = 1, seed = 1) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); parent?.add(g);
    cyl(0.12, 0.2, 2.4, M.paint("#5a4632", 0.9, 0), 0, 0, 0, g, 8);
    const leaf = M.paint("#3f6b35", 0.85, 0, { flatShading: false });
    const r = (k) => { const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.IcosahedronGeometry(1.1 + r(i) * 0.5, 2); const p = geo.attributes.position;
      for (let j = 0; j < p.count; j++) { const k = 1 + (Math.sin(p.getX(j) * 3 + seed) * Math.cos(p.getZ(j) * 3 + i)) * 0.12; p.setXYZ(j, p.getX(j) * k, p.getY(j) * k * 0.85, p.getZ(j) * k); }
      geo.computeVertexNormals(); mesh(geo, leaf, (r(i + 4) - 0.5) * 1.4, 3.2 + r(i + 8) * 1.2, (r(i + 12) - 0.5) * 1.4, g);
    }
    return g;
  }
  /** Detached house with gable roof, porch and windows (front faces +z). */
  function house({ w = 9, d = 8, h = 5.6, wall = "#e9e3d8", roof = "#4a4f57", parent } = {}) {
    const g = new THREE.Group(); parent?.add(g);
    box(w, h, d, M.paint(wall, 0.9, 0), 0, 0, 0, g);
    const shape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.4, 0), new THREE.Vector2(0, 3), new THREE.Vector2(w / 2 + 0.4, 0)]);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: false }); rg.translate(0, 0, -(d + 0.8) / 2);
    mesh(rg, M.paint(roof, 0.75, 0.1), 0, h, 0, g);
    const glass = M.glass("#2a3c52"); const frame = M.paint("#f8fafc", 0.5, 0);
    for (const [x, y] of [[-2.6, 1.3], [2.6, 1.3], [-2.6, 3.8], [0, 3.8], [2.6, 3.8]]) { box(1.5, 1.3, 0.08, frame, x, y - 0.05, d / 2 + 0.02, g); box(1.3, 1.1, 0.1, glass, x, y + 0.05, d / 2 + 0.03, g); }
    box(1.15, 2.2, 0.1, M.paint("#24324a", 0.5, 0.1), 0, 0.3, d / 2 + 0.03, g);                      // front door
    box(0.06, 0.06, 0.12, M.chrome(), 0.4, 1.3, d / 2 + 0.1, g);
    box(2.6, 0.3, 1.6, M.concrete(), 0, 0, d / 2 + 0.8, g);                                          // porch step
    box(2.6, 0.08, 1.8, M.paint(roof, 0.75, 0.1), 0, 2.8, d / 2 + 0.8, g);                            // porch canopy
    for (const s of [-1, 1]) box(0.12, 2.5, 0.12, frame, s * 1.2, 0.3, d / 2 + 1.55, g);
    return g;
  }

  /** Collapse a group into one geometry per material (world transforms applied), for instancing many copies. */
  function bake(group) {
    group.updateMatrixWorld(true); const by = new Map();
    const im = new THREE.Matrix4(); const wm = new THREE.Matrix4();
    group.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.isInstancedMesh ? o.count : 1;
      for (let i = 0; i < n; i++) {
        if (o.isInstancedMesh) { o.getMatrixAt(i, im); wm.multiplyMatrices(o.matrixWorld, im); } else wm.copy(o.matrixWorld);
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(wm);
        if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push({ geo: g });
      }
    });
    const out = [...by].map(([material, parts]) => ({ material, geometry: merge(parts) }));
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    return out;
  }
  /** Place many copies of a baked group: transforms = [{ x, y, z, ry }]. One draw call per material. */
  function instances(group, transforms, parent) {
    const out = new THREE.Group(); const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
    for (const { geometry, material } of bake(group)) {
      const im = new THREE.InstancedMesh(geometry, material, transforms.length);
      transforms.forEach((t, i) => { q.setFromAxisAngle(V(0, 1, 0), t.ry || 0); m.compose(V(t.x, t.y || 0, t.z), q, V(1, 1, 1)); im.setMatrixAt(i, m); });
      out.add(im);
    }
    parent?.add(out); return out;
  }

  return { V, merge, bake, instances, roundedBox, mesh, box, cyl, ground, wheel, axle, truck, van, forklift, pallet, cartons, palletLoad, containers, CONTAINER_COLOURS, lightPole, fence, tree, house };
}
