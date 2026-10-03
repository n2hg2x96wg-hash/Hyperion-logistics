import { mergeCarriers } from "./shared/carriers.js";

// Built-in catalog (shared/carriers.js) merged with the Firestore `couriers` collection.
// Firestore records override built-ins with the same id; nothing is written or deleted by loading.
const FALLBACK_COURIERS = mergeCarriers([]);

function normalizeCourier(courier) {
  const phone = courier.phone || courier.contact?.phone || "--";
  const email = courier.email || courier.contact?.email || "--";
  const website = courier.website || courier.contact?.website || "--";

  return {
    id: (courier.id || "").toLowerCase().trim(),
    name: courier.name || courier.id || "Unknown Courier",
    prefix: courier.prefix || "GEN",
    logo: courier.logo || "🚚",
    brandColor: courier.brandColor || "#64748b",
    apiEndpoint: courier.apiEndpoint || "",
    phone,
    email,
    website,
    contact: { phone, email, website },
    type: courier.type === "custom" ? "custom" : "carrier",
    note: courier.note || "",
    stored: !!courier.stored,
    builtIn: !!courier.builtIn
  };
}

let activeCouriers = FALLBACK_COURIERS.map(normalizeCourier);
let couriersLoaded = false;

export const COURIERS = activeCouriers;

function resolveCourierById(id) {
  return activeCouriers.find((courier) => courier.id === id) || activeCouriers[0];
}

export async function loadCouriers(options = {}) {
  if (couriersLoaded && !options.forceReload) return activeCouriers;

  const { db, collection, getDocs } = options;
  if (!db || typeof collection !== "function" || typeof getDocs !== "function") {
    couriersLoaded = true;
    return activeCouriers;
  }

  try {
    const querySnapshot = await getDocs(collection(db, "couriers"));
    const stored = querySnapshot.docs.map((courierDoc) => ({ id: courierDoc.id, ...courierDoc.data() }));
    activeCouriers = mergeCarriers(stored).map(normalizeCourier).filter((courier) => courier.id);
  } catch (error) {
    console.error("Failed to load couriers from Firestore. Using the built-in carrier catalog.", error);
    activeCouriers = FALLBACK_COURIERS.map(normalizeCourier);
  }

  COURIERS.length = 0;
  COURIERS.push(...activeCouriers);
  couriersLoaded = true;
  return activeCouriers;
}

export async function getCourierById(id) {
  await loadCouriers();
  return resolveCourierById(id);
}

export function generateTrackingCode(courierId) {
  const courier = resolveCourierById(courierId);
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${courier.prefix}-${randomPart}`;
}

export function mapGenericStatusToCourier(status, courierId) {
  const normalizedStatus = (status || "").toLowerCase().trim();
  const courier = resolveCourierById(courierId);
  const mappings = {
    shipped: `${courier.prefix}_PICKED_UP`,
    "in transit": `${courier.prefix}_IN_TRANSIT`,
    "out for delivery": `${courier.prefix}_OUT_FOR_DELIVERY`,
    delivered: `${courier.prefix}_DELIVERED`,
    processing: `${courier.prefix}_PROCESSING`,
    pending: `${courier.prefix}_PENDING`,
    "under custom review": `${courier.prefix}_CUSTOMS_REVIEW`
  };

  return mappings[normalizedStatus] || `${courier.prefix}_IN_PROGRESS`;
}

export function buildDefaultCourierUpdates(data) {
  const now = new Date().toISOString();
  return [
    {
      title: "Shipment registered",
      description: `Shipment accepted by ${data.courierName}`,
      location: data.origin || data.location || "Origin facility",
      timestamp: now
    },
    {
      title: "Current movement",
      description: data.courierStatus || "In progress",
      location: data.location || "Processing center",
      timestamp: now
    }
  ];
}
