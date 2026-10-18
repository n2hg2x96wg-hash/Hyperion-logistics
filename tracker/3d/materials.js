// Physically based materials for the 3D scenes. Every texture is generated here on a canvas from seeded noise, so the
// scenes need no image downloads and carry no third-party licences. Textures and materials are cached and disposed
// together with the scene.
export function createMaterials(THREE, renderer) {
  const cache = new Map(); const textures = [];
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);

  // ---------- noise ----------
  const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function noise(size, grid, seed) { // tileable value noise, 0..1
    const r = rng(seed); const g = Array.from({ length: grid * grid }, r);
    const at = (x, y) => g[((y % grid + grid) % grid) * grid + ((x % grid + grid) % grid)];
    const s = (t) => t * t * (3 - 2 * t);
    return (px, py) => { const fx = (px / size) * grid; const fy = (py / size) * grid; const x = Math.floor(fx); const y = Math.floor(fy); const u = s(fx - x); const v = s(fy - y);
      return (at(x, y) * (1 - u) + at(x + 1, y) * u) * (1 - v) + (at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u) * v; };
  }
  const fbm = (size, seed, octaves = 4, base = 4) => { const ns = Array.from({ length: octaves }, (_, i) => noise(size, base << i, seed + i * 97));
    return (x, y) => { let a = 0; let w = 0.5; let tot = 0; for (const n of ns) { a += n(x, y) * w; tot += w; w *= 0.5; } return a / tot; }; };

  // ---------- canvas -> texture ----------
  function pixels(size, fn) { // fn(x, y) -> [r, g, b] 0..255
    const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d"); const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const [r, gg, b] = fn(x, y); const i = (y * size + x) * 4; img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0); return c;
  }
  function tex(canvas, { srgb = true, repeat = [1, 1] } = {}) {
    const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; textures.push(t); return t;
  }
  function normalFrom(size, h, strength = 2) { // height function (0..1) -> tangent-space normal map
    return pixels(size, (x, y) => {
      const dx = (h((x + 1) % size, y) - h((x - 1 + size) % size, y)) * strength; const dy = (h(x, (y + 1) % size) - h(x, (y - 1 + size) % size)) * strength;
      const l = Math.hypot(dx, dy, 1); return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
    });
  }
  const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const hex = (c) => new THREE.Color(c);
  const tint = (col, k) => [col.r * 255 * k, col.g * 255 * k, col.b * 255 * k].map((v) => Math.max(0, Math.min(255, v)));

  // trapezoidal sheet profile: flat crowns and valleys with sloped webs (cladding, container walls)
  const ribProfile = (u) => { const f = u % 1; return f < 0.32 ? 1 : f < 0.5 ? 1 - (f - 0.32) / 0.18 : f < 0.82 ? 0 : (f - 0.82) / 0.18; };

  const api = {
    /** Corrugated steel cladding. ribs = ribs across one texture repeat. */
    cladding(color = "#3a3f47", { ribs = 16, repeat = [1, 1], rough = 0.48, metal = 0.45 } = {}) {
      return once(`clad${color}${ribs}${repeat}`, () => {
        const S = 256; const base = hex(color); const n = fbm(S, 11, 3, 2); const streak = noise(S, 32, 5);
        const map = pixels(S, (x, y) => { const p = ribProfile((x / S) * ribs); const k = 0.86 + p * 0.16 + (n(x, y) - 0.5) * 0.08 - (streak(x, 0) - 0.5) * 0.05 * (y / S); return tint(base, k); });
        const nm = normalFrom(S, (x) => ribProfile((x / S) * ribs), 5);
        return new THREE.MeshStandardMaterial({ color: "#ffffff", map: tex(map, { repeat }), normalMap: tex(nm, { srgb: false, repeat }), normalScale: new THREE.Vector2(0.75, 0.75), roughness: rough, metalness: metal });
      });
    },
    /** Shipping-container wall: white texture tinted per instance (instanceColor). */
    container() {
      return once("container", () => {
        const S = 256; const n = fbm(S, 23, 3, 4); const rust = fbm(S, 31, 4, 3);
        const map = pixels(S, (x, y) => { const p = ribProfile((x / S) * 12); const k = 0.82 + p * 0.18 + (n(x, y) - 0.5) * 0.12; const r = rust(x, y) > 0.68 ? 0.82 : 1;
          const edge = y < 6 || y > S - 7 ? 0.7 : 1; return [255 * k * edge, 255 * k * r * edge, 255 * k * r * r * edge]; });
        const nm = normalFrom(S, (x) => ribProfile((x / S) * 12), 4);
        return new THREE.MeshStandardMaterial({ color: "#ffffff", map: tex(map), normalMap: tex(nm, { srgb: false }), roughness: 0.62, metalness: 0.25 });
      });
    },
    concrete({ repeat = [1, 1], joints = 4, color = "#a9adb2" } = {}) {
      return once(`concrete${repeat}${joints}${color}`, () => {
        const S = 512; const n = fbm(S, 41, 5, 4); const c = hex(color);
        const map = pixels(S, (x, y) => { const j = (x % (S / joints) < 2 || y % (S / joints) < 2) ? 0.72 : 1; const k = (0.84 + n(x, y) * 0.28) * j; return tint(c, k); });
        const rough = pixels(S, (x, y) => { const v = 200 + n(x, y) * 55; return [v, v, v]; });
        return new THREE.MeshStandardMaterial({ map: tex(map, { repeat }), roughnessMap: tex(rough, { srgb: false, repeat }), roughness: 1, metalness: 0 });
      });
    },
    asphalt({ repeat = [1, 1], wet = false } = {}) {
      return once(`asphalt${repeat}${wet}`, () => {
        const S = 512; const n = fbm(S, 53, 5, 8); const grit = noise(S, 128, 59);
        const map = pixels(S, (x, y) => { const v = 52 + n(x, y) * 26 + (grit(x, y) - 0.5) * 22; return [v, v + 1, v + 3]; });
        return new THREE.MeshStandardMaterial({ map: tex(map, { repeat }), roughness: wet ? 0.38 : 0.92, metalness: wet ? 0.08 : 0 });
      });
    },
    grass({ repeat = [1, 1] } = {}) {
      return once(`grass${repeat}`, () => {
        const S = 512; const n = fbm(S, 61, 5, 2); const blade = noise(S, 160, 67);
        const map = pixels(S, (x, y) => { const k = 0.82 + (n(x, y) - 0.5) * 0.22 + (blade(x, y) - 0.5) * 0.12; return [86 * k, 112 * k, 62 * k]; });
        return new THREE.MeshStandardMaterial({ map: tex(map, { repeat }), roughness: 1, metalness: 0 });
      });
    },
    cardboard() {
      return once("cardboard", () => {
        const S = 256; const n = fbm(S, 71, 4, 6); const fib = noise(S, 160, 73);
        const map = pixels(S, (x, y) => { const tape = Math.abs(x - S / 2) < S * 0.07 ? 1.18 : 1; const k = (0.86 + n(x, y) * 0.18 + (fib(x, y) - 0.5) * 0.06) * tape; return [196 * k, 150 * k, 98 * k]; });
        return new THREE.MeshStandardMaterial({ map: tex(map), roughness: 0.86, metalness: 0 });
      });
    },
    wood() {
      return once("wood", () => {
        const S = 256; const n = fbm(S, 81, 4, 3); const grain = noise(S, 64, 83);
        const map = pixels(S, (x, y) => { const g = Math.sin((x / S) * 40 + n(x, y) * 8) * 0.5 + 0.5; const k = 0.78 + g * 0.18 + (grain(x, y) - 0.5) * 0.1; return [184 * k, 140 * k, 92 * k]; });
        return new THREE.MeshStandardMaterial({ map: tex(map), roughness: 0.9, metalness: 0 });
      });
    },
    /** Plain painted / coated surface. */
    paint(color, rough = 0.5, metal = 0.1, extra = {}) {
      return once(`paint${color}${rough}${metal}${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
    },
    glass(color = "#1e3350") { return once(`glass${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.4 })); },
    rubber() { return once("rubber", () => new THREE.MeshStandardMaterial({ color: "#16181c", roughness: 0.88, metalness: 0 })); },
    chrome() { return once("chrome", () => new THREE.MeshStandardMaterial({ color: "#d7dce2", roughness: 0.18, metalness: 1 })); },
    lamp(color = "#fff4d6", intensity = 2.5) { return once(`lamp${color}${intensity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })); },
    noise: fbm,
    dispose() { textures.forEach((t) => t.dispose()); cache.forEach((m) => m.dispose?.()); cache.clear(); }
  };
  return api;
}
