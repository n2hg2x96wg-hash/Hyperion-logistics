// Worldwide freight connections shown on the homepage globe (ui/network-globe.js).
// This is a network VISUALISATION of well-known international freight corridors, not shipment data and not a list of
// lanes Hyperion has confirmed as a service: nothing here carries a tracking code, status, transport mode or count.
// To add a city, add one HUBS line (city-centre coordinates); to add a connection, add one [fromId, toId] pair.

export const REGIONS = ["Africa", "Europe", "Middle East", "Asia", "North America", "South America", "Oceania"];

export const HUBS = [
  // Africa
  { id: "lagos", city: "Lagos", country: "Nigeria", region: "Africa", lat: 6.45, lng: 3.39 },
  { id: "accra", city: "Accra", country: "Ghana", region: "Africa", lat: 5.6, lng: -0.19 },
  { id: "abidjan", city: "Abidjan", country: "Côte d'Ivoire", region: "Africa", lat: 5.32, lng: -4.03 },
  { id: "dakar", city: "Dakar", country: "Senegal", region: "Africa", lat: 14.72, lng: -17.47 },
  { id: "casablanca", city: "Casablanca", country: "Morocco", region: "Africa", lat: 33.57, lng: -7.59 },
  { id: "cairo", city: "Cairo", country: "Egypt", region: "Africa", lat: 30.04, lng: 31.24 },
  { id: "nairobi", city: "Nairobi", country: "Kenya", region: "Africa", lat: -1.29, lng: 36.82 },
  { id: "mombasa", city: "Mombasa", country: "Kenya", region: "Africa", lat: -4.04, lng: 39.67 },
  { id: "dar", city: "Dar es Salaam", country: "Tanzania", region: "Africa", lat: -6.79, lng: 39.21 },
  { id: "durban", city: "Durban", country: "South Africa", region: "Africa", lat: -29.86, lng: 31.02 },
  { id: "johannesburg", city: "Johannesburg", country: "South Africa", region: "Africa", lat: -26.2, lng: 28.05 },
  { id: "luanda", city: "Luanda", country: "Angola", region: "Africa", lat: -8.84, lng: 13.23 },
  { id: "addis", city: "Addis Ababa", country: "Ethiopia", region: "Africa", lat: 9.03, lng: 38.74 },
  { id: "lome", city: "Lomé", country: "Togo", region: "Africa", lat: 6.13, lng: 1.22 },
  { id: "douala", city: "Douala", country: "Cameroon", region: "Africa", lat: 4.05, lng: 9.7 },
  { id: "djibouti", city: "Djibouti", country: "Djibouti", region: "Africa", lat: 11.59, lng: 43.15 },
  { id: "tangier", city: "Tangier", country: "Morocco", region: "Africa", lat: 35.76, lng: -5.83 },
  { id: "kigali", city: "Kigali", country: "Rwanda", region: "Africa", lat: -1.95, lng: 30.06 },
  // Europe
  { id: "london", city: "London", country: "United Kingdom", region: "Europe", lat: 51.51, lng: -0.13 },
  { id: "rotterdam", city: "Rotterdam", country: "Netherlands", region: "Europe", lat: 51.92, lng: 4.48 },
  { id: "amsterdam", city: "Amsterdam", country: "Netherlands", region: "Europe", lat: 52.37, lng: 4.9 },
  { id: "antwerp", city: "Antwerp", country: "Belgium", region: "Europe", lat: 51.22, lng: 4.4 },
  { id: "hamburg", city: "Hamburg", country: "Germany", region: "Europe", lat: 53.55, lng: 9.99 },
  { id: "frankfurt", city: "Frankfurt", country: "Germany", region: "Europe", lat: 50.11, lng: 8.68 },
  { id: "paris", city: "Paris", country: "France", region: "Europe", lat: 48.86, lng: 2.35 },
  { id: "madrid", city: "Madrid", country: "Spain", region: "Europe", lat: 40.42, lng: -3.7 },
  { id: "milan", city: "Milan", country: "Italy", region: "Europe", lat: 45.46, lng: 9.19 },
  { id: "istanbul", city: "Istanbul", country: "Türkiye", region: "Europe", lat: 41.01, lng: 28.98 },
  { id: "lisbon", city: "Lisbon", country: "Portugal", region: "Europe", lat: 38.72, lng: -9.14 },
  { id: "valencia", city: "Valencia", country: "Spain", region: "Europe", lat: 39.47, lng: -0.38 },
  { id: "piraeus", city: "Piraeus", country: "Greece", region: "Europe", lat: 37.94, lng: 23.65 },
  { id: "gdansk", city: "Gdańsk", country: "Poland", region: "Europe", lat: 54.35, lng: 18.65 },
  { id: "felixstowe", city: "Felixstowe", country: "United Kingdom", region: "Europe", lat: 51.96, lng: 1.35 },
  { id: "lehavre", city: "Le Havre", country: "France", region: "Europe", lat: 49.49, lng: 0.11 },
  // Middle East
  { id: "dubai", city: "Dubai", country: "UAE", region: "Middle East", lat: 25.2, lng: 55.27 },
  { id: "doha", city: "Doha", country: "Qatar", region: "Middle East", lat: 25.29, lng: 51.53 },
  { id: "jeddah", city: "Jeddah", country: "Saudi Arabia", region: "Middle East", lat: 21.49, lng: 39.19 },
  { id: "abudhabi", city: "Abu Dhabi", country: "UAE", region: "Middle East", lat: 24.45, lng: 54.38 },
  { id: "riyadh", city: "Riyadh", country: "Saudi Arabia", region: "Middle East", lat: 24.71, lng: 46.68 },
  { id: "salalah", city: "Salalah", country: "Oman", region: "Middle East", lat: 17.02, lng: 54.09 },
  // Asia
  { id: "shanghai", city: "Shanghai", country: "China", region: "Asia", lat: 31.23, lng: 121.47 },
  { id: "shenzhen", city: "Shenzhen", country: "China", region: "Asia", lat: 22.54, lng: 114.06 },
  { id: "hongkong", city: "Hong Kong", country: "Hong Kong SAR", region: "Asia", lat: 22.32, lng: 114.17 },
  { id: "singapore", city: "Singapore", country: "Singapore", region: "Asia", lat: 1.35, lng: 103.82 },
  { id: "tokyo", city: "Tokyo", country: "Japan", region: "Asia", lat: 35.68, lng: 139.69 },
  { id: "busan", city: "Busan", country: "South Korea", region: "Asia", lat: 35.18, lng: 129.08 },
  { id: "mumbai", city: "Mumbai", country: "India", region: "Asia", lat: 19.08, lng: 72.88 },
  { id: "delhi", city: "New Delhi", country: "India", region: "Asia", lat: 28.61, lng: 77.21 },
  { id: "bangkok", city: "Bangkok", country: "Thailand", region: "Asia", lat: 13.76, lng: 100.5 },
  { id: "hochiminh", city: "Ho Chi Minh City", country: "Vietnam", region: "Asia", lat: 10.82, lng: 106.63 },
  { id: "ningbo", city: "Ningbo", country: "China", region: "Asia", lat: 29.87, lng: 121.54 },
  { id: "qingdao", city: "Qingdao", country: "China", region: "Asia", lat: 36.07, lng: 120.38 },
  { id: "osaka", city: "Osaka", country: "Japan", region: "Asia", lat: 34.69, lng: 135.5 },
  { id: "kaohsiung", city: "Kaohsiung", country: "Taiwan", region: "Asia", lat: 22.62, lng: 120.3 },
  { id: "colombo", city: "Colombo", country: "Sri Lanka", region: "Asia", lat: 6.93, lng: 79.86 },
  { id: "chennai", city: "Chennai", country: "India", region: "Asia", lat: 13.08, lng: 80.27 },
  { id: "karachi", city: "Karachi", country: "Pakistan", region: "Asia", lat: 24.86, lng: 67.01 },
  { id: "jakarta", city: "Jakarta", country: "Indonesia", region: "Asia", lat: -6.21, lng: 106.85 },
  { id: "manila", city: "Manila", country: "Philippines", region: "Asia", lat: 14.6, lng: 120.98 },
  { id: "portklang", city: "Port Klang", country: "Malaysia", region: "Asia", lat: 3.0, lng: 101.39 },
  // North America
  { id: "newyork", city: "New York", country: "USA", region: "North America", lat: 40.71, lng: -74.01 },
  { id: "losangeles", city: "Los Angeles", country: "USA", region: "North America", lat: 34.05, lng: -118.24 },
  { id: "chicago", city: "Chicago", country: "USA", region: "North America", lat: 41.88, lng: -87.63 },
  { id: "houston", city: "Houston", country: "USA", region: "North America", lat: 29.76, lng: -95.37 },
  { id: "miami", city: "Miami", country: "USA", region: "North America", lat: 25.76, lng: -80.19 },
  { id: "toronto", city: "Toronto", country: "Canada", region: "North America", lat: 43.65, lng: -79.38 },
  { id: "vancouver", city: "Vancouver", country: "Canada", region: "North America", lat: 49.28, lng: -123.12 },
  { id: "mexicocity", city: "Mexico City", country: "Mexico", region: "North America", lat: 19.43, lng: -99.13 },
  { id: "seattle", city: "Seattle", country: "USA", region: "North America", lat: 47.61, lng: -122.33 },
  { id: "savannah", city: "Savannah", country: "USA", region: "North America", lat: 32.08, lng: -81.09 },
  { id: "atlanta", city: "Atlanta", country: "USA", region: "North America", lat: 33.75, lng: -84.39 },
  { id: "montreal", city: "Montreal", country: "Canada", region: "North America", lat: 45.5, lng: -73.57 },
  { id: "panama", city: "Panama City", country: "Panama", region: "North America", lat: 8.98, lng: -79.52 },
  // South America
  { id: "saopaulo", city: "São Paulo", country: "Brazil", region: "South America", lat: -23.55, lng: -46.63 },
  { id: "santos", city: "Santos", country: "Brazil", region: "South America", lat: -23.96, lng: -46.33 },
  { id: "buenosaires", city: "Buenos Aires", country: "Argentina", region: "South America", lat: -34.6, lng: -58.38 },
  { id: "santiago", city: "Santiago", country: "Chile", region: "South America", lat: -33.45, lng: -70.67 },
  { id: "lima", city: "Lima", country: "Peru", region: "South America", lat: -12.05, lng: -77.04 },
  { id: "bogota", city: "Bogotá", country: "Colombia", region: "South America", lat: 4.71, lng: -74.07 },
  { id: "cartagena", city: "Cartagena", country: "Colombia", region: "South America", lat: 10.39, lng: -75.48 },
  { id: "montevideo", city: "Montevideo", country: "Uruguay", region: "South America", lat: -34.9, lng: -56.16 },
  { id: "guayaquil", city: "Guayaquil", country: "Ecuador", region: "South America", lat: -2.17, lng: -79.92 },
  // Oceania
  { id: "sydney", city: "Sydney", country: "Australia", region: "Oceania", lat: -33.87, lng: 151.21 },
  { id: "melbourne", city: "Melbourne", country: "Australia", region: "Oceania", lat: -37.81, lng: 144.96 },
  { id: "auckland", city: "Auckland", country: "New Zealand", region: "Oceania", lat: -36.85, lng: 174.76 },
  { id: "brisbane", city: "Brisbane", country: "Australia", region: "Oceania", lat: -27.47, lng: 153.03 },
  { id: "perth", city: "Perth", country: "Australia", region: "Oceania", lat: -31.95, lng: 115.86 }
];

