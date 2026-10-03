// Demo/test seed: in-memory store by default, or the Firestore EMULATOR when STORE=firestore-emulator.
import { __setStoreForTests } from "../api/_lib/store/index.js";
import { createMemoryStore } from "../api/_lib/store/memory.js";

const DEMO = {
    couriers: { dhl: { id: "dhl", name: "DHL", prefix: "DHL", phone: "+1-800-225-5345", website: "https://dhl.example", apiEndpoint: "https://secret.internal/api", email: "x@dhl.example" } },
    shipments: {
      "DHL-12345": { id: "DHL-12345", status: "In Transit", courier: "dhl", origin: "Manila, Philippines", destination: "Alabama, United States",
        location: "Tokyo, Japan", latitude: 35.6762, longitude: 139.6503, fee: "$120.00", createdAt: "2026-09-28T08:00:00.000Z",
        distance: "11000", updates: [{ title: "Shipment registered", description: "Shipment accepted by DHL", location: "Manila", timestamp: "2026-09-28T08:00:00.000Z" }] },
      "LEGACY-OLD": { id: "LEGACY-OLD", status: "Under Custom review", courier: "dhl", origin: "Lagos", destination: "London", location: "Heathrow", fee: "$5", createdAt: "2026-09-01T00:00:00.000Z" }
    }
};

export async function __seedDemo() {
  if (process.env.STORE === "firestore-emulator") return seedEmulator();
  const store = createMemoryStore(structuredClone(DEMO));
  __setStoreForTests(store);
  return store;
}

// Seeds the Firestore EMULATOR only (refuses to run without FIRESTORE_EMULATOR_HOST).
async function seedEmulator() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to seed: FIRESTORE_EMULATOR_HOST not set");
  const project = process.env.FIREBASE_PROJECT_ID || "demo-hyperion";
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  const { createFirestoreStore } = await import("../api/_lib/store/firestore.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const store = createFirestoreStore();
  const db = getFirestore();
  for (const [id, c] of Object.entries(DEMO.couriers)) await db.collection("couriers").doc(id).set(c);
  for (const [id, s] of Object.entries(DEMO.shipments)) await db.collection("shipments").doc(id).set(s);
  __setStoreForTests(store);
  return store;
}
