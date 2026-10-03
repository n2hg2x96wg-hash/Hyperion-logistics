// Demo/test seed for the in-memory store (never used with Firestore).
import { __setStoreForTests } from "../api/_lib/store/index.js";
import { createMemoryStore } from "../api/_lib/store/memory.js";

export async function __seedDemo() {
  const store = createMemoryStore({
    couriers: { dhl: { id: "dhl", name: "DHL", prefix: "DHL", phone: "+1-800-225-5345", website: "https://dhl.example", apiEndpoint: "https://secret.internal/api", email: "x@dhl.example" } },
    shipments: {
      "DHL-12345": { id: "DHL-12345", status: "In Transit", courier: "dhl", origin: "Manila, Philippines", destination: "Alabama, United States",
        location: "Tokyo, Japan", latitude: 35.6762, longitude: 139.6503, fee: "$120.00", createdAt: "2026-09-28T08:00:00.000Z",
        distance: "11000", updates: [{ title: "Shipment registered", description: "Shipment accepted by DHL", location: "Manila", timestamp: "2026-09-28T08:00:00.000Z" }] },
      "LEGACY-OLD": { id: "LEGACY-OLD", status: "Under Custom review", courier: "dhl", origin: "Lagos", destination: "London", location: "Heathrow", fee: "$5", createdAt: "2026-09-01T00:00:00.000Z" }
    }
  });
  __setStoreForTests(store);
  return store;
}
