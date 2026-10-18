// Picked up: a dispatch dock where a truck is backed onto a door with palletised goods staged on the dock plate and a
// forklift nearby. A typical collection scene for the stage: no driver, vehicle registration, signature or pickup time.
export default {
  label: "a typical dispatch dock where shipments are collected",
  extent: 55, fog: [180, 700],
  limits: { min: 12, max: 120, minPitch: 0.04, maxPitch: 1.1 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.72, pitch: 0.24, radius: 56, target: [0, 3, 8] },
    { id: "dock", label: "Dock door", yaw: 0.35, pitch: 0.1, radius: 22, target: [0, 2, 3] },
    { id: "truck", label: "Truck", yaw: 1.75, pitch: 0.14, radius: 30, target: [0, 2, 14] }
  ],
  build({ THREE, scene, materials: M, kit: K, dark }) {
    K.ground(2400, 2400, M.grass({ repeat: [100, 100] }), -0.02, scene);
    K.ground(140, 80, M.asphalt({ repeat: [10, 6], wet: dark }), 0, scene).position.z = 30;
    K.ground(80, 9, M.concrete({ repeat: [8, 1], joints: 4 }), 0.01, scene).position.z = 4.5;
    const H = 12; K.mesh(new THREE.PlaneGeometry(80, H), M.cladding("#3a3f47", { ribs: 16, repeat: [14, 1], rough: 0.45, metal: 0.5 }), 0, H / 2, 0, scene);
    K.box(80, H, 30, M.paint("#2f343b", 0.7, 0.3), 0, 0, -15.05, scene);
    K.box(80.6, 0.8, 30.6, M.paint("#55606b", 0.5, 0.5), 0, H, -15, scene);
    const m = new THREE.Matrix4(); const doors = [-24, -16, -8, 0, 8, 16, 24];
    const inst = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { m.makeTranslation(...p); im.setMatrixAt(i, m); }); scene.add(im); return im; };
    inst(new THREE.BoxGeometry(3.9, 4.4, 0.6), M.paint("#15181c", 0.85, 0), doors.map((x) => [x, 3.4, 0.3]));
    inst(new THREE.BoxGeometry(3.0, 3.1, 0.1), M.cladding("#d9dde2", { ribs: 6, repeat: [0.5, 1] }), doors.filter((x) => x !== 0).map((x) => [x, 2.8, 0.62]));
    inst(new THREE.BoxGeometry(3.2, 1.25, 1.3), M.concrete({ color: "#9ea3a8" }), doors.map((x) => [x, 0.62, 0.65]));
    inst(new THREE.BoxGeometry(0.4, 0.22, 0.45), M.lamp("#ffe6b8", dark ? 3.5 : 1.2), doors.map((x) => [x, 6.4, 0.25]));
    // the open door: lit interior with staged pallets on the dock plate
    K.box(3.0, 3.1, 0.05, M.lamp("#fff3d6", 0.6), 0, 1.25, -0.4, scene);
    for (const z of [-1.2, 0.2]) K.palletLoad(-0.65, z, scene, { layers: 3 }).position.y = 1.25;
    // truck backed onto the open door, a second waiting in the yard
    const t = K.truck({ trailerColor: "#eef1f4" }); t.position.set(0, 0, 1.3 + 6.8 + 0.2); t.rotation.y = -Math.PI / 2; scene.add(t);
    const t2 = K.truck({ trailerColor: "#dfe5ea" }); t2.position.set(-30, 0, 36); t2.rotation.y = 0.25; scene.add(t2);
    const fl = K.forklift(); fl.position.set(6, 0, 5); fl.rotation.y = 2.6; scene.add(fl);
    for (let i = 0; i < 3; i++) K.palletLoad(9 + i * 1.6, 4.2, scene, { layers: 2, seed: i + 4 });
    for (let i = 0; i < 4; i++) { const p = K.lightPole(10, dark, scene); p.position.set(-30 + i * 20, 0, 18); p.rotation.y = Math.PI / 2; }
    for (let i = 0; i < 6; i++) K.tree(-60 + i * 22, 75, scene, 1.4, i + 9);
    K.fence(140, scene).position.set(0, 0, 70);
  }
};
