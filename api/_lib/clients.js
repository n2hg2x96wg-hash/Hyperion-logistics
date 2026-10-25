// Registered clients (portfolio accounts) service. Admin-only; every call arrives through POST /api/admin, which
// verifies the admin session server-side before anything here runs.
//
// Data model (existing, inspected before this was written):
//   Firebase Auth user {uid, email}        sign-in account
//   clients/{uid}                           profile: name, email, status, portfolios, restrictions, created_at
//   portfolio_history/{uid}/history/{date}  daily portfolio values
// A shipment is linked to its customer by `customerId` (the client's uid), set by an admin; client operations only
// count those links and never change or delete shipments. Deletion is keyed by uid only, never by email or name.
//
// Account status: "active" (can sign in), "pending" (set up, sign-in not yet enabled) or "suspended" (sign-in
// disabled). Older profiles stored "inactive", which means suspended. The sign-in account is disabled unless active.
//
// The admin page previously wrote these documents straight from the browser, which the Firestore rules reject
// (the browser has no Firebase admin sign-in), so the Clients tab could not load or save in production.
import { ValidationError } from "./validate.js";
import { ServiceError } from "./service.js";
import { getStore } from "./store/index.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()./-]{6,24}$/;
export const CLIENT_STATUSES = ["active", "pending", "suspended"];
/** Stored status -> one of CLIENT_STATUSES ("inactive" is the older word for suspended). */
export const normalizeClientStatus = (v) => (v === "active" || v === "pending" ? v : "suspended");

/**
 * Firebase Authentication errors -> what the admin can act on. Nothing sensitive (no tokens, stack traces or ids).
 * "configuration-not-found" means Authentication is not set up in the Firebase project, so no sign-in account
 * can be created or changed until it is enabled.
 */
export function authFailure(err) {
  switch (err?.code) {
    case "auth/configuration-not-found":
      return new ServiceError("auth_not_configured", "Client sign-in accounts can't be created yet: Firebase Authentication (Email/Password) isn't enabled for this project. Nothing was saved. Enable it in the Firebase console (Authentication > Sign-in method > Email/Password), then try again.", 503);
    case "auth/email-already-exists": return new ServiceError("duplicate", "A sign-in account with this email already exists.", 409);
    case "auth/invalid-password": return new ValidationError("Password must be at least 6 characters.", "password");
    case "auth/invalid-email": return new ValidationError("A valid email address is required.", "email");
    case "auth/insufficient-permission": return new ServiceError("auth_permission", "The server isn't allowed to manage sign-in accounts. Check that FIREBASE_SERVICE_ACCOUNT has the Firebase Authentication Admin role. Nothing was saved.", 503);
    default: return null;
  }
}
const withAuthErrors = async (fn) => { try { return await fn(); } catch (err) { throw authFailure(err) || err; } };
// A client is located by its database document ID (the Firebase Auth uid for every client this app creates).
// Firestore IDs cannot contain "/" and cannot be "." / ".." or "__name__"-style reserved IDs.
const isDocId = (s) => s.length > 0 && Buffer.byteLength(s) <= 1500 && !s.includes("/") && s !== "." && s !== ".." && !/^__.*__$/.test(s);

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
  if (!isDocId(uid)) throw new ValidationError("Client ID is missing or invalid.", "id");
  return uid;
}

