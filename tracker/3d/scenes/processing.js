// Registered / processing: the inside of a typical warehouse where shipments are prepared, with pallet racking, a
// roller conveyor carrying cartons, palletised goods, a forklift and floor markings. It illustrates the stage only:
// it does not show a specific operation (packing, scanning or weighing) happening to this shipment.
export default {
  label: "a typical warehouse where shipments are prepared",
  extent: 45, fog: [140, 400],
  limits: { min: 6, max: 30, minPitch: 0.03, maxPitch: 0.42 }, // the camera stays under the roof
  views: [
    { id: "overview", label: "Overview", yaw: 0.62, pitch: 0.2, radius: 27, target: [-2, 2.5, -3] },
    { id: "conveyor", label: "Conveyor", yaw: 1.35, pitch: 0.16, radius: 13, target: [2, 1.2, 4] },
    { id: "racking", label: "Racking", yaw: -0.35, pitch: 0.1, radius: 18, target: [-6, 3, -8] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    const W = 64; const D = 44; const H = 12;
    // floor, walls and a one-sided roof (seen from below only, casts no shadow) so the camera can look in from outside
    K.ground(W, D, M.concrete({ repeat: [8, 6], joints: 3, color: "#b9bcbe" }), 0, scene).material.roughness = 0.55;
    const wall = M.cladding("#d9dde2", { ribs: 16, repeat: [10, 1], rough: 0.6, metal: 0.2 });
    for (const [w, x, z, ry] of [[W, 0, -D / 2, 0], [D, -W / 2, 0, Math.PI / 2], [D, W / 2, 0, -Math.PI / 2]]) { const p = K.mesh(new THREE.PlaneGeometry(w, H), wall, x, H / 2, z, scene); p.rotation.y = ry; p.userData.noShadow = true; }
    const roof = K.mesh(new THREE.PlaneGeometry(W, D), M.paint("#5e6670", 0.8, 0.3), 0, H, 0, scene); roof.rotation.x = Math.PI / 2; roof.userData.noShadow = true;
    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.6, D), M.paint("#3e4650", 0.5, 0.6), 8); const m = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) { m.makeTranslation(-28 + i * 8, H - 0.4, 0); beams.setMatrixAt(i, m); } beams.userData.noShadow = true; scene.add(beams);
    const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.6, 0.35, 20), M.lamp("#fff8e6", 2.2), 24);
    for (let i = 0; i < 24; i++) { m.makeTranslation(-26 + (i % 6) * 10.4, H - 1.5, -15 + Math.floor(i / 6) * 10); lamps.setMatrixAt(i, m); } lamps.userData.noShadow = true; scene.add(lamps);
    // dock doors along the back wall
    for (let i = 0; i < 5; i++) { K.box(3.2, 3.6, 0.1, M.cladding("#e7e9ec", { ribs: 6, repeat: [0.6, 1] }), -20 + i * 7, 0.1, -D / 2 + 0.08, scene); K.box(3.6, 0.15, 0.2, M.paint("#e5b11f", 0.6, 0.2), -20 + i * 7, 3.8, -D / 2 + 0.15, scene); }

    // floor markings: walkway and storage lanes
    const line = (w, d, x, z, c = "#e5b11f") => { const p = K.mesh(new THREE.PlaneGeometry(w, d), M.paint(c, 0.7, 0), x, 0.01, z, scene); p.rotation.x = -Math.PI / 2; p.userData.noShadow = true; };
    line(56, 0.15, 0, 9); line(56, 0.15, 0, 12); line(0.15, 30, 24, -6); for (let i = 0; i < 10; i++) line(1.2, 0.6, -22 + i * 5, 10.5, "#f1f2f0");

    // pallet racking: uprights, beams and palletised goods on three levels
    const bay = new THREE.Group();
    for (const x of [-1.4, 1.4]) for (const z of [-0.55, 0.55]) K.box(0.1, 7.2, 0.1, M.paint("#2463a6", 0.5, 0.4), x, 0, z, bay);
    for (const y of [2.3, 4.6]) for (const z of [-0.55, 0.55]) K.box(2.8, 0.14, 0.08, M.paint("#e0752b", 0.5, 0.4), 0, y, z, bay);
    for (const [y, x] of [[0, -0.7], [0, 0.7], [2.44, -0.7], [2.44, 0.7], [4.74, 0.7]]) { const pl = K.palletLoad(x, 0, bay, { layers: 2, ry: Math.PI / 2, seed: Math.round(y + x * 3) }); pl.position.y = y; pl.scale.setScalar(0.92); }
    const bays = []; for (let r = 0; r < 4; r++) for (let b = 0; b < 9; b++) bays.push({ x: -20 + b * 2.95, z: -16 + r * 4.2 + (r % 2 ? -0.6 : 0), ry: 0 });
    K.instances(bay, bays, scene);

    // roller conveyor with cartons moving slowly along it
    const conv = new THREE.Group(); conv.position.set(2, 0, 4.2); scene.add(conv);
    K.box(36, 0.12, 1.2, M.paint("#9aa3ad", 0.4, 0.7), 0, 0.9, 0, conv);
    for (const s of [-1, 1]) K.box(36, 0.22, 0.08, M.paint("#3c444d", 0.5, 0.6), 0, 0.95, s * 0.64, conv);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.9, 1.2), M.paint("#3c444d", 0.5, 0.6), 12);
    for (let i = 0; i < 12; i++) { m.makeTranslation(-16.5 + i * 3, 0.45, 0); legs.setMatrixAt(i, m); } conv.add(legs);
    const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1.18, 10), M.chrome(), 120); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < 120; i++) { m.compose(new THREE.Vector3(-17.8 + i * 0.3, 1.04, 0), q, new THREE.Vector3(1, 1, 1)); rollers.setMatrixAt(i, m); } conv.add(rollers);
    const n = 9; const items = K.cartons([...Array(n).keys()].map((i) => [0, 1.09, 0, 0.55 + (i % 3) * 0.08, (i % 2) * 0.2]), conv);
    const place = (time) => { for (let i = 0; i < n; i++) { const x = ((i * 4 + time * 0.6) % 36) - 18; const sz = 0.55 + (i % 3) * 0.08; m.compose(new THREE.Vector3(x, 1.09, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 2) * 0.2), new THREE.Vector3(sz, sz, sz)); items.setMatrixAt(i, m); } items.instanceMatrix.needsUpdate = true; };

    // staging area: pallets, a wrapped load, a forklift
    for (let i = 0; i < 6; i++) K.palletLoad(-18 + i * 2.2, 15.5, scene, { layers: 2 + (i % 2), seed: i });
    const fl = K.forklift(); fl.position.set(10, 0, 14); fl.rotation.y = -2.2; scene.add(fl);
    K.palletLoad(12.2, 15.6, scene, { layers: 2, ry: 0.3, seed: 5 });
    return place;
  }
};
