// Delivered: a parcel resting on the step of a typical front porch. It is a generic illustration of the recorded
// status: no recipient, signature, photograph of anyone's property or proof of delivery is implied.
export default {
  label: "a parcel on a typical front porch",
  extent: 14, fog: [60, 300],
  limits: { min: 3, max: 30, minPitch: 0.04, maxPitch: 1.0 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.55, pitch: 0.2, radius: 14, target: [0, 1.8, 3] },
    { id: "parcel", label: "Parcel", yaw: 0.35, pitch: 0.28, radius: 4.6, target: [0.9, 0.5, 4.4] },
    { id: "front", label: "Front", yaw: 0, pitch: 0.12, radius: 18, target: [0, 2.5, 0] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    K.ground(1200, 1200, M.grass({ repeat: [120, 120] }), -0.02, scene);
    const path = K.ground(2.2, 14, M.concrete({ repeat: [1, 6], joints: 1, color: "#c9c7c2" }), 0.01, scene); path.position.z = 11;
    K.house({ w: 11, d: 9, wall: "#e6dfd2", roof: "#454b53", parent: scene });
    K.box(1.2, 0.03, 0.8, M.paint("#5a4a3b", 0.95, 0), 0, 0.3, 5.0, scene);                              // doormat
    K.cartons([[0.9, 0.3, 5.0, 0.55, 0.25]], scene);
    for (const x of [-2.1, 2.1]) { K.cyl(0.32, 0.25, 0.6, M.paint("#3a3f46", 0.6, 0.2), x, 0.3, 5.3, scene, 20); K.mesh(new THREE.IcosahedronGeometry(0.45, 2), M.paint("#3f6b35", 0.9, 0), x, 1.25, 5.3, scene); }
    for (let i = 0; i < 4; i++) K.tree(-9 + (i % 2) * 18, 2 + Math.floor(i / 2) * 9, scene, 1.1, i + 40);
    const hedge = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), M.paint("#38602f", 0.95, 0), 16); const m = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) { const side = i < 8 ? -1 : 1; m.makeTranslation(side * (2.2 + (i % 8) * 1.2), 0.45, 15); hedge.setMatrixAt(i, m); } scene.add(hedge);
  }
};