const CURATED = [
  // the owner's starting examples
  ["shanghai", "newyork"], ["frankfurt", "london"], ["tokyo", "sydney"], ["dubai", "lagos"],
  ["singapore", "rotterdam"], ["toronto", "amsterdam"], ["hongkong", "singapore"], ["nairobi", "dubai"],
  // Lagos and West Africa
  ["lagos", "london"], ["lagos", "shanghai"], ["lagos", "houston"], ["lagos", "rotterdam"], ["lagos", "johannesburg"],
  ["lagos", "saopaulo"], ["lagos", "istanbul"], ["lagos", "mumbai"], ["lagos", "accra"], ["lagos", "newyork"],
  ["accra", "antwerp"], ["accra", "dubai"], ["abidjan", "paris"], ["abidjan", "shenzhen"], ["dakar", "madrid"],
  ["dakar", "miami"], ["casablanca", "milan"], ["casablanca", "newyork"],
  // East, North and Southern Africa
  ["nairobi", "amsterdam"], ["nairobi", "mumbai"], ["mombasa", "jeddah"], ["mombasa", "singapore"],
  ["dar", "dubai"], ["dar", "shanghai"], ["addis", "frankfurt"], ["addis", "lagos"], ["cairo", "hamburg"],
  ["cairo", "jeddah"], ["durban", "busan"], ["durban", "santos"], ["johannesburg", "london"], ["johannesburg", "sydney"],
  ["luanda", "rotterdam"], ["luanda", "houston"],
  // Europe, Middle East and Asia
  ["rotterdam", "newyork"], ["hamburg", "shanghai"], ["antwerp", "mumbai"], ["london", "toronto"], ["paris", "tokyo"],
  ["istanbul", "frankfurt"], ["milan", "hongkong"], ["madrid", "bogota"], ["dubai", "london"], ["doha", "chicago"],
  ["jeddah", "delhi"], ["shenzhen", "losangeles"], ["busan", "vancouver"], ["bangkok", "frankfurt"],
  ["hochiminh", "losangeles"], ["mumbai", "dubai"], ["delhi", "london"], ["tokyo", "chicago"], ["singapore", "sydney"],
  // the Americas and Oceania
  ["newyork", "saopaulo"], ["miami", "bogota"], ["houston", "mexicocity"], ["losangeles", "auckland"],
  ["mexicocity", "madrid"], ["santiago", "shanghai"], ["lima", "losangeles"], ["buenosaires", "rotterdam"],
  ["santos", "hamburg"], ["melbourne", "singapore"], ["auckland", "sydney"], ["vancouver", "tokyo"], ["chicago", "frankfurt"]
];