/** Admin-facing summary. Never includes password hashes or auth internals. */
function view(rec, shipmentCount = null) {
  const status = normalizeClientStatus(rec.status);
  return {
    id: rec.id, name: rec.name || "", email: rec.email || "", status, phone: rec.phone || "", adminNotes: rec.admin_notes || "",
    signInDisabled: rec.auth ? !!rec.auth.disabled : null, hasSignIn: !!rec.auth,
    registeredAt: iso(rec.created_at) || rec.auth?.createdAt && iso(rec.auth.createdAt) || null,
    lastActivityAt: latest(rec.auth?.lastActiveAt, rec.auth?.lastSignInAt, rec.updated_at),
    lastSignInAt: iso(rec.auth?.lastSignInAt),
    portfolios: { xrp_holdings: Number(rec.portfolios?.xrp_holdings) || 0, tsla_holdings: Number(rec.portfolios?.tsla_holdings) || 0 },
    restrictions: { max_xrp: Number(rec.restrictions?.max_xrp) || 0, max_tsla: Number(rec.restrictions?.max_tsla) || 0 },
    shipments: { linked: true, count: shipmentCount }
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
  const [records, counts] = await Promise.all([store.listClientRecords(), store.countShipmentsByCustomer ? store.countShipmentsByCustomer().catch(() => null) : null]);
  return records.map((r) => view(r, counts ? counts.get(r.id) || 0 : null));
}

/** How many sign-in accounts exist without a client profile (they can't sign in and aren't counted). Null if unknown. */
export async function accountsWithoutProfile() {
  const store = await getStore();
  return typeof store.countAccountsWithoutProfile === "function" ? store.countAccountsWithoutProfile().catch(() => null) : null;
}

export async function getClient(idInput) {
  const store = await getStore();
  const rec = await store.getClientRecord(parseUid(idInput));
  if (!rec) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  const counts = store.countShipmentsByCustomer ? await store.countShipmentsByCustomer().catch(() => null) : null;
  return view(rec, counts ? counts.get(rec.id) || 0 : null);
}

/** Validated profile fields shared by create and edit. */
export function parseClientProfile(c = {}) {
  const name = String(c.name ?? "").trim().slice(0, 120);
  if (!name) throw new ValidationError("Client name is required.", "name");
  const status = c.status === undefined || c.status === "" ? "active" : c.status === "inactive" ? "suspended" : c.status;
  if (!CLIENT_STATUSES.includes(status)) throw new ValidationError("Choose Active, Pending or Suspended.", "status");
  const phone = String(c.phone ?? "").trim();
  if (phone && !PHONE_RE.test(phone)) throw new ValidationError("Enter a phone number with digits only (spaces, +, - and brackets allowed).", "phone");
  const notes = String(c.adminNotes ?? "").trim();
  if (notes.length > 2000) throw new ValidationError("Admin notes can be at most 2000 characters.", "adminNotes");
  return {
    name, status,
    // only fields the request carries, so a partial edit (e.g. Quick Edit of holdings) never clears them
    ...("phone" in c ? { phone } : {}), ...("adminNotes" in c ? { admin_notes: notes } : {}),
    portfolios: { xrp_holdings: num(c.xrp_holdings, "xrp_holdings", "XRP holdings"), tsla_holdings: num(c.tsla_holdings, "tsla_holdings", "TSLA holdings"), last_updated: new Date().toISOString() },
    restrictions: { max_xrp: num(c.max_xrp, "max_xrp", "Max XRP"), max_tsla: num(c.max_tsla, "max_tsla", "Max TSLA") }
  };
}

/** Validated new-account fields (email + initial password). */
export function parseNewAccount(c = {}) {
  const email = String(c.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError("A valid email address is required.", "email");
  const password = c.password ? String(c.password) : "";
  if (!password) throw new ValidationError("A password is required for new clients.", "password");
  if (password.length < 6) throw new ValidationError("Password must be at least 6 characters.", "password");
  return { email, password };
}

/** Create a client account (sign-in + profile, all or nothing). `signInEnabled` false keeps sign-in disabled. */
export async function createClient(identity, c, { history = null, signInEnabled } = {}) {
  const store = await getStore();
  const profile = parseClientProfile(c);
  const { email, password } = parseNewAccount(c);
  if ((await store.listClientRecords()).some((r) => String(r.email || "").toLowerCase() === email)) {
    throw new ServiceError("duplicate", "A client with this email already exists. Choose them under Existing customer instead.", 409);
  }
  const enabled = signInEnabled ?? profile.status === "active";
  const uid = await withAuthErrors(() => store.createClientAccount({ email, password, displayName: profile.name, disabled: !enabled }, { ...profile, email }, history,
    audit(identity, "client.created", null, { next: { email, status: profile.status } })));
  return { uid, profile: { ...profile, email } };
}

/** Create (mode "create") or edit (mode "update"). Email is the sign-in identity and is fixed after creation. */
export async function saveClient(identity, input = {}) {
  const store = await getStore();
  const c = input.client || {};
  if (input.mode === "create") {
    const { uid, profile } = await createClient(identity, c, { history: historyFrom(input) });
    return { client: view({ ...profile, id: uid }, 0), message: "Client created successfully." };
  }
  const profile = parseClientProfile(c);
  const password = c.password ? String(c.password) : "";
  if (password && password.length < 6) throw new ValidationError("Password must be at least 6 characters.", "password");
  const uid = parseUid(input.id);
  const existing = await store.getClientRecord(uid);
  if (!existing) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  const wasActive = normalizeClientStatus(existing.status) === "active"; const isActive = profile.status === "active";
  await withAuthErrors(() => store.updateClientRecord(uid, profile, {
    password: password || undefined, history: historyFrom(input),
    disabled: wasActive !== isActive ? !isActive : undefined,
    auditEntry: audit(identity, "client.updated", uid, { email: existing.email || null, next: { status: profile.status, ...(password ? { password: "changed" } : {}) } })
  }));
  return { client: view({ ...existing, ...profile, id: uid }), message: "Client updated successfully." };
}

/** Deactivate (sign-in disabled, profile kept) or restore. Reversible. */
export async function setClientStatus(identity, input = {}) {
  const store = await getStore();
  const uid = parseUid(input.id);
  const status = input.status === "inactive" ? "suspended" : CLIENT_STATUSES.includes(input.status) ? input.status : null;
  if (!status) throw new ValidationError("Unknown client status.", "status");
  const existing = await store.getClientRecord(uid);
  if (!existing) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  await withAuthErrors(() => store.updateClientRecord(uid, { status }, { disabled: status !== "active",
    auditEntry: audit(identity, status === "active" ? "client.restored" : status === "pending" ? "client.pending" : "client.deactivated", uid, { email: existing.email || null }) }));
  return { ok: true, message: status === "active" ? "Client activated. They can sign in." : status === "pending" ? "Client set to pending. Sign-in stays off until activated." : "Client suspended. They can no longer sign in." };
}

/** What a permanent delete removes, shown in the confirmation dialog before anything happens. */
export function deletionPolicy() {
  return {
    removes: ["The client's sign-in account (Firebase Authentication)", "The client profile (name, email, status, holdings, limits)", "The client's portfolio history"],
    keeps: ["All shipments and tracking records (shipments linked to this client stay, without the link to a sign-in account)", "Other clients", "Couriers, admin access and site settings", "The activity log",
      "A private recovery copy of the profile and history (not visible anywhere in the app; no password data)"]
  };
}

/**
 * Permanent deletion of one client, located by its document ID (never by name or email). Requires the typed
 * confirmation "DELETE". Audit entries use action CLIENT_DELETED with result SUCCESS / PARTIAL / FAILED.
 */
export async function deleteClient(identity, input = {}) {
  const store = await getStore();
  const uid = parseUid(input.id);
  if (input.confirm !== "DELETE") throw new ValidationError("Type DELETE to confirm permanent deletion.", "confirm");
  const reason = input.reason ? String(input.reason).trim().slice(0, 200) : null;
  const existing = await store.getClientRecord(uid);
  if (!existing) throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
  if (existing.auth?.admin) throw new ServiceError("forbidden", "This account has admin access and cannot be deleted here.", 403);
  if (input.expectEmail && String(existing.email || "").toLowerCase() !== String(input.expectEmail).toLowerCase()) {
    throw new ServiceError("conflict", "This client changed since the list was loaded. Refresh and try again.", 409);
  }
  const base = { email: existing.email || null, name: existing.name || null, ...(reason ? { reason } : {}) };
  let result;
  try {
    result = await store.deleteClientPermanently(uid, {
      onAuditEntry: ({ removed, result: r }) => audit(identity, "CLIENT_DELETED", uid, { ...base, result: r, removed })
    });
  } catch (err) {
    if (err?.code === "client_missing") throw new ServiceError("not_found", "This client no longer exists. The list has been refreshed.", 404);
    if (err?.code === "client_is_admin") throw new ServiceError("forbidden", "This account has admin access and cannot be deleted here.", 403);
    const detail = describeError(err);
    console.error("[clients] delete failed", uid, detail);
    await writeFailureAudit(store, audit(identity, "CLIENT_DELETED", uid, { ...base, result: "FAILED", error: detail }));
    const e = new ServiceError("delete_failed", `Unable to delete client. No client data was removed. Reason: ${detail}`, 500);
    throw e;
  }
  if (!result.authDeleted) {
    // Profile and history are gone. The sign-in account could not be removed; the client portal signs out any
    // account without a profile, so it cannot be used, but it still exists in Firebase Authentication.
    const detail = result.authError || "unknown";
    await writeFailureAudit(store, audit(identity, "CLIENT_SIGNIN_REMOVAL_PENDING", uid, { ...base, result: "PARTIAL", error: detail }));
    return { ok: true, partial: true, id: uid, removed: result.removed,
      message: `Client deleted. Their sign-in account could not be removed (${detail})${result.authDisabled ? " but it is disabled" : ""}; without a profile it cannot open the client portal.` };
  }
  return { ok: true, id: uid, removed: result.removed, message: "Client deleted successfully." };
}

/** A short, non-sensitive description of a backend failure (error code plus the first line of its message). */
function describeError(err) {
  const code = err?.code != null ? String(err.code) : "";
  const msg = String(err?.message || "").split("\n")[0].replace(/\s+/g, " ").slice(0, 160);
  const known = code === "7" || /PERMISSION_DENIED/i.test(code) ? "database permission denied" : code === "client_history_too_large" ? "too many portfolio history records to delete in one step" : "";
  return [known || code, known ? "" : msg].filter(Boolean).join(": ") || "unknown error";
}

async function writeFailureAudit(store, entry) {
  try { if (store.addAuditEntry) await store.addAuditEntry(entry); } catch { /* audit is best effort on the failure path */ }
}
