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
    },
    // Registered clients: Firebase Auth uid <-> clients/{uid} (+ portfolio_history/{uid}). Test data only.
    clients: {
      uidClientAaaa: { name: "Ada Client", email: "ada@client.test", status: "active", created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-09-20T10:00:00.000Z",
        portfolios: { xrp_holdings: 10, tsla_holdings: 1 }, restrictions: { max_xrp: 100, max_tsla: 5 }, password_hash: "legacy-hash-never-shown" },
      uidClientBbbb: { name: "Ben Client", email: "ben@client.test", status: "active", created_at: "2026-09-05T10:00:00.000Z",
        portfolios: { xrp_holdings: 3, tsla_holdings: 0 }, restrictions: { max_xrp: 10, max_tsla: 1 } },
      // A profile with no sign-in account and no history (e.g. an older record), keyed by a non-uid document ID.
      "legacy-client.07": { name: "Lee Legacy", email: "lee@client.test", status: "inactive", created_at: "2026-07-01T10:00:00.000Z" },
      // A Firebase user with the admin claim that also has a client profile: must never be deletable here.
      uidAdminZzzz: { name: "Ops Admin", email: "ops@hyperion.test", status: "active", created_at: "2026-06-01T10:00:00.000Z" }
    },
    portfolioHistory: { uidClientAaaa: { "2026-09-20": { total_value: 50 }, "2026-09-21": { total_value: 55 } }, uidClientBbbb: { "2026-09-21": { total_value: 9 } } },
    authUsers: {
      uidClientAaaa: { email: "ada@client.test", password: "ada-pass-1", createdAt: "2026-08-01T10:00:00.000Z", lastSignInAt: "2026-09-30T09:00:00.000Z" },
      uidClientBbbb: { email: "ben@client.test", password: "ben-pass-1", createdAt: "2026-09-05T10:00:00.000Z" },
      uidAdminZzzz: { email: "ops@hyperion.test", password: "ops-pass-1", admin: true }
    },
    idTokens: { "client-a-token": { uid: "uidClientAaaa", email: "ada@client.test" } }
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
