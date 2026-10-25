// Admin "Register shipment": choose an existing customer or create a new one, then save the shipment linked to that
// customer (shipment.customerId = the client's uid). Runs on the server behind the admin session (POST /api/admin).
//
// Consistency (Firestore has no transaction across Firebase Auth and documents, so it is done explicitly):
//   1. everything is validated before anything is written;
//   2. a new customer is created with sign-in DISABLED, so a half-finished registration never looks active;
//   3. the shipment is saved (its own transaction; the tracking ID must be unused);
//   4. only then is a new customer's sign-in enabled, when the admin chose Active.
// If step 3 fails, the customer created in step 2 is deleted again, so no orphan account is left behind.
// A submission ID makes the whole operation run once: a repeated click or a retry returns the first result.
import { ValidationError, cleanText, normalizeTrackingCode } from "./validate.js";
import { ServiceError, createShipment, parsePatch } from "./service.js";
import { createClient, parseClientProfile, parseNewAccount, authFailure, normalizeClientStatus } from "./clients.js";
import { getStore } from "./store/index.js";

const SUBMISSION_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Everything the registration needs, validated up front (throws ValidationError). Pure. */
export function parseRegistration(input = {}) {
  const submissionId = String(input.submissionId ?? "");
  if (!SUBMISSION_RE.test(submissionId)) throw new ValidationError("Reload the form and try again (missing submission ID).", "submissionId");
  const cust = input.customer || { mode: "none" };
  let customer;
  if (cust.mode === "existing") {
    const id = cleanText(cust.id, { max: 128, field: "customerId" });
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) throw new ValidationError("Choose a customer from the list.", "customerId");
    customer = { mode: "existing", id };
  } else if (cust.mode === "new") {
    const client = cust.client || {};
    const profile = parseClientProfile(client);
    const account = parseNewAccount(client);
    customer = { mode: "new", client: { ...client, email: account.email }, status: profile.status };
  } else if (cust.mode === "none") {
    customer = { mode: "none" };
  } else throw new ValidationError("Choose an existing customer or create a new one.", "customerMode");

  const shipment = { ...(input.shipment || {}) };
  delete shipment.customerId; // the link comes only from the customer chosen above
  const patch = parsePatch(shipment);
  if (!patch.origin) throw new ValidationError("Origin is required", "origin");
  if (!patch.destination) throw new ValidationError("Destination is required", "destination");
  if (!patch.courier) throw new ValidationError("Choose a carrier", "courier");
  let trackingCode = null;
  if (shipment.trackingCode) {
    trackingCode = normalizeTrackingCode(String(shipment.trackingCode));
    if (!trackingCode) throw new ValidationError("Tracking ID may contain letters, numbers, - and _ (3-40 characters)", "trackingCode");
  }
  return { submissionId, customer, shipment, trackingCode };
}

export async function registerShipment(identity, input = {}) {
  const reg = parseRegistration(input);
  const store = await getStore();
  // a repeated submission returns the first result instead of saving again
  const claim = await store.claimRegistration(reg.submissionId, new Date().toISOString());
  if (claim.state === "done") return { ...claim.result, repeated: true };
  if (claim.state === "pending") throw new ServiceError("in_progress", "This registration is already being saved. Wait a moment, then refresh the shipment list.", 409);

  let createdUid = null;
  try {
    // checks that need the database, still before any write
    if (reg.trackingCode && await store.getShipment(reg.trackingCode)) {
      throw new ServiceError("exists", `Tracking ID ${reg.trackingCode} is already used by another shipment. Enter a different one, or leave it empty to generate one.`, 409);
    }
    if (reg.customer.mode === "existing") {
      const rec = await store.getClientRecord(reg.customer.id);
      if (!rec || rec.auth?.admin) throw new ValidationError("This customer no longer exists. Refresh the list and choose again.", "customerId");
    }
    let customerId = reg.customer.mode === "existing" ? reg.customer.id : null;
    if (reg.customer.mode === "new") {
      // sign-in stays disabled until the shipment is saved
      const { uid } = await createClient(identity, { ...reg.customer.client, status: reg.customer.status === "active" ? "pending" : reg.customer.status }, { signInEnabled: false });
      createdUid = uid; customerId = uid;
    }
    const shipment = await createShipment(identity, { ...reg.shipment, ...(reg.trackingCode ? { trackingCode: reg.trackingCode } : {}), ...(customerId ? { customerId } : {}) });

    let warning = null;
    if (createdUid && reg.customer.status === "active") {
      try {
        await store.updateClientRecord(createdUid, { status: "active" }, { disabled: false,
          auditEntry: { at: new Date().toISOString(), actor: identity.sub, role: identity.role, via: identity.via || "admin", shipment: shipment.id, client: createdUid, action: "client.activated" } });
      } catch (err) {
        console.error("[register] activation failed", createdUid, err?.code || err?.message);
        warning = "The shipment and customer were saved, but the customer's sign-in could not be switched on. Activate them from Clients.";
      }
    }
    const rec = customerId ? await store.getClientRecord(customerId) : null;
    const result = {
      shipment: { id: shipment.id, statusCode: shipment.statusCode, origin: shipment.origin, destination: shipment.destination, charges: shipment.charges || null },
      customer: rec ? { id: customerId, name: rec.name || "", email: rec.email || "", status: normalizeClientStatus(rec.status), created: !!createdUid } : null,
      warning,
      message: `Shipment ${shipment.id} registered${rec ? ` for ${rec.name || rec.email}` : ""}.`
    };
    await store.completeRegistration(reg.submissionId, result).catch((err) => console.error("[register] could not record completion", err?.message));
    return result;
  } catch (err) {
    // undo a customer created for this registration, so a failed save leaves nothing behind
    if (createdUid) {
      try { await store.deleteClientPermanently(createdUid, {}); }
      catch (cleanupErr) { console.error("[register] cleanup failed", createdUid, cleanupErr?.code || cleanupErr?.message); }
    }
    await store.releaseRegistration(reg.submissionId).catch(() => {});
    throw authFailure(err) || err;
  }
}
