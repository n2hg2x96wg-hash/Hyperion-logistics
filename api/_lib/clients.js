// Registered clients (portfolio accounts) service. Admin-only; every call arrives through POST /api/admin, which
// verifies the admin session server-side before anything here runs.
//
// Data model (existing, inspected before this was written):
//   Firebase Auth user {uid, email}        sign-in account
//   clients/{uid}                           profile: name, email, status, portfolios, restrictions, created_at
//   portfolio_history/{uid}/history/{date}  daily portfolio values
// Shipments are NOT linked to client accounts (a shipment only has a free-text `clientRef`), so client operations
// never read, change or delete shipments. Deletion is keyed by uid only, never by email or name.
//
// The admin page previously wrote these documents straight from the browser, which the Firestore rules reject
// (the browser has no Firebase admin sign-in), so the Clients tab could not load or save in production.
import { ValidationError } from "./validate.js";
import { ServiceError } from "./service.js";
import { getStore } from "./store/index.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;

const num = (v, field, label) => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a number of 0 or more.`, field);
  return n;
};
const iso = (v) => {
  if (!v) return null;
  if (typeof v === "string") return Number.isNaN(Date.parse(v)) ? null : new Date(v).toISOString();
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v._seconds === "number") return new Date(v._seconds * 1000).toISOString();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString();
  return null;
};
const latest = (...vals) => vals.map(iso).filter(Boolean).sort().pop() || null;

function parseUid(v) {
  const uid = String(v ?? "").trim();
  if (!UID_RE.test(uid)) throw new ValidationError("Client ID is missing or invalid.", "id");
  return uid;
}

/** Admin-facing summary. Never includes password hashes or auth internals. */
function view(rec) {
  const status = rec.status === "active" ? "active" : "inactive";
  return {
    id: rec.id, name: rec.name || "", email: rec.email || "", status,
    signInDisabled: rec.auth ? !!rec.auth.disabled : null, hasSignIn: !!rec.auth,
    registeredAt: iso(rec.created_at) || rec.auth?.createdAt && iso(rec.auth.createdAt) || null,
    lastActivityAt: latest(rec.auth?.lastActiveAt, rec.auth?.lastSignInAt, rec.updated_at),
    lastSignInAt: iso(rec.auth?.lastSignInAt),
    portfolios: { xrp_holdings: Number(rec.portfolios?.xrp_holdings) || 0, tsla_holdings: Number(rec.portfolios?.tsla_holdings) || 0 },
    restrictions: { max_xrp: Number(rec.restrictions?.max_xrp) || 0, max_tsla: Number(rec.restrictions?.max_tsla) || 0 },
    // Shipments carry no client-account link in this data model; nothing to count or delete.
    shipments: { linked: false, count: null }
  };
}

const audit = (identity, action, uid, extra = {}) => ({
  at: new Date().toISOString(), actor: identity.sub, role: identity.role, via: identity.via || "admin",
  shipment: null, client: uid, action, ...extra
});

function historyFrom(input) {
  const h = input?.history;
  if (!h) return null;
  const xrp = Number(h.xrp_value); const tsla = Number(h.tsla_value);
  if (!Number.isFinite(xrp) || !Number.isFinite(tsla)) return null;
  return { dateKey: new Date().toISOString().slice(0, 10), values: { xrp_value: xrp, tsla_value: tsla, total_value: xrp + tsla } };
}

export async function listClients() {
  const store = await getStore();
  return (await store.listClientRecords()).map(view);
}

export async function getClient(idInput) {
  const store = await getStore();
  const rec = await store.getClientRecord(parseUid(idInput));
  if (!rec) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  return view(rec);
}

/** Create (mode "create") or edit (mode "update"). Email is the sign-in identity and is fixed after creation. */
export async function saveClient(identity, input = {}) {
  const store = await getStore();
  const c = input.client || {};
  const name = String(c.name ?? "").trim().slice(0, 120);
  if (!name) throw new ValidationError("Client name is required.", "name");
  const status = c.status === "inactive" ? "inactive" : "active";
  const profile = {
    name, status,
    portfolios: { xrp_holdings: num(c.xrp_holdings, "xrp_holdings", "XRP holdings"), tsla_holdings: num(c.tsla_holdings, "tsla_holdings", "TSLA holdings"), last_updated: new Date().toISOString() },
    restrictions: { max_xrp: num(c.max_xrp, "max_xrp", "Max XRP"), max_tsla: num(c.max_tsla, "max_tsla", "Max TSLA") }
  };
  const password = c.password ? String(c.password) : "";
  if (password && password.length < 6) throw new ValidationError("Password must be at least 6 characters.", "password");

  if (input.mode === "create") {
    const email = String(c.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new ValidationError("A valid email address is required.", "email");
    if (!password) throw new ValidationError("A password is required for new clients.", "password");
    if ((await store.listClientRecords()).some((r) => String(r.email || "").toLowerCase() === email)) {
      throw new ServiceError("duplicate", "A client with this email already exists.", 409);
    }
    try {
      const uid = await store.createClientAccount({ email, password, displayName: name }, { ...profile, email }, historyFrom(input),
        audit(identity, "client.created", null, { next: { email, status } }));
      return { client: view({ ...profile, email, id: uid }), message: "Client created successfully." };
    } catch (err) {
      if (err?.code === "auth/email-already-exists") throw new ServiceError("duplicate", "A sign-in account with this email already exists.", 409);
      if (err?.code === "auth/invalid-password") throw new ValidationError("Password must be at least 6 characters.", "password");
      throw err;
    }
  }

  const uid = parseUid(input.id);
  const existing = await store.getClientRecord(uid);
  if (!existing) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  await store.updateClientRecord(uid, profile, {
    password: password || undefined, history: historyFrom(input),
    disabled: status !== (existing.status === "active" ? "active" : "inactive") ? status === "inactive" : undefined,
    auditEntry: audit(identity, "client.updated", uid, { email: existing.email || null, next: { status, ...(password ? { password: "changed" } : {}) } })
  });
  return { client: view({ ...existing, ...profile, id: uid }), message: "Client updated successfully." };
}

/** Deactivate (sign-in disabled, profile kept) or restore. Reversible. */
export async function setClientStatus(identity, input = {}) {
  const store = await getStore();
  const uid = parseUid(input.id);
  const status = input.status === "active" ? "active" : input.status === "inactive" ? "inactive" : null;
  if (!status) throw new ValidationError("Unknown client status.", "status");
  const existing = await store.getClientRecord(uid);
  if (!existing) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  await store.updateClientRecord(uid, { status }, { disabled: status === "inactive",
    auditEntry: audit(identity, status === "active" ? "client.restored" : "client.deactivated", uid, { email: existing.email || null }) });
  return { ok: true, message: status === "active" ? "Client restored." : "Client deactivated. They can no longer sign in." };
}

/** What a permanent delete removes, shown in the confirmation dialog before anything happens. */
export function deletionPolicy() {
  return {
    removes: ["The client's sign-in account (Firebase Authentication)", "The client profile (name, email, status, holdings, limits)", "The client's portfolio history"],
    keeps: ["All shipments and tracking records (they are not linked to client accounts)", "Other clients", "Couriers, admin access and site settings", "The activity log"]
  };
}

/** Permanent, irreversible deletion of one client by uid. Requires the typed confirmation "DELETE". */
export async function deleteClient(identity, input = {}) {
  const store = await getStore();
  const uid = parseUid(input.id);
  if (input.confirm !== "DELETE") throw new ValidationError('Type DELETE to confirm permanent deletion.', "confirm");
  const existing = await store.getClientRecord(uid);
  if (!existing) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  if (existing.auth?.admin) throw new ServiceError("forbidden", "This account has admin access and cannot be deleted here.", 403);
  if (input.expectEmail && String(existing.email || "").toLowerCase() !== String(input.expectEmail).toLowerCase()) {
    throw new ServiceError("conflict", "This client changed since the list was loaded. Refresh and try again.", 409);
  }
  const base = { email: existing.email || null };
  try {
    const result = await store.deleteClientPermanently(uid, {
      onAuditEntry: ({ removed, result: r }) => audit(identity, "client.deleted", uid, { ...base, result: r, removed })
    });
    if (!result.authDeleted) {
      // Data is gone and the sign-in account is disabled, so it cannot sign in; record that removal must be retried.
      await writeFailureAudit(store, audit(identity, "client.auth_removal_pending", uid, { ...base, result: "sign-in account disabled, not removed" }));
      return { ok: true, partial: true, message: "Client deleted. Their sign-in account is disabled but could not be removed; it cannot be used to sign in." };
    }
    return { ok: true, removed: result.removed, message: "Client deleted successfully." };
  } catch (err) {
    if (err?.code === "client_missing") throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
    if (err?.code === "client_is_admin") throw new ServiceError("forbidden", "This account has admin access and cannot be deleted here.", 403);
    console.error("[clients] delete failed", uid, err?.code || "", err?.message);
    await writeFailureAudit(store, audit(identity, "client.delete_failed", uid, { ...base, result: "failed", reason: String(err?.code || "error").slice(0, 60) }));
    throw new ServiceError("delete_failed", "Unable to delete client. No client data was removed.", 500);
  }
}

async function writeFailureAudit(store, entry) {
  try { if (store.addAuditEntry) await store.addAuditEntry(entry); } catch { /* audit is best effort on the failure path */ }
}
