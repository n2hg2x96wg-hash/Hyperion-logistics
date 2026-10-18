// At a facility: a large distribution centre with a long dock face, trailers at the doors, a trailer yard, a glazed
// office block and a fenced site. A typical facility for the stage, not the building where the shipment is.
export default {
  label: "a typical distribution centre with loading docks",
  extent: 150, fog: [380, 1500],
  limits: { min: 40, max: 420, minPitch: 0.05, maxPitch: 1.2 },
  views: [
    { id: "overview", label: "Overview", yaw: -0.72, pitch: 0.42, radius: 250, target: [10, 0, 10] },
    { id: "docks", label: "Docks", yaw: 0.95, pitch: 0.1, radius: 78, target: [-20, 5, 40] },
    { id: "office", label: "Office", yaw: -0.25, pitch: 0.16, radius: 70, target: [78, 6, 34] }
  ],
  build({ THREE, scene, materials: M, kit: K, dark }) {
    const L = 160; const D = 64; const H = 13.5; const front = D / 2;
    // ---------- ground: asphalt yard, concrete apron along the docks, verges ----------
    K.ground(3000, 3000, M.grass({ repeat: [120, 120] }), -0.02, scene);
    const yard = K.ground(250, 150, M.asphalt({ repeat: [14, 9], wet: dark }), 0, scene); yard.position.z = 25;
    const apron = K.ground(L, 16, M.concrete({ repeat: [16, 2], joints: 4 }), 0.01, scene); apron.position.z = front + 8;
    const road = K.ground(14, 600, M.asphalt({ repeat: [1, 40] }), 0.005, scene); road.position.x = -140;
    // parking lines in the trailer yard
    const lines = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 16), M.paint("#e8e8e2", 0.8, 0), 18); const m = new THREE.Matrix4();
    for (let i = 0; i < 18; i++) { m.makeRotationX(-Math.PI / 2); m.setPosition(-70 + i * 5, 0.02, 82); lines.setMatrixAt(i, m); } lines.userData.noShadow = true; scene.add(lines);

    // ---------- hall: clad walls, ribbon glazing, roof with parapet, skylights and plant ----------
    const hall = new THREE.Group(); scene.add(hall);
    const wall = (w, rib, x, z, ry) => { const p = K.mesh(new THREE.PlaneGeometry(w, H), M.cladding("#c5cbd2", { ribs: 16, repeat: [w / 5.5, 1], rough: 0.42, metal: 0.5 }), x, H / 2, z, hall); p.rotation.y = ry; return p; };
    wall(L, 1, 0, front, 0); wall(L, 1, 0, -front, Math.PI); wall(D, 1, L / 2, 0, Math.PI / 2); wall(D, 1, -L / 2, 0, -Math.PI / 2);
    K.box(L, H, D, M.paint("#9aa3ad", 0.8, 0.1), 0, 0, 0, hall).scale.set(0.995, 0.999, 0.99);          // inner volume (shadows)
    for (const [w, x, z, ry] of [[L, 0, front + 0.06, 0], [L, 0, -front - 0.06, Math.PI]]) { const b = K.mesh(new THREE.PlaneGeometry(w, 1.4), M.glass("#1b2a3c"), x, 9.6, z, hall); b.rotation.y = ry; }
    K.box(L, 1.2, D, M.cladding("#3a4049", { ribs: 16, repeat: [L / 5.5, 1] }), 0, 0, 0, hall).scale.set(1.002, 1, 1.004);   // dark plinth band
    K.box(L + 0.8, 0.9, D + 0.8, M.paint("#8d96a0", 0.5, 0.5), 0, H, 0, hall);                          // parapet
    K.box(L - 0.6, 0.05, D - 0.6, M.paint("#dfe3e7", 0.85, 0.05), 0, H + 0.35, 0, hall);                // roof membrane
    const sky = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.5, 6), M.paint("#e6f0fa", 0.3, 0.1, { emissive: "#dfeaf6", emissiveIntensity: 0.15 }), 40);
    for (let i = 0; i < 40; i++) { m.makeTranslation(-68 + (i % 10) * 15, H + 0.6, -20 + Math.floor(i / 10) * 13); sky.setMatrixAt(i, m); } hall.add(sky);
    const plant = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 1.8, 2.2), M.paint("#b8bec6", 0.5, 0.4), 8);
    for (let i = 0; i < 8; i++) { m.makeTranslation(-55 + i * 15, H + 1.3, (i % 2 ? 6 : -6)); plant.setMatrixAt(i, m); } hall.add(plant);

    // ---------- dock face: 22 doors with seals, levellers, bumpers and dock lights ----------
    const N = 22; const pitch = 6.2; const x0 = -((N - 1) * pitch) / 2 - 8;
    const doorAt = (i) => x0 + i * pitch;
    const inst = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m); }); hall.add(im); return im; };
    const idx = [...Array(N).keys()];
    inst(new THREE.BoxGeometry(3.9, 4.4, 0.7), M.paint("#1d2126", 0.85, 0), idx.map((i) => [doorAt(i), 1.2 + 2.2, front + 0.35]));     // seals
    inst(new THREE.BoxGeometry(3.0, 3.1, 0.12), M.cladding("#d9dde2", { ribs: 6, repeat: [0.5, 1], rough: 0.5, metal: 0.3 }), idx.map((i) => [doorAt(i), 1.25 + 1.55, front + 0.72]));
    inst(new THREE.BoxGeometry(3.2, 1.25, 1.4), M.concrete({ color: "#9ea3a8" }), idx.map((i) => [doorAt(i), 0.62, front + 0.7]));            // dock plates
    inst(new THREE.BoxGeometry(0.3, 0.45, 0.25), M.rubber(), idx.flatMap((i) => [[doorAt(i) - 1.2, 0.9, front + 1.5], [doorAt(i) + 1.2, 0.9, front + 1.5]]));
    inst(new THREE.BoxGeometry(0.35, 0.22, 0.5), dark ? M.lamp("#ffe6b8", 3.5) : M.paint("#4b5563", 0.4, 0.5), idx.map((i) => [doorAt(i), 6.4, front + 0.3]));

    // trailers backed onto about a third of the doors (cab-less and with tractors)
    const docked = [1, 2, 4, 7, 8, 11, 14, 15, 18, 20];
    const rig = K.truck({ trailerColor: "#eef1f4" });
    K.instances(rig, docked.map((i) => ({ x: doorAt(i), z: front + 1.4 + 6.8 + 0.2, ry: -Math.PI / 2 })), scene);
    const trailer = K.truck({ cab: false, trailerColor: "#e5e9ee" });
    const parked = [...Array(14).keys()].map((i) => ({ x: -67.5 + i * 5, z: 82, ry: -Math.PI / 2 }));
    K.instances(trailer, parked.filter((_, i) => ![3, 9].includes(i)), scene);

    // ---------- glazed office block and entrance canopy at the front corner ----------
    const office = new THREE.Group(); office.position.set(L / 2 - 8, 0, front + 6); scene.add(office);
    K.box(22, 10, 12, M.glass("#22364d"), 0, 0, 0, office);
    for (let k = 1; k < 3; k++) K.box(22.1, 0.35, 12.1, M.paint("#e5e7eb", 0.5, 0.3), 0, k * 3.4, 0, office);
    for (let k = -5; k <= 5; k++) K.box(0.22, 10, 12.1, M.paint("#2b3138", 0.5, 0.5), k * 2.1, 0, 0, office);
    K.box(22.6, 0.6, 12.6, M.paint("#2b3138", 0.5, 0.5), 0, 10, 0, office);
    K.box(10, 0.4, 6, M.paint("#2b3138", 0.5, 0.5), -2, 4.2, 8.5, office);                                // canopy
    for (const s of [-1, 1]) K.box(0.3, 4.2, 0.3, M.paint("#2b3138", 0.5, 0.5), -2 + s * 4.6, 0, 11.2, office);
    K.box(14, 0.3, 8, M.concrete(), -2, 0, 9.5, office);

    // ---------- site: fence, light poles, cars, trees ----------
    const fence = K.fence(240, scene); fence.position.set(0, 0, 100);
    const fence2 = K.fence(150, scene); fence2.rotation.y = Math.PI / 2; fence2.position.set(-122, 0, 25);
    for (let i = 0; i < 8; i++) { const p = K.lightPole(11, dark, scene); p.position.set(-90 + i * 26, 0, front + 22); p.rotation.y = Math.PI / 2; }
    for (let i = 0; i < 10; i++) K.tree(-118 + (i % 2) * 4, -40 + i * 13, scene, 1.3, i + 3);
    for (let i = 0; i < 6; i++) K.tree(100 + (i % 3) * 7, 50 + Math.floor(i / 3) * 12, scene, 1.4, i + 20);
    const car = new THREE.Group(); K.mesh(K.roundedBox(4.4, 1.05, 1.85, 0.3), M.paint("#5b6470", 0.25, 0.6), 0, 0.85, 0, car); K.mesh(K.roundedBox(2.4, 0.8, 1.7, 0.3), M.glass("#1c2a3a"), -0.2, 1.55, 0, car); K.axle(car, 1.35, 0.33, 1.6, 0.2); K.axle(car, -1.35, 0.33, 1.6, 0.2);
    K.instances(car, [...Array(12).keys()].map((i) => ({ x: 64 + (i % 6) * 3.2, z: 70 + Math.floor(i / 6) * 8, ry: Math.PI / 2 })), scene);
  }
};
