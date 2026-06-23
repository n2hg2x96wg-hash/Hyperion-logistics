export const COURIERS = [
  {
    id: "2goexpress",
    name: "2GoExpress",
    prefix: "2GO",
    logo: "🚢",
    brandColor: "#0ea5e9",
    apiEndpoint: "https://api.2goexpress.example/v1/track",
    contact: {
      phone: "+63-2-877-99-222",
      email: "support@2goexpress.example",
      website: "https://2goexpress.example"
    }
  },
  {
    id: "fedex",
    name: "FedEx",
    prefix: "FEDEX",
    logo: "✈️",
    brandColor: "#7c3aed",
    apiEndpoint: "https://api.fedex.example/v1/track",
    contact: {
      phone: "+1-800-463-3339",
      email: "support@fedex.example",
      website: "https://fedex.example"
    }
  },
  {
    id: "dhl",
    name: "DHL",
    prefix: "DHL",
    logo: "🚚",
    brandColor: "#eab308",
    apiEndpoint: "https://api.dhl.example/v1/track",
    contact: {
      phone: "+1-800-225-5345",
      email: "support@dhl.example",
      website: "https://dhl.example"
    }
  },
  {
    id: "ups",
    name: "UPS",
    prefix: "UPS",
    logo: "📦",
    brandColor: "#92400e",
    apiEndpoint: "https://api.ups.example/v1/track",
    contact: {
      phone: "+1-800-742-5877",
      email: "support@ups.example",
      website: "https://ups.example"
    }
  }
];

export function getCourierById(id) {
  return COURIERS.find((courier) => courier.id === id) || COURIERS[0];
}

export function generateTrackingCode(courierId) {
  const courier = getCourierById(courierId);
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${courier.prefix}-${randomPart}`;
}

export function mapGenericStatusToCourier(status, courierId) {
  const normalizedStatus = (status || "").toLowerCase().trim();
  const courier = getCourierById(courierId);
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
