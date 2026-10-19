// Verified city table for the shipment map: city-centre coordinates of capitals and major freight cities, used only
// when a shipment's stored record has no coordinates for a place it names (e.g. "Los Angeles, California"). Points
// from here are always city level and are labelled as such; they are never presented as a GPS or carrier position.
// Every entry is checked against the Natural Earth country outlines in test/phase3.test.js.
// Isomorphic (browser + server). To add a city: [name, ISO country, lat, lng, optional aliases].
import { countryFromText } from "./countries.js";

const ROWS = [
  // North America
  ["Los Angeles", "US", 34.05, -118.24, ["la", "long beach"]], ["New York", "US", 40.71, -74.01, ["new york city", "nyc", "jfk", "newark"]],
  ["Chicago", "US", 41.88, -87.63], ["Houston", "US", 29.76, -95.37], ["Miami", "US", 25.76, -80.19], ["Atlanta", "US", 33.75, -84.39],
  ["Dallas", "US", 32.78, -96.8, ["fort worth", "dallas-fort worth"]], ["Seattle", "US", 47.61, -122.33, ["tacoma"]], ["San Francisco", "US", 37.77, -122.42, ["oakland"]],
  ["Savannah", "US", 32.08, -81.09], ["Memphis", "US", 35.15, -90.05], ["Louisville", "US", 38.25, -85.76], ["Washington", "US", 38.9, -77.04, ["washington dc", "washington d.c."]],
  ["Boston", "US", 42.36, -71.06], ["Philadelphia", "US", 39.95, -75.17], ["Baltimore", "US", 39.29, -76.61], ["Charleston", "US", 32.78, -79.93],
  ["New Orleans", "US", 29.95, -90.07], ["Denver", "US", 39.74, -104.99], ["Phoenix", "US", 33.45, -112.07], ["Las Vegas", "US", 36.17, -115.14],
  ["San Diego", "US", 32.72, -117.16], ["Portland", "US", 45.52, -122.68], ["Detroit", "US", 42.33, -83.05], ["Minneapolis", "US", 44.98, -93.27],
  ["Indianapolis", "US", 39.77, -86.16], ["Cincinnati", "US", 39.1, -84.51], ["Anchorage", "US", 61.22, -149.9], ["Honolulu", "US", 21.31, -157.86],
  ["Toronto", "CA", 43.65, -79.38], ["Vancouver", "CA", 49.28, -123.12], ["Montreal", "CA", 45.5, -73.57, ["montréal"]], ["Calgary", "CA", 51.05, -114.07],
  ["Ottawa", "CA", 45.42, -75.7], ["Halifax", "CA", 44.65, -63.58], ["Mexico City", "MX", 19.43, -99.13, ["ciudad de mexico", "cdmx"]], ["Guadalajara", "MX", 20.67, -103.35],
  ["Monterrey", "MX", 25.69, -100.32], ["Manzanillo", "MX", 19.05, -104.32], ["Panama City", "PA", 8.98, -79.52, ["panama"]], ["Colón", "PA", 9.36, -79.9, ["colon"]],
  ["Guatemala City", "GT", 14.63, -90.51], ["San José", "CR", 9.93, -84.08, ["san jose"]], ["Havana", "CU", 23.11, -82.37], ["Kingston", "JM", 18.02, -76.8],
  ["Santo Domingo", "DO", 18.49, -69.93], ["San Juan", "PR", 18.47, -66.11],
  // South America
  ["São Paulo", "BR", -23.55, -46.63, ["sao paulo"]], ["Santos", "BR", -23.96, -46.33], ["Rio de Janeiro", "BR", -22.91, -43.17, ["rio"]], ["Brasília", "BR", -15.79, -47.88, ["brasilia"]],
  ["Manaus", "BR", -3.12, -60.02], ["Buenos Aires", "AR", -34.6, -58.38], ["Santiago", "CL", -33.45, -70.67], ["Valparaíso", "CL", -33.05, -71.62, ["valparaiso"]],
  ["Lima", "PE", -12.05, -77.04, ["callao"]], ["Bogotá", "CO", 4.71, -74.07, ["bogota"]], ["Cartagena", "CO", 10.39, -75.48], ["Medellín", "CO", 6.24, -75.58, ["medellin"]],
  ["Quito", "EC", -0.18, -78.47], ["Guayaquil", "EC", -2.17, -79.92], ["Caracas", "VE", 10.49, -66.88], ["Montevideo", "UY", -34.9, -56.16],
  ["Asunción", "PY", -25.26, -57.58, ["asuncion"]], ["La Paz", "BO", -16.5, -68.15],
  // Europe
  ["London", "GB", 51.51, -0.13, ["heathrow"]], ["Felixstowe", "GB", 51.96, 1.35], ["Manchester", "GB", 53.48, -2.24], ["Birmingham", "GB", 52.49, -1.89],
  ["Southampton", "GB", 50.9, -1.4], ["Edinburgh", "GB", 55.95, -3.19], ["Dublin", "IE", 53.35, -6.26], ["Paris", "FR", 48.86, 2.35], ["Le Havre", "FR", 49.49, 0.11],
  ["Marseille", "FR", 43.3, 5.37], ["Lyon", "FR", 45.76, 4.84], ["Amsterdam", "NL", 52.37, 4.9, ["schiphol"]], ["Rotterdam", "NL", 51.92, 4.48],
  ["Brussels", "BE", 50.85, 4.35], ["Antwerp", "BE", 51.22, 4.4], ["Liège", "BE", 50.63, 5.57, ["liege"]], ["Luxembourg", "LU", 49.61, 6.13],
  ["Frankfurt", "DE", 50.11, 8.68], ["Hamburg", "DE", 53.55, 9.99], ["Berlin", "DE", 52.52, 13.4], ["Munich", "DE", 48.14, 11.58, ["münchen", "muenchen"]],
  ["Cologne", "DE", 50.94, 6.96, ["köln", "koln"]], ["Leipzig", "DE", 51.34, 12.37], ["Bremen", "DE", 53.08, 8.8], ["Düsseldorf", "DE", 51.23, 6.77, ["dusseldorf"]],
  ["Madrid", "ES", 40.42, -3.7], ["Barcelona", "ES", 41.39, 2.17], ["Valencia", "ES", 39.47, -0.38], ["Algeciras", "ES", 36.13, -5.45],
  ["Lisbon", "PT", 38.72, -9.14, ["lisboa"]], ["Porto", "PT", 41.15, -8.61], ["Milan", "IT", 45.46, 9.19, ["milano"]], ["Rome", "IT", 41.9, 12.5, ["roma"]],
  ["Genoa", "IT", 44.41, 8.93, ["genova"]], ["Naples", "IT", 40.85, 14.27, ["napoli"]], ["Zurich", "CH", 47.38, 8.54, ["zürich"]], ["Geneva", "CH", 46.2, 6.14],
  ["Vienna", "AT", 48.21, 16.37, ["wien"]], ["Prague", "CZ", 50.08, 14.44], ["Warsaw", "PL", 52.23, 21.01], ["Gdańsk", "PL", 54.35, 18.65, ["gdansk"]],
  ["Budapest", "HU", 47.5, 19.04], ["Bucharest", "RO", 44.43, 26.1], ["Sofia", "BG", 42.7, 23.32], ["Athens", "GR", 37.98, 23.73], ["Piraeus", "GR", 37.94, 23.65],
  ["Istanbul", "TR", 41.01, 28.98], ["Ankara", "TR", 39.93, 32.86], ["Copenhagen", "DK", 55.68, 12.57], ["Stockholm", "SE", 59.33, 18.07],
  ["Gothenburg", "SE", 57.71, 11.97, ["göteborg"]], ["Oslo", "NO", 59.91, 10.75], ["Helsinki", "FI", 60.17, 24.94], ["Riga", "LV", 56.95, 24.11],
  ["Tallinn", "EE", 59.44, 24.75], ["Vilnius", "LT", 54.69, 25.28], ["Kyiv", "UA", 50.45, 30.52, ["kiev"]], ["Odesa", "UA", 46.48, 30.72, ["odessa"]],
  ["Moscow", "RU", 55.76, 37.62], ["Saint Petersburg", "RU", 59.94, 30.31, ["st petersburg", "st. petersburg"]], ["Belgrade", "RS", 44.79, 20.45], ["Zagreb", "HR", 45.81, 15.98],
  // Middle East
  ["Dubai", "AE", 25.2, 55.27, ["jebel ali"]], ["Abu Dhabi", "AE", 24.45, 54.38], ["Sharjah", "AE", 25.35, 55.42], ["Doha", "QA", 25.29, 51.53],
  ["Riyadh", "SA", 24.71, 46.68], ["Jeddah", "SA", 21.49, 39.19], ["Dammam", "SA", 26.43, 50.1], ["Kuwait City", "KW", 29.38, 47.99, ["kuwait"]],
  ["Manama", "BH", 26.23, 50.59], ["Muscat", "OM", 23.59, 58.41], ["Salalah", "OM", 17.02, 54.09], ["Tel Aviv", "IL", 32.09, 34.78], ["Amman", "JO", 31.95, 35.93],
  ["Beirut", "LB", 33.89, 35.5], ["Baghdad", "IQ", 33.31, 44.36], ["Tehran", "IR", 35.69, 51.39], ["Bandar Abbas", "IR", 27.18, 56.27],
  // Africa
  ["Lagos", "NG", 6.45, 3.39, ["apapa", "ikeja"]], ["Abuja", "NG", 9.08, 7.4], ["Port Harcourt", "NG", 4.82, 7.03], ["Kano", "NG", 12.0, 8.52],
  ["Accra", "GH", 5.6, -0.19], ["Tema", "GH", 5.67, -0.02], ["Kumasi", "GH", 6.69, -1.62], ["Abidjan", "CI", 5.32, -4.03], ["Dakar", "SN", 14.72, -17.47],
  ["Lomé", "TG", 6.13, 1.22, ["lome"]], ["Cotonou", "BJ", 6.37, 2.39], ["Douala", "CM", 4.05, 9.7], ["Yaoundé", "CM", 3.85, 11.5, ["yaounde"]],
  ["Libreville", "GA", 0.39, 9.45], ["Freetown", "SL", 8.48, -13.23], ["Monrovia", "LR", 6.3, -10.8], ["Conakry", "GN", 9.64, -13.58], ["Bamako", "ML", 12.64, -8.0],
  ["Casablanca", "MA", 33.57, -7.59], ["Tangier", "MA", 35.76, -5.83, ["tanger"]], ["Rabat", "MA", 34.02, -6.84], ["Algiers", "DZ", 36.75, 3.06, ["alger"]],
  ["Tunis", "TN", 36.81, 10.18], ["Tripoli", "LY", 32.89, 13.19], ["Cairo", "EG", 30.04, 31.24], ["Alexandria", "EG", 31.2, 29.92], ["Port Said", "EG", 31.26, 32.3],
  ["Khartoum", "SD", 15.5, 32.56], ["Addis Ababa", "ET", 9.03, 38.74], ["Djibouti", "DJ", 11.59, 43.15], ["Nairobi", "KE", -1.29, 36.82], ["Mombasa", "KE", -4.04, 39.67],
  ["Kampala", "UG", 0.35, 32.58], ["Kigali", "RW", -1.95, 30.06], ["Dar es Salaam", "TZ", -6.79, 39.21], ["Zanzibar", "TZ", -6.16, 39.19], ["Lusaka", "ZM", -15.39, 28.32],
  ["Harare", "ZW", -17.83, 31.05], ["Maputo", "MZ", -25.97, 32.57], ["Johannesburg", "ZA", -26.2, 28.05], ["Durban", "ZA", -29.86, 31.02], ["Cape Town", "ZA", -33.92, 18.42],
  ["Port Elizabeth", "ZA", -33.96, 25.6, ["gqeberha"]], ["Pretoria", "ZA", -25.75, 28.19], ["Gaborone", "BW", -24.65, 25.91], ["Windhoek", "NA", -22.56, 17.08],
  ["Walvis Bay", "NA", -22.96, 14.51], ["Luanda", "AO", -8.84, 13.23], ["Kinshasa", "CD", -4.44, 15.27], ["Lubumbashi", "CD", -11.66, 27.48],
  ["Antananarivo", "MG", -18.88, 47.51], ["Port Louis", "MU", -20.16, 57.5],
  // Asia
  ["Shanghai", "CN", 31.23, 121.47], ["Beijing", "CN", 39.9, 116.41, ["peking"]], ["Shenzhen", "CN", 22.54, 114.06], ["Guangzhou", "CN", 23.13, 113.26, ["canton"]],
  ["Ningbo", "CN", 29.87, 121.54], ["Qingdao", "CN", 36.07, 120.38], ["Tianjin", "CN", 39.34, 117.36], ["Xiamen", "CN", 24.48, 118.09], ["Chengdu", "CN", 30.57, 104.07],
  ["Wuhan", "CN", 30.59, 114.31], ["Chongqing", "CN", 29.56, 106.55], ["Zhengzhou", "CN", 34.75, 113.63], ["Yiwu", "CN", 29.31, 120.08], ["Dalian", "CN", 38.91, 121.6],
  ["Hong Kong", "HK", 22.32, 114.17], ["Macau", "MO", 22.2, 113.54, ["macao"]], ["Taipei", "TW", 25.03, 121.57], ["Kaohsiung", "TW", 22.62, 120.3],
  ["Tokyo", "JP", 35.68, 139.69, ["narita", "haneda"]], ["Osaka", "JP", 34.69, 135.5], ["Yokohama", "JP", 35.44, 139.64], ["Nagoya", "JP", 35.18, 136.91], ["Kobe", "JP", 34.69, 135.2],
  ["Seoul", "KR", 37.57, 126.98], ["Incheon", "KR", 37.46, 126.71], ["Busan", "KR", 35.18, 129.08, ["pusan"]], ["Ulaanbaatar", "MN", 47.89, 106.91],
  ["Singapore", "SG", 1.35, 103.82], ["Kuala Lumpur", "MY", 3.14, 101.69], ["Port Klang", "MY", 3.0, 101.39], ["Penang", "MY", 5.41, 100.33, ["george town"]],
  ["Bangkok", "TH", 13.76, 100.5], ["Laem Chabang", "TH", 13.08, 100.88], ["Ho Chi Minh City", "VN", 10.82, 106.63, ["saigon", "ho chi minh"]], ["Hanoi", "VN", 21.03, 105.85],
  ["Haiphong", "VN", 20.86, 106.68, ["hai phong"]], ["Da Nang", "VN", 16.05, 108.2], ["Phnom Penh", "KH", 11.56, 104.92], ["Yangon", "MM", 16.84, 96.17, ["rangoon"]],
  ["Jakarta", "ID", -6.21, 106.85], ["Surabaya", "ID", -7.25, 112.75], ["Manila", "PH", 14.6, 120.98], ["Cebu", "PH", 10.32, 123.89],
  ["Mumbai", "IN", 19.08, 72.88, ["bombay", "nhava sheva"]], ["New Delhi", "IN", 28.61, 77.21, ["delhi"]], ["Chennai", "IN", 13.08, 80.27, ["madras"]],
  ["Kolkata", "IN", 22.57, 88.36, ["calcutta"]], ["Bengaluru", "IN", 12.97, 77.59, ["bangalore"]], ["Hyderabad", "IN", 17.39, 78.49], ["Ahmedabad", "IN", 23.02, 72.57],
  ["Karachi", "PK", 24.86, 67.01], ["Lahore", "PK", 31.55, 74.34], ["Islamabad", "PK", 33.68, 73.05], ["Dhaka", "BD", 23.81, 90.41], ["Chittagong", "BD", 22.36, 91.78, ["chattogram"]],
  ["Colombo", "LK", 6.93, 79.86], ["Kathmandu", "NP", 27.72, 85.32], ["Almaty", "KZ", 43.24, 76.95], ["Tashkent", "UZ", 41.3, 69.24],
  // Oceania
  ["Sydney", "AU", -33.87, 151.21], ["Melbourne", "AU", -37.81, 144.96], ["Brisbane", "AU", -27.47, 153.03], ["Perth", "AU", -31.95, 115.86, ["fremantle"]],
  ["Adelaide", "AU", -34.93, 138.6], ["Darwin", "AU", -12.46, 130.84], ["Auckland", "NZ", -36.85, 174.76], ["Wellington", "NZ", -41.29, 174.78],
  ["Christchurch", "NZ", -43.53, 172.64], ["Port Moresby", "PG", -9.44, 147.18], ["Suva", "FJ", -18.14, 178.44]
];

