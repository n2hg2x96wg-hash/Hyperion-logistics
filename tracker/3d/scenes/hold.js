// On hold / exception: a typical cargo hold bay inside a secure warehouse cage, with barrier tape, cones, a wrapped
// pallet tagged for attention and a beacon that is switched on but does not flash. It illustrates "waiting for a
// decision"; it is not evidence of an inspection, seizure or any specific issue with this shipment.
export default {
  label: "a typical cargo hold bay where shipments wait for attention",
  mood: "overcast", extent: 26, fog: [90, 320],
  limits: { min: 5, max: 34, minPitch: 0.04, maxPitch: 0.95 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.65, pitch: 0.26, radius: 20, target: [0, 1.4, 0] },
    { id: "pallet", label: "Tagged pallet", yaw: 0.2, pitch: 0.14, radius: 8, target: [0, 1, 0] },
    { id: "cage", label: "Hold cage", yaw: -0.8, pitch: 0.3, radius: 18, target: [-2, 1.4, -2] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    const W = 40; const D = 30; const H = 9;
    K.ground(W, D, M.concrete({ repeat: [5, 4], joints: 3, color: "#b9bcbe" }), 0, scene);
    const wall = M.cladding("#d9dde2", { ribs: 14, repeat: [8, 1], rough: 0.6, metal: 0.2 });
    for (const [w, x, z, ry] of [[W, 0, -D / 2, 0], [D, -W / 2, 0, Math.PI / 2]]) { const p = K.mesh(new THREE.PlaneGeometry(w, H), wall, x, H / 2, z, scene); p.rotation.y = ry; p.userData.noShadow = true; }
    // floor markings: a hatched hold zone
    const zone = (x, z, w, d, c) => { const p = K.mesh(new THREE.PlaneGeometry(w, d), M.paint(c, 0.7, 0), x, 0.012, z, scene); p.rotation.x = -Math.PI / 2; p.userData.noShadow = true; };
    zone(0, 0, 9, 0.22, "#e5b11f"); zone(0, -7, 9, 0.22, "#e5b11f"); zone(-4.5, -3.5, 0.22, 7, "#e5b11f"); zone(4.5, -3.5, 0.22, 7, "#e5b11f");
    for (let i = 0; i < 8; i++) { const s = K.mesh(new THREE.PlaneGeometry(0.22, 1.6), M.paint("#e5b11f", 0.7, 0), -3.8 + i * 1.1, 0.012, -3.5, scene); s.rotation.x = -Math.PI / 2; s.rotation.z = 0.7; s.userData.noShadow = true; }
    // mesh cage around the hold zone (back and sides)
    const cage = (len, x, z, ry) => { const f = K.fence(len, scene, { h: 2.8 }); f.position.set(x, 0, z); f.rotation.y = ry; };
    cage(10, 0, -7.6, 0); cage(7.6, -5.1, -3.8, Math.PI / 2); cage(7.6, 5.1, -3.8, Math.PI / 2);
    // the wrapped pallet with an amber attention tag
    const load = K.palletLoad(0, -3.4, scene, { layers: 3, seed: 4 });
    const wrap = K.mesh(new THREE.BoxGeometry(1.32, 1.36, 1.12), M.paint("#dfe7ee", 0.15, 0, { transparent: true, opacity: 0.38, depthWrite: false }), 0, 0.82, 0, load); wrap.userData.noShadow = true;
    K.box(0.42, 0.3, 0.02, M.lamp("#f59e0b", 1.3), 0.25, 0.8, 0.57, load);
    // barrier tape on posts across the open front, and cones
    const post = (x, z) => { K.cyl(0.05, 0.05, 1.0, M.paint("#2b2f35", 0.5, 0.5), x, 0, z, scene, 10); K.cyl(0.22, 0.26, 0.06, M.paint("#2b2f35", 0.5, 0.5), x, 0, z, scene, 16); };
    for (const x of [-4.6, -1.5, 1.5, 4.6]) post(x, 0.4);
    for (let i = 0; i < 18; i++) K.box(0.5, 0.06, 0.02, M.paint(i % 2 ? "#f5f5f5" : "#d92b2b", 0.6, 0), -4.25 + i * 0.5, 0.9, 0.4, scene);
    const cone = (x, z) => { K.cyl(0.035, 0.24, 0.62, M.paint("#ea580c", 0.6, 0), x, 0, z, scene, 16); K.box(0.5, 0.04, 0.5, M.paint("#1f2328", 0.8, 0), x, 0, z, scene); };
    cone(-6, 1.6); cone(6, 1.6); cone(-2.8, 2.4);
    // a beacon on a short pole, lit but steady (no flashing)
    K.cyl(0.06, 0.06, 2.4, M.paint("#2b2f35", 0.5, 0.5), 4.6, 0, -7.2, scene, 10);
    K.cyl(0.18, 0.18, 0.32, M.lamp("#f59e0b", 2.2), 4.6, 2.4, -7.2, scene, 20);
    // other freight waiting outside the zone
    for (let i = 0; i < 4; i++) K.palletLoad(-14 + i * 2.4, -11, scene, { layers: 2 + (i % 2), seed: i + 7 });
    const fl = K.forklift(); fl.position.set(11, 0, -3); fl.rotation.y = -2.4; scene.add(fl);
  }
};