export const hubById = new Map(HUBS.map((h) => [h.id, h]));

/**
 * Hand-picked corridors plus generated cross-region pairs, so the showcase has hundreds of combinations without a
 * hand-maintained list for each city: every hub is paired with a few hubs on other continents (deterministic, so the
 * dataset is the same on every visit and testable). Duplicates in either direction are dropped.
 */
function buildConnections(curated, perHub = 4) {
  const seen = new Set(); const out = [];
  const add = (a, b) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (a === b || seen.has(k)) return; seen.add(k); out.push([a, b]); };
  for (const [a, b] of curated) add(a, b);
  const n = HUBS.length;
  HUBS.forEach((h, i) => {
    let made = 0;
    for (let step = 1; step < n && made < perHub; step++) {
      const o = HUBS[(i * 7 + step * 11) % n];
      if (o.region === h.region) continue;
      const before = out.length; add(h.id, o.id); if (out.length > before) made++;
    }
  });
  return out;
}
export const CONNECTIONS = buildConnections(CURATED);
const regionPair = ([a, b]) => [hubById.get(a).region, hubById.get(b).region].sort().join("|");

/** Great-circle distance in km (a geographic fact about the two cities, not a shipment figure). */
export function distanceKm(a, b) {
  const r = Math.PI / 180; const dLat = (b.lat - a.lat) * r; const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Picks connections forever without a fixed cycle: a shuffle bag (every connection appears once per pass, passes are
 * reshuffled), skipping a candidate that repeats one of the last `window` picks, would make the visible set all one region,
 * or repeats a continent pairing already on screen or among the last three picks. `random` is injectable for tests.
 */
export function createScheduler({ connections = CONNECTIONS, window = 24, random = Math.random } = {}) {
  let bag = []; const recent = []; const recentPairs = [];
  const key = ([a, b]) => `${a}>${b}`;
  const refill = () => {
    bag = connections.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  };
  return {
    /** Next connection, given the connections currently on screen. */
    next(visible = []) {
      const shown = new Set(visible.map(key));
      const regions = new Set(visible.flatMap(([a, b]) => [hubById.get(a).region, hubById.get(b).region]));
      for (let tries = 0; tries < connections.length * 3; tries++) {
        if (!bag.length) refill();
        const c = bag.pop(); const k = key(c);
        const relaxed = tries >= connections.length; // the rules only bend for very small datasets
        if (shown.has(k) || (!relaxed && recent.includes(k))) { bag.unshift(c); continue; }
        const r = [hubById.get(c[0]).region, hubById.get(c[1]).region];
        if (!relaxed && visible.length >= 2 && regions.size === 1 && r.every((x) => regions.has(x))) { bag.unshift(c); continue; }
        // the same continent pairing should not dominate: not one already on screen or among the last few picks
        const rp = regionPair(c);
        if (!relaxed && (visible.some((v) => regionPair(v) === rp) || recentPairs.includes(rp))) { bag.unshift(c); continue; }
        recent.push(k); if (recent.length > window) recent.shift();
        recentPairs.push(rp); if (recentPairs.length > 3) recentPairs.shift();
        return c;
      }
      return connections[Math.floor(random() * connections.length)];
    }
  };
}
