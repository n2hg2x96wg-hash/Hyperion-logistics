// Cancelled: a typical loading dock at the end of the day, roller shutters down and the bay empty except for an unused
// pallet. Low, cool light and nothing in motion: the shipment will not continue. No reason for the cancellation is
// implied by this illustration.
export default {
  label: "a typical closed loading dock",
  mood: "dim", extent: 40, fog: [120, 520],
  limits: { min: 8, max: 70, minPitch: 0.04, maxPitch: 0.9 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.35, pitch: 0.22, radius: 40, target: [-2, 3, -6] },
    { id: "doors", label: "Dock doors", yaw: 0.05, pitch: 0.1, radius: 20, target: [0, 2.6, -8] },
    { id: "bay", label: "Empty bay", yaw: 1.2, pitch: 0.24, radius: 16, target: [6, 1, 2] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    K.ground(3000, 3000, M.grass({ repeat: [120, 120] }), -0.03, scene);
    K.ground(90, 60, M.asphalt({ repeat: [9, 6] }), 0, scene);
    // the building: clad wall, raised dock platform and five roller shutters, all closed
    const b = new THREE.Group(); b.position.set(0, 0, -12); scene.add(b);
    K.box(56, 9, 10, M.cladding("#cfd4da", { ribs: 26, repeat: [12, 1] }), 0, 0, -5, b);
    K.box(56, 1.2, 3, M.concrete({ color: "#a7abaf" }), 0, 0, 1.5, b);
    for (let i = 0; i < 5; i++) {
      const x = -20 + i * 10;
      K.box(4, 4.2, 0.12, M.paint("#b9c1ca", 0.5, 0.45), x, 1.2, 0.06, b);                             // shutter (down)
      for (let k = 0; k < 9; k++) K.box(4, 0.05, 0.16, M.paint("#8d96a1", 0.5, 0.45), x, 1.45 + k * 0.45, 0.07, b); // slats
      K.box(4.1, 0.2, 0.2, M.paint("#e5b11f", 0.6, 0.2), x, 1.2, 0.12, b);                               // bottom rail on the dock
      K.box(4.6, 0.3, 0.3, M.paint("#3b4148", 0.5, 0.4), x, 5.4, 0.2, b);                                 // shutter box
      for (const s of [-1, 1]) K.box(0.25, 1.1, 0.5, M.paint("#1f2328", 0.8, 0), x + s * 2.2, 0.05, 3.1, b); // dock bumpers
      K.box(0.5, 0.18, 0.12, M.lamp("#ef4444", 1.2), x + 2.6, 5.0, 0.2, b);                               // red "closed" indicator, steady
    }
    // the empty bay: one bare pallet and a parked, uncoupled trailer
    K.mesh(K.pallet(), M.wood(), 6, 0, 2, scene);
    const tr = K.truck({ trailer: "box", trailerColor: "#d9dee4", cab: false }); tr.rotation.y = Math.PI / 2; tr.position.set(-14, 0, 6); scene.add(tr);
    const paint = (x, z, w, d) => { const p = K.mesh(new THREE.PlaneGeometry(w, d), M.paint("#d9d9d2", 0.7, 0), x, 0.02, z, scene); p.rotation.x = -Math.PI / 2; p.userData.noShadow = true; };
    for (let i = 0; i < 6; i++) paint(-25 + i * 10, 6, 0.18, 14);
    for (let i = 0; i < 3; i++) { const p = K.lightPole(10, true, scene); p.position.set(-24 + i * 24, 0, 18); p.rotation.y = -Math.PI / 2; }
  }
};
