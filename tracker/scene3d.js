// Interactive 3D illustration for a tracking stage. The tracker loads this module when the scene first scrolls into
// view; Three.js comes from the CDN at that point and only the module for the requested scene is fetched.
// Every scene is built in code (tracker/3d/) and shows a TYPICAL place or vehicle for the recorded stage: it carries no
// shipment data, names, places or positions, and nothing moves along a route.
//
// Controls: drag to rotate (touch: sideways swipe only, so vertical swipes keep scrolling the page), pinch to zoom,
// wheel zoom only once the canvas has been clicked or focused, arrow keys and +/- on the focused canvas, and zoom(),
// reset() and setView() for the on-screen buttons. Rendering stops when the canvas is off-screen or the tab is hidden,
// a short frame-time check lightens or declines the scene on slow devices, and dispose() frees the GPU context.
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
export const SCENES = ["processing", "collection", "ship", "air", "road", "neutral", "facility", "customs", "delivery", "delivered"];

export async function createViewer(container, scene, { reducedMotion = false, animate = true } = {}) {
  if (!SCENES.includes(scene)) throw new Error("unknown scene");
  const core = await import("./3d/core.js");
  if (!core.webglAvailable()) throw new Error("webgl unavailable");
  const [THREE, mod] = await Promise.all([import(/* @vite-ignore */ THREE_URL), import(`./3d/scenes/${scene}.js`)]);
  // HX_3D_PERF_CHECK = false is for automated browsers, which render WebGL in software and would always be declined.
  return core.createStage(THREE, container, mod.default, { reducedMotion, animate, perfCheck: globalThis.HX_3D_PERF_CHECK !== false });
}
