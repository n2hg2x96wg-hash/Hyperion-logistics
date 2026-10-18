// In transit by air: a generic twin-engine freighter on a cargo apron with its main-deck door open, a high-loader,
// a train of unit load devices behind a tug and a cargo shed. Plain white airframe: no airline, registration or flight
// number. It does not show where the shipment is.
function fuselage(THREE) {
  const R = 3.1; const pts = [];
  const prof = [[-31, 0.25], [-29, 0.9], [-26, 1.7], [-22, 2.5], [-18, 3.0], [-14, R], [16, R], [19, 2.95], [21.5, 2.6], [23.5, 2.0], [25, 1.3], [26, 0.6], [26.4, 0.05]];
  for (const [x, r] of prof) pts.push(new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, 40); g.rotateZ(-Math.PI / 2); // axis along +x
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (x < -14) p.setY(i, p.getY(i) + Math.pow((-14 - x) / 17, 1.6) * 2.6); if (x > 16) p.setY(i, p.getY(i) - Math.pow((x - 16) / 10.4, 2) * 0.9); }
  g.computeVertexNormals(); return g;
}
function planform(THREE, pts, thick) { // shape in (chord x, span s) -> extruded, span along -z
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, s]) => new THREE.Vector2(x, s))), { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.35, bevelSize: thick * 0.35, bevelSegments: 2 });
  g.translate(0, 0, -thick / 2); g.rotateX(-Math.PI / 2); return g;
}

