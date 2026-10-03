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

/** Fields derived on every write so efficient prefix queries work. */
export function derivedFields(s) {
  const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");
  return {
    destinationLower: lower(s.destination),
    locationLower: lower(s.location || s.currentLocation),
    originLower: lower(s.origin),
    clientRefLower: lower(s.clientRef)
  };
}