// region names → country, used only to narrow same-name cities ("Portland, Oregon"), never to place a point
const REGIONS = {
  US: ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana",
    "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
    "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
    "ca", "ny", "tx", "fl", "il", "wa", "ga", "nj", "pa", "ma", "or", "tn", "ky", "la", "dc"],
  CA: ["ontario", "quebec", "québec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia", "new brunswick", "on", "qc", "bc", "ab"]
};

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const PLACES = ROWS.map(([name, country, lat, lng, aliases = []]) => ({ name, country, lat, lng, keys: [...new Set([name, ...aliases].map(norm))] }));
const byKey = new Map();
for (const p of PLACES) for (const k of p.keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }

/** Countries the other parts of the text point at ("California" → US; "Georgia" → US or GE). Empty when none. */
function countryHints(parts) {
  const out = new Set();
  for (const part of parts) {
    const iso = countryFromText(part); if (iso) out.add(iso);
    const n = norm(part); for (const [iso2, list] of Object.entries(REGIONS)) if (list.includes(n)) out.add(iso2);
  }
  return out;
}
const result = (p) => ({ lat: p.lat, lng: p.lng, name: p.name, country: p.country, approx: true });

/**
 * "Los Angeles, California" → { lat, lng, name: "Los Angeles", country: "US", approx: true }; null when the text doesn't
 * name a city in the table, contradicts its country, or is ambiguous. City-level only: callers label it approximate.
 */
export function resolvePlace(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const parts = text.split(/[,;/|()]/).map((p) => p.trim()).filter(Boolean);
  const hints = countryHints(parts.slice(1));
  const fits = (p) => !hints.size || hints.has(p.country);
  for (const part of parts) {
    const list = (byKey.get(norm(part)) || []).filter(fits);
    if (list.length === 1) return result(list[0]);
  }
  // "Port of Shanghai, China" / "Shanghai Pudong Airport": a single known city name inside the text
  const t = ` ${norm(text)} `;
  const found = PLACES.filter((p) => fits(p) && p.keys.some((k) => k.length >= 4 && t.includes(` ${k} `)));
  return found.length === 1 ? result(found[0]) : null;
}