export default {
  label: "a typical cargo aircraft being loaded at an airport",
  extent: 90, fog: [260, 1300],
  limits: { min: 25, max: 260, minPitch: 0.04, maxPitch: 1.2 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.62, pitch: 0.26, radius: 120, target: [2, 4, 4] },
    { id: "door", label: "Cargo door", yaw: 0.25, pitch: 0.12, radius: 48, target: [12, 4, 6] },
    { id: "tail", label: "Tail", yaw: 2.4, pitch: 0.18, radius: 85, target: [-15, 7, 0] }
  ],
  build({ THREE, scene, materials: M, kit: K, dark }) {
    // ---------- apron, taxiway and grass ----------
    K.ground(3000, 3000, M.grass({ repeat: [120, 120] }), -0.03, scene);
    K.ground(240, 170, M.concrete({ repeat: [12, 9], joints: 2, color: "#b9bcbf" }), 0, scene).position.z = 10;
    const tw = K.ground(1400, 40, M.asphalt({ repeat: [60, 2] }), 0.004, scene); tw.position.z = -120;
    const paint = (w, d, x, z, color = "#e9c43a", ry = 0) => { const p = K.mesh(new THREE.PlaneGeometry(w, d), M.paint(color, 0.7, 0), x, 0.02, z, scene); p.rotation.set(-Math.PI / 2, 0, ry); p.userData.noShadow = true; return p; };
    paint(120, 0.35, 0, 0); paint(0.35, 60, 30, 10); paint(0.35, 60, -40, 10); paint(240, 0.3, 0, 52, "#f1f1ee");
    const edge = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8), M.lamp("#7fb6ff", dark ? 3 : 1.2), 40); const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) { m.makeTranslation(-600 + i * 30, 0.2, -100); edge.setMatrixAt(i, m); } scene.add(edge);

    // ---------- the aircraft ----------
    const ac = new THREE.Group(); ac.position.y = 2.4; scene.add(ac);
    const white = M.paint("#f3f5f7", 0.32, 0.15); const grey = M.paint("#aab2bb", 0.4, 0.4);
    K.mesh(fuselage(THREE), white, 0, 3.1, 0, ac);
    K.mesh(K.roundedBox(26, 1.4, 4.6, 0.6), grey, 0, 0.9, 0, ac);                                     // belly fairing
    for (const s of [-1, 1]) K.box(1.4, 0.55, 0.05, M.glass("#101a26"), 22.2, 4.25, s * 1.9, ac).rotation.y = s * 0.45;   // cockpit windows
    K.box(0.9, 0.5, 2.4, M.glass("#101a26"), 23.1, 4.1, 0, ac);
    const wing = planform(THREE, [[0, 0], [-18.7, 30], [-21.4, 30], [-10.5, 0]], 0.7);
    for (const s of [-1, 1]) {
      const w = K.mesh(wing.clone(), white, 4, 1.4, s * 2.6, ac); w.scale.z = s > 0 ? -1 : 1; w.rotation.x = s * 0.1;
      const tipX = 4 - 20; const tipZ = s * (2.6 + 30);
      const wl = K.mesh(planform(THREE, [[0, 0], [-2.2, 3.4], [-3.2, 3.4], [-2.6, 0]], 0.25), white, tipX + 1.2, 4.4, tipZ, ac); wl.rotation.x = Math.PI / 2; // span points up
      // engine: nacelle, intake lip, fan, exhaust cone, pylon
      const ex = -1.5; const ez = s * 11.5; const nac = new THREE.Group(); nac.position.set(ex, 0.3, ez); ac.add(nac);
      const body = K.mesh(new THREE.CylinderGeometry(1.75, 1.45, 6.5, 32, 1, true), M.paint("#e9edf1", 0.3, 0.3, { side: THREE.DoubleSide }), 0, 0, 0, nac); body.rotation.z = Math.PI / 2;
      const lip = K.mesh(new THREE.TorusGeometry(1.7, 0.14, 10, 32), M.chrome(), 3.25, 0, 0, nac); lip.rotation.y = Math.PI / 2;
      const fan = K.mesh(new THREE.CircleGeometry(1.62, 32), M.paint("#22262c", 0.4, 0.8), 2.9, 0, 0, nac); fan.rotation.y = Math.PI / 2;
      const cone = K.mesh(new THREE.ConeGeometry(0.9, 2.2, 24), M.paint("#5b626b", 0.4, 0.7), -4.2, 0, 0, nac); cone.rotation.z = Math.PI / 2;
      K.box(3.8, 1.4, 0.35, white, ex - 0.5, 1.5, ez, ac);
    }
    const hs = planform(THREE, [[0, 0], [-6.5, 10.5], [-8.6, 10.5], [-5.6, 0]], 0.4);
    for (const s of [-1, 1]) { const h = K.mesh(hs.clone(), white, -22, 6.6, s * 1.1, ac); h.scale.z = s > 0 ? -1 : 1; h.rotation.x = s * 0.12; }
    K.mesh(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-7.5, 11), new THREE.Vector2(-10.5, 11), new THREE.Vector2(-9.5, 0)]), { depth: 0.45, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2 }), white, -18.5, 7.4, -0.22, ac);
    // landing gear
    K.box(0.25, 2.2, 0.25, grey, 19, -2.2, 0, ac); const nose = new THREE.Group(); nose.position.set(19, -2.4, 0); ac.add(nose); K.axle(nose, 0, 0.55, 0.9, 0.35);
    for (const s of [-1, 1]) { K.box(0.4, 2.2, 0.4, grey, -2, -2.2, s * 4.6, ac); const bogie = new THREE.Group(); bogie.position.set(-2, -2.4, s * 4.6); ac.add(bogie); K.axle(bogie, 1.0, 0.62, 1.5, 0.45); K.axle(bogie, -1.0, 0.62, 1.5, 0.45); }
    // open main-deck cargo door (forward left) with the dark opening behind it
    K.box(6.2, 3.4, 0.1, M.paint("#1c2026", 0.8, 0), 12, 2.6, 3.06, ac);
    const door = K.mesh(new THREE.BoxGeometry(6.2, 3.4, 0.18), white, 12, 8.3, 3.4, ac); door.rotation.x = -1.35;

    // ---------- ground equipment: high-loader at the door, tug with a train of ULDs ----------
    const loader = new THREE.Group(); loader.position.set(14.2, 0, 9.5); scene.add(loader);
    K.box(7, 1.2, 3.2, M.paint("#e8b21d", 0.5, 0.3), 0, 0.4, 0, loader); K.axle(loader, 2.4, 0.42, 2.6, 0.3); K.axle(loader, -2.4, 0.42, 2.6, 0.3);
    for (const s of [-1, 1]) { const a = K.box(0.2, 5.4, 0.2, M.paint("#3b4148", 0.5, 0.6), 0, 1.4, s * 1.4, loader); a.rotation.z = 0.9; }
    K.box(6.6, 0.4, 4.2, M.paint("#e8b21d", 0.5, 0.3), 0, 5.4, -1.2, loader); K.box(6.6, 0.9, 0.08, M.paint("#30353b", 0.5, 0.5), 0, 5.8, 0.9, loader);
    const uld = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-1.0, 0), new THREE.Vector2(1.0, 0), new THREE.Vector2(1.0, 1.15), new THREE.Vector2(0.55, 1.63), new THREE.Vector2(-1.0, 1.63)]), { depth: 1.53, bevelEnabled: false });
    uld.translate(0, 0, -0.765);
    const uldMat = M.cladding("#c3c9d0", { ribs: 10, repeat: [0.6, 0.6], rough: 0.35, metal: 0.8 });
    const dolly = new THREE.Group(); K.box(2.6, 0.5, 2.0, M.paint("#3f4650", 0.6, 0.4), 0, 0.35, 0, dolly); K.axle(dolly, 0.85, 0.28, 1.6, 0.2); K.axle(dolly, -0.85, 0.28, 1.6, 0.2); K.mesh(uld, uldMat, 0, 0.85, 0, dolly);
    K.instances(dolly, [0, 1, 2, 3, 4].map((i) => ({ x: 4 - i * 3.3, z: 18 })), scene);
    const tug = new THREE.Group(); K.mesh(K.roundedBox(3.6, 1.2, 2.0, 0.2), M.paint("#e8b21d", 0.5, 0.3), 0, 0.9, 0, tug); K.box(1.3, 1.1, 1.8, M.glass("#1a2633"), -0.6, 1.5, 0, tug); K.axle(tug, 1.2, 0.42, 1.7, 0.3); K.axle(tug, -1.2, 0.42, 1.7, 0.3);
    tug.position.set(7.6, 0, 18); scene.add(tug);
    for (let i = 0; i < 4; i++) K.palletLoad(-30 + i * 2.2, 26, scene, { layers: 2, seed: i + 2 });

    // ---------- cargo shed and light masts ----------
    const shed = new THREE.Group(); shed.position.set(-118, 0, -5); shed.rotation.y = -Math.PI / 2; scene.add(shed); // faces the apron
    const H = 16; const front = K.mesh(new THREE.PlaneGeometry(150, H), M.cladding("#c9ced4", { ribs: 16, repeat: [26, 1] }), 0, H / 2, -15, shed); front.rotation.y = Math.PI;
    K.box(150, H, 30, M.paint("#aeb5bd", 0.7, 0.2), 0, 0, 0, shed).scale.set(0.998, 0.999, 0.99);
    K.box(151, 1, 31, M.paint("#7f8892", 0.5, 0.5), 0, H, 0, shed);
    for (let i = 0; i < 6; i++) K.box(14, 9, 0.3, M.cladding("#8f98a2", { ribs: 8, repeat: [1, 1] }), -55 + i * 22, 0, -15.1, shed);
    for (let i = 0; i < 4; i++) { const p = K.lightPole(24, dark, scene); p.position.set(-60 + i * 40, 0, -45); p.rotation.y = Math.PI / 2; }
  }
};
