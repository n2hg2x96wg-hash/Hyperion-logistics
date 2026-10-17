// Storage adapter selection. The service layer only talks to this interface:
//   getShipment, mutateShipment, listEvents, listLocations, listShipments, stats, recentShipments,
//   listAudit, deleteShipment, watchShipment, claimNotification, backfillPage, getCourier, verifyIdToken
let storePromise = null;

export function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      if (process.env.STORE === "memory") {
        const { createMemoryStore } = await import("./memory.js");
        return createMemoryStore();
      }
      const { createFirestoreStore } = await import("./firestore.js");
      return createFirestoreStore();
    })();
    storePromise.catch(() => { storePromise = null; });
  }
  return storePromise;
}

/** Test helper: swap/reset the store singleton. */
export function __setStoreForTests(store) {
  storePromise = store ? Promise.resolve(store) : null;
}

import { deriveCountry } from "../geo.js";

/** Fields derived on every write so efficient prefix queries and country statistics work. */
export function derivedFields(s) {
  const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");
  return {
    destinationLower: lower(s.destination),
    locationLower: lower(s.location || s.currentLocation),
    originLower: lower(s.origin),
    clientRefLower: lower(s.clientRef),
    ...countryFields(s)
  };
}

/** ISO-2 countries from recorded coordinates first, then place text. null when unknown (never guessed further). */
export function countryFields(s) {
  return {
    originCountry: deriveCountry(s.originLat, s.originLng, s.origin),
    destinationCountry: deriveCountry(s.destinationLat, s.destinationLng, s.destination),
    currentCountry: deriveCountry(s.latitude, s.longitude, s.location || s.currentLocation)
  };
}
