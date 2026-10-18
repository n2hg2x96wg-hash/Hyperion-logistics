// In transit by road: a tractor-trailer on a dual carriageway with lane markings, crash barriers, verges and trees.
// Unbranded vehicle; it is not shown moving along a route and does not indicate where the shipment is.
export default {
  label: "a typical freight truck on a highway",
  extent: 60, fog: [220, 1100],
  limits: { min: 14, max: 160, minPitch: 0.04, maxPitch: 1.1 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.85, pitch: 0.2, radius: 44, target: [0, 2, 0] },
    { id: "cab", label: "Cab", yaw: 1.2, pitch: 0.08, radius: 18, target: [8, 2.4, 0] },
    { id: "high", label: "Above", yaw: 0.3, pitch: 0.75, radius: 70, target: [0, 0, 0] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    K.ground(3000, 3000, M.grass({ repeat: [120, 120] }), -0.05, scene);
    const road = (z, w) => K.ground(2400, w, M.asphalt({ repeat: [200, 1] }), 0, scene).position.z = z;
    road(0, 11); road(-15, 11);
    K.ground(2400, 4, M.grass({ repeat: [200, 1] }), 0.004, scene).position.z = -7.5;               // central reservation
    const m = new THREE.Matrix4(); const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.5, 0.15), M.paint("#f2f2ee", 0.7, 0), 160);
    let i = 0; for (const z of [0, -15]) for (let k = 0; k < 80; k++) { m.makeRotationX(-Math.PI / 2); m.setPosition(-600 + k * 15, 0.02, z); dash.setMatrixAt(i++, m); }
    dash.userData.noShadow = true; scene.add(dash);
    for (const z of [5.3, -5.3, -9.7, -20.3]) { const e = K.mesh(new THREE.PlaneGeometry(2400, 0.2), M.paint("#f2f2ee", 0.7, 0), 0, 0.02, z, scene); e.rotation.x = -Math.PI / 2; e.userData.noShadow = true; }
    // steel crash barriers on posts along both sides and the central reservation
    for (const z of [6.4, -6.5, -8.5]) {
      K.box(2400, 0.32, 0.08, M.paint("#b9c0c7", 0.35, 0.8), 0, 0.55, z, scene);
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), M.paint("#8d959e", 0.4, 0.7), 300);
      for (let k = 0; k < 300; k++) { m.makeTranslation(-600 + k * 4, 0.375, z + 0.08); posts.setMatrixAt(k, m); } scene.add(posts);
    }
    const t = K.truck({ trailerColor: "#eef1f4" }); t.position.set(-3, 0, -2.6); scene.add(t);
    const car = new THREE.Group(); K.mesh(K.roundedBox(4.5, 1.1, 1.85, 0.32), M.paint("#5b6470", 0.25, 0.6), 0, 0.85, 0, car); K.mesh(K.roundedBox(2.4, 0.8, 1.7, 0.3), M.glass("#1c2a3a"), -0.2, 1.6, 0, car); K.axle(car, 1.4, 0.33, 1.6, 0.2); K.axle(car, -1.4, 0.33, 1.6, 0.2);
    car.position.set(-34, 0, 2.6); scene.add(car);
    const t2 = K.truck({ trailer: "container", containerColor: "#3d6b4f" }); t2.position.set(40, 0, -17.6); t2.rotation.y = Math.PI; scene.add(t2);
    for (let k = 0; k < 26; k++) K.tree(-260 + k * 21 + (k % 3) * 4, (k % 2 ? 22 : 30) + (k % 5) * 3, scene, 1.3 + (k % 3) * 0.25, k + 30);
    for (let k = 0; k < 20; k++) K.tree(-240 + k * 25, -40 - (k % 4) * 6, scene, 1.4, k + 70);
  }
};
