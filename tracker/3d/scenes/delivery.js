// Out for delivery: an unbranded panel van parked on a residential street with its rear doors open and parcels
// inside. A typical last-mile scene: no address, stop count, driver, vehicle position or arrival time.
export default {
  label: "a typical delivery van on a residential street",
  extent: 45, fog: [160, 700],
  limits: { min: 8, max: 110, minPitch: 0.04, maxPitch: 1.1 },
  views: [
    { id: "overview", label: "Overview", yaw: 1.2, pitch: 0.2, radius: 24, target: [0, 1.4, 2] },
    { id: "van", label: "Rear doors", yaw: -1.25, pitch: 0.12, radius: 11, target: [-1.5, 1.2, 1.6] },
    { id: "street", label: "Street", yaw: 1.5, pitch: 0.1, radius: 44, target: [0, 2, 0] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    K.ground(3000, 3000, M.grass({ repeat: [140, 140] }), -0.05, scene);
    K.ground(600, 8, M.asphalt({ repeat: [60, 1] }), 0, scene);
    for (const z of [5.5, -5.5]) { K.ground(600, 3, M.concrete({ repeat: [120, 1], joints: 1, color: "#c4c6c6" }), 0.12, scene).position.z = z; K.box(600, 0.14, 0.3, M.concrete({ color: "#a9adb0" }), 0, 0, z > 0 ? 4.1 : -4.1, scene); }
    const m = new THREE.Matrix4(); const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.12), M.paint("#f2f2ee", 0.7, 0), 60);
    for (let k = 0; k < 60; k++) { m.makeRotationX(-Math.PI / 2); m.setPosition(-180 + k * 6, 0.02, 0); dash.setMatrixAt(k, m); } dash.userData.noShadow = true; scene.add(dash);
    // houses on both sides with front gardens and drives
    const walls = ["#e9e3d8", "#d9cfc0", "#eef0ef", "#cdbba5", "#e3ddd2"]; const roofs = ["#4a4f57", "#6b3b32", "#3d434b"];
    for (let i = 0; i < 6; i++) for (const side of [1, -1]) {
      const h = K.house({ wall: walls[(i + (side > 0 ? 0 : 2)) % walls.length], roof: roofs[i % roofs.length], parent: scene });
      h.position.set(-50 + i * 20 + (side > 0 ? 0 : 7), 0, side * 24); if (side > 0) h.rotation.y = Math.PI; // fronts face the street
      const drive = K.ground(4, 11, M.concrete({ color: "#bdbfc0" }), 0.08, scene); drive.position.set(-50 + i * 20 + (side > 0 ? 7 : 0), 0.08, side * 13.5);
      K.tree(-56 + i * 20 + (side > 0 ? 0 : 6), side * 9.5, scene, 0.9, i * 3 + (side > 0 ? 1 : 2));
    }
    // the van, kerbside with the rear doors open and parcels inside
    const v = K.van({ doorsOpen: true, parcels: true }); v.position.set(0, 0, 2.2); scene.add(v);
    K.cartons([[-4.1, 0.12, 4.9, 0.5, 0.3]], scene);
    const car = new THREE.Group(); K.mesh(K.roundedBox(4.5, 1.1, 1.85, 0.32), M.paint("#7a1f2b", 0.25, 0.6), 0, 0.85, 0, car); K.mesh(K.roundedBox(2.4, 0.8, 1.7, 0.3), M.glass("#1c2a3a"), -0.2, 1.6, 0, car); K.axle(car, 1.4, 0.33, 1.6, 0.2); K.axle(car, -1.4, 0.33, 1.6, 0.2);
    car.position.set(14, 0, -2.2); car.rotation.y = Math.PI; scene.add(car);
  }
};
