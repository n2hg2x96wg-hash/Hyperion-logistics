// How a shipment travels, from recorded data only: "sea" | "air" | "road" | null.
// Single source of truth for the tracking page's 3D scene and the public homepage route cards.
//   1. A recorded service type that names the mode ("Ocean freight (FCL)", "Air freight", "Road haulage"...).
//   2. Otherwise only single-mode catalogue carriers: ocean lines sail, cargo airlines fly.
// Express, regional and custom carriers run several modes, so they say nothing on their own (null).
import { CARRIERS, carrierCategory, builtInCarrier } from "./carriers.js";

const MODE_WORDS = [
  [/\b(ocean|sea|vessel|maritime|fcl|lcl)\b/i, "sea"],
  [/\b(air|flight|airfreight|air freight)\b/i, "air"],
  [/\b(road|truck|trucking|ground|ltl|ftl|haulage)\b/i, "road"]
];
const MODE_BY_CATEGORY = { ocean: "sea", air: "air" };

export function transportMode({ serviceType, carrierName, carrierId, custom } = {}) {
  const svc = String(serviceType || "");
  for (const [re, mode] of MODE_WORDS) if (re.test(svc)) return mode;
  if (custom) return null;
  const name = String(carrierName || "").trim().toLowerCase();
  const c = builtInCarrier(carrierId) || (name ? CARRIERS.find((x) => x.name.toLowerCase() === name || x.id === name) : null);
  return c ? MODE_BY_CATEGORY[carrierCategory(c)] || null : null;
}
