// Customs: a typical cargo inspection area with a covered inspection lane, a portal scanner gantry, a container truck
// waiting at the barrier, a control booth and container stacks behind a secure fence. A customs-themed illustration is
// not evidence that an inspection, decision, duty payment or release happened.
export default {
  label: "a typical cargo customs inspection area",
  extent: 70, fog: [220, 1000],
  limits: { min: 15, max: 170, minPitch: 0.04, maxPitch: 1.1 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.78, pitch: 0.3, radius: 78, target: [0, 3, 0] },
    { id: "lane", label: "Inspection lane", yaw: 1.45, pitch: 0.1, radius: 34, target: [0, 3, 0] },
    { id: "yard", label: "Container yard", yaw: -0.5, pitch: 0.28, radius: 70, target: [-10, 3, -30] }
  ],
  build({ THREE, scene, materials: M, kit: K, dark }) {
    K.ground(3000, 3000, M.grass({ repeat: [120, 120] }), -0.03, scene);
    K.ground(200, 140, M.concrete({ repeat: [12, 9], joints: 2, color: "#b3b6b8" }), 0, scene);
    K.ground(120, 8, M.asphalt({ repeat: [12, 1] }), 0.006, scene);
    const stripe = (x, z, w, d, c) => { const p = K.mesh(new THREE.PlaneGeometry(w, d), M.paint(c, 0.7, 0), x, 0.02, z, scene); p.rotation.x = -Math.PI / 2; p.userData.noShadow = true; };
    stripe(0, 4.1, 120, 0.2, "#f2f2ee"); stripe(0, -4.1, 120, 0.2, "#f2f2ee"); stripe(-14, 0, 0.5, 8, "#f2f2ee");
    // covered inspection lane: steel portal frames and a light roof
    const steel = M.paint("#6f7984", 0.45, 0.7);
    for (let i = 0; i < 5; i++) { const x = -6 + i * 7; for (const s of [-1, 1]) K.box(0.5, 9, 0.5, steel, x, 0, s * 6.5, scene); K.box(0.5, 0.7, 13.5, steel, x, 9, 0, scene); }
    K.box(30, 0.35, 15, M.cladding("#cdd3da", { ribs: 16, repeat: [6, 1] }), 8, 9.7, 0, scene);
    // portal scanner gantry with hazard banding
    for (const s of [-1, 1]) { K.box(1.6, 7.5, 1.6, M.paint("#e3e6ea", 0.4, 0.3), 4, 0, s * 5, scene); for (let k = 0; k < 4; k++) K.box(1.62, 0.4, 1.62, M.paint(k % 2 ? "#151515" : "#e7b416", 0.6, 0.2), 4, 0.6 + k * 0.4, s * 5, scene); }
    K.box(1.8, 1.4, 11.6, M.paint("#e3e6ea", 0.4, 0.3), 4, 7.5, 0, scene);
    K.box(0.2, 0.25, 9.6, M.lamp("#ffb04a", dark ? 2.5 : 1), 4.95, 7.8, 0, scene);
    // barrier arm, control booth and kerbs
    K.box(0.6, 1.1, 0.6, M.paint("#e5e7eb", 0.4, 0.3), 16, 0, 5.2, scene);
    K.box(0.12, 0.12, 8.6, M.paint("#d92b2b", 0.5, 0.2), 16, 0.95, 0.9, scene);                 // barrier arm (down)
    for (let k = 0; k < 4; k++) K.box(0.14, 0.14, 1.0, M.paint("#f5f5f5", 0.5, 0.2), 16, 0.94, 4.0 - k * 2.2, scene);
    const booth = new THREE.Group(); booth.position.set(19, 0, 8.5); scene.add(booth);
    K.box(4, 2.9, 3, M.paint("#eef0f2", 0.5, 0.2), 0, 0.3, 0, booth); K.box(4.05, 1.1, 3.05, M.glass("#1c2a3a"), 0, 1.6, 0, booth); K.box(4.6, 0.25, 3.6, M.paint("#3b4148", 0.5, 0.4), 0, 3.2, 0, booth); K.box(4.4, 0.3, 3.4, M.concrete(), 0, 0, 0, booth);
    // a container truck waiting at the barrier
    const t = K.truck({ trailer: "container", containerColor: "#2f5f8a", cabColor: "#e9ecef" }); t.position.set(22 + 8.5, 0, 0); t.rotation.y = Math.PI; scene.add(t);
    // container stacks behind a secure fence
    const boxes = []; let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const h = 1 + Math.floor(rnd() * 4); for (let k = 0; k < h; k++) boxes.push({ x: -40 + c * 13.2, y: k * 2.59, z: -24 - r * 2.6, long: true }); }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { const h = 1 + Math.floor(rnd() * 3); for (let k = 0; k < h; k++) boxes.push({ x: 45 + r * 2.6, y: k * 2.59, z: -30 + c * 6.3, ry: Math.PI / 2 }); }
    K.containers(boxes, scene);
    const f1 = K.fence(120, scene, { h: 3 }); f1.position.set(0, 0, -17);
    for (let i = 0; i < 5; i++) { const p = K.lightPole(14, dark, scene); p.position.set(-45 + i * 22, 0, -15); p.rotation.y = Math.PI / 2; }
  }
};
