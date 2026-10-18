// Delayed: a typical truck staging yard under a flat, overcast sky. Vehicles are parked with their engines off and loads
// wait on the apron, so nothing implies movement. A delay illustration is not a reason for the delay: any explanation
// comes only from what our team recorded.
export default {
  label: "a typical truck staging yard where loads wait",
  mood: "overcast", extent: 60, fog: [140, 700],
  limits: { min: 12, max: 120, minPitch: 0.05, maxPitch: 1.05 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.7, pitch: 0.3, radius: 58, target: [0, 2, 0] },
    { id: "bays", label: "Parking bays", yaw: 1.3, pitch: 0.14, radius: 30, target: [4, 2, 2] },
    { id: "apron", label: "Waiting loads", yaw: -0.3, pitch: 0.22, radius: 22, target: [-12, 1, 10] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    K.ground(3000, 3000, M.grass({ repeat: [120, 120] }), -0.03, scene);
    K.ground(140, 90, M.asphalt({ repeat: [12, 8] }), 0, scene);
    K.ground(30, 16, M.concrete({ repeat: [3, 2], joints: 2, color: "#b7babd" }), 0.008, scene).position.set(-14, 0.008, 10);
    const paint = (x, z, w, d, c = "#f2f2ee") => { const p = K.mesh(new THREE.PlaneGeometry(w, d), M.paint(c, 0.7, 0), x, 0.02, z, scene); p.rotation.x = -Math.PI / 2; p.userData.noShadow = true; };
    for (let i = 0; i < 7; i++) paint(-6 + i * 5, -6, 0.18, 18);                       // parking bay lines
    paint(9, 4.5, 36, 0.18, "#e5b11f");                                               // walkway edge
    // parked trucks: cabs facing the camera, all stationary
    const t1 = K.truck({ trailer: "box", trailerColor: "#eef1f4", cabColor: "#f4f5f7" }); t1.rotation.y = -Math.PI / 2; t1.position.set(-3.5, 0, -6); scene.add(t1);
    const t2 = K.truck({ trailer: "container", containerColor: "#9c3b2e", cabColor: "#2b4c7e" }); t2.rotation.y = -Math.PI / 2; t2.position.set(6.5, 0, -6); scene.add(t2);
    const t3 = K.truck({ trailer: "box", trailerColor: "#d9dee4", cab: false }); t3.rotation.y = -Math.PI / 2; t3.position.set(16.5, 0, -6); scene.add(t3);
    // loads waiting on the apron, a few traffic cones and a closed gate
    for (let i = 0; i < 6; i++) K.palletLoad(-21 + (i % 3) * 2.4, 7 + Math.floor(i / 3) * 2.6, scene, { layers: 2 + (i % 2), seed: i + 2 });
    const cone = (x, z) => { K.cyl(0.04, 0.28, 0.7, M.paint("#ea580c", 0.6, 0), x, 0, z, scene, 16); K.cyl(0.18, 0.21, 0.1, M.paint("#f5f5f5", 0.5, 0), x, 0.32, z, scene, 16); K.box(0.6, 0.04, 0.6, M.paint("#1f2328", 0.8, 0), x, 0, z, scene); };
    for (let i = 0; i < 4; i++) cone(-6 + i * 1.6, 3.6);
    const f = K.fence(110, scene, { h: 2.6 }); f.position.set(0, 0, -22);
    const gate = new THREE.Group(); gate.position.set(30, 0, 12); scene.add(gate);
    K.box(0.5, 1.2, 0.5, M.paint("#e5e7eb", 0.4, 0.3), 0, 0, 0, gate); K.box(0.12, 0.12, 7, M.paint("#d92b2b", 0.5, 0.2), 0, 1.05, -3.6, gate);
    const office = new THREE.Group(); office.position.set(-24, 0, -10); scene.add(office);
    K.box(10, 3.4, 6, M.cladding("#d9dde2", { ribs: 10, repeat: [3, 1] }), 0, 0, 0, office); K.box(6, 1.1, 0.1, M.glass("#1c2a3a"), 0, 1.5, 3.02, office);
    for (let i = 0; i < 4; i++) { const p = K.lightPole(10, false, scene); p.position.set(-30 + i * 20, 0, 18); p.rotation.y = -Math.PI / 2; }
    for (let i = 0; i < 6; i++) K.tree(-55 + i * 20, -30 - (i % 2) * 6, scene, 1.4, i + 1);
  }
};
