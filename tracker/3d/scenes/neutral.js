// Neutral stage (mode not recorded, on hold, cancelled or an unknown status): palletised parcels in soft studio light
// on a plain backdrop. It deliberately shows no vehicle, place or movement.
export default {
  label: "parcels on a pallet",
  extent: 12, fog: [80, 260],
  limits: { min: 3.5, max: 18, minPitch: 0.05, maxPitch: 1.1 },
  views: [
    { id: "overview", label: "Overview", yaw: 0.7, pitch: 0.32, radius: 7.5, target: [0, 0.8, 0] },
    { id: "close", label: "Close", yaw: 0.35, pitch: 0.16, radius: 4.2, target: [0, 0.9, 0] },
    { id: "above", label: "Above", yaw: 0.9, pitch: 0.9, radius: 7, target: [0, 0.6, 0] }
  ],
  build({ THREE, scene, materials: M, kit: K }) {
    // seamless studio backdrop: a sheet that runs flat, curves up and becomes a wall
    const g = new THREE.PlaneGeometry(160, 60, 1, 120); const p = g.attributes.position; const R = 6; const arc = (R * Math.PI) / 2;
    for (let i = 0; i < p.count; i++) {
      const d = p.getY(i) + 30; let y = 0; let z = 14 - d;
      if (d > 22) { const a = Math.min(Math.PI / 2, (d - 22) / R); z = -8 - Math.sin(a) * R; y = R - Math.cos(a) * R + Math.max(0, d - 22 - arc); }
      p.setXYZ(i, p.getX(i), y, z);
    }
    g.computeVertexNormals(); K.mesh(g, M.paint("#d6dbe1", 0.9, 0), 0, 0, 0, scene).userData.noShadow = true;
    K.cyl(2.2, 2.3, 0.18, M.paint("#9aa3ad", 0.5, 0.4), 0, 0, 0, scene, 48);
    K.palletLoad(0, 0, scene, { layers: 3, seed: 3 }).position.y = 0.18;
    K.cartons([[-1.6, 0.18, 0.9, 0.5, 0.4], [1.5, 0.18, 1.1, 0.42, -0.3]], scene);
  }
};
