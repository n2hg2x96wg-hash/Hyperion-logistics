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
  // Middle East
  { id: "dubai", city: "Dubai", country: "UAE", region: "Middle East", lat: 25.2, lng: 55.27 },
  { id: "doha", city: "Doha", country: "Qatar", region: "Middle East", lat: 25.29, lng: 51.53 },
  { id: "jeddah", city: "Jeddah", country: "Saudi Arabia", region: "Middle East", lat: 21.49, lng: 39.19 },
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
  // North America
  { id: "newyork", city: "New York", country: "USA", region: "North America", lat: 40.71, lng: -74.01 },
  { id: "losangeles", city: "Los Angeles", country: "USA", region: "North America", lat: 34.05, lng: -118.24 },
  { id: "chicago", city: "Chicago", country: "USA", region: "North America", lat: 41.88, lng: -87.63 },
  { id: "houston", city: "Houston", country: "USA", region: "North America", lat: 29.76, lng: -95.37 },
  { id: "miami", city: "Miami", country: "USA", region: "North America", lat: 25.76, lng: -80.19 },
  { id: "toronto", city: "Toronto", country: "Canada", region: "North America", lat: 43.65, lng: -79.38 },
  { id: "vancouver", city: "Vancouver", country: "Canada", region: "North America", lat: 49.28, lng: -123.12 },
  { id: "mexicocity", city: "Mexico City", country: "Mexico", region: "North America", lat: 19.43, lng: -99.13 },
  // South America
  { id: "saopaulo", city: "São Paulo", country: "Brazil", region: "South America", lat: -23.55, lng: -46.63 },
  { id: "santos", city: "Santos", country: "Brazil", region: "South America", lat: -23.96, lng: -46.33 },
  { id: "buenosaires", city: "Buenos Aires", country: "Argentina", region: "South America", lat: -34.6, lng: -58.38 },
  { id: "santiago", city: "Santiago", country: "Chile", region: "South America", lat: -33.45, lng: -70.67 },
  { id: "lima", city: "Lima", country: "Peru", region: "South America", lat: -12.05, lng: -77.04 },
  { id: "bogota", city: "Bogotá", country: "Colombia", region: "South America", lat: 4.71, lng: -74.07 },
  // Oceania
  { id: "sydney", city: "Sydney", country: "Australia", region: "Oceania", lat: -33.87, lng: 151.21 },
  { id: "melbourne", city: "Melbourne", country: "Australia", region: "Oceania", lat: -37.81, lng: 144.96 },
  { id: "auckland", city: "Auckland", country: "New Zealand", region: "Oceania", lat: -36.85, lng: 174.76 }
];

export const CONNECTIONS = [
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

/** Great-circle distance in km (a geographic fact about the two cities, not a shipment figure). */
export function distanceKm(a, b) {
  const r = Math.PI / 180; const dLat = (b.lat - a.lat) * r; const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Picks connections forever without a fixed cycle: a shuffle bag (every connection appears once per pass, passes are
 * reshuffled), skipping a candidate that repeats one of the last `window` picks or that would make the visible set all
 * one region. `random` is injectable for tests.
 */
export function createScheduler({ connections = CONNECTIONS, window = 12, random = Math.random } = {}) {
  let bag = []; const recent = [];
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
        recent.push(k); if (recent.length > window) recent.shift();
        return c;
      }
      return connections[Math.floor(random() * connections.length)];
    }
  };
}
