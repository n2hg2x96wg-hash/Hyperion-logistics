// Courier directory service: the only write path for the `couriers` collection.
//
// The admin page used to write couriers straight from the browser with the Firebase web SDK. The browser is
// not signed in to Firebase (admin sign-in is the server session), so Firestore rules rejected every write
// and the page showed "Error saving courier". All courier writes now go through POST /api/admin, which is
// authenticated server-side and writes with the Admin SDK.
//
// Records are never deleted: "archive" hides a courier from new shipments and can be undone. Shipments that
// already reference a courier keep working whatever its state.
import { CARRIERS, builtInCarrier, carrierId } from "../../shared/carriers.js";
import { ValidationError } from "./validate.js";
import { ServiceError } from "./service.js";
import { getStore } from "./store/index.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PREFIX_RE = /^[A-Z0-9]{1,8}$/;
const COLOR_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

const text = (v, max, field, label) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number") throw new ValidationError(`${label} must be text.`, field);
  const s = String(v).trim();
  if (s.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`, field);
  return s;
};
const url = (v, field, label, { httpsOnly = false } = {}) => {
  const s = text(v, 300, field, label);
  if (!s) return "";
  if (!URL_RE.test(s) || (httpsOnly && !/^https:/i.test(s))) throw new ValidationError(`${label} must be a full web address starting with ${httpsOnly ? "https://" : "http:// or https://"}.`, field);
  try { new URL(s.replace("{code}", "CODE")); } catch { throw new ValidationError(`${label} is not a valid web address.`, field); }
  return s;
};

/** Validates admin input. Optional fields may be empty; nothing is invented for them. */
export function parseCourierInput(input = {}, { creating }) {
  const out = {};
  if (creating) {
    const id = carrierId(input.id);
    if (!id) throw new ValidationError("Courier ID is required.", "id");
    if (!ID_RE.test(id)) throw new ValidationError("Courier ID must be 2–40 lowercase letters, numbers or dashes (for example \"dhl\" or \"my-carrier\").", "id");
    out.id = id;
  }
  out.name = text(input.name, 60, "name", "Name");
  if (!out.name) throw new ValidationError("Name is required.", "name");
  out.prefix = text(input.prefix, 8, "prefix", "Tracking prefix").toUpperCase();
  if (!out.prefix) throw new ValidationError("Tracking prefix is required.", "prefix");
  if (!PREFIX_RE.test(out.prefix)) throw new ValidationError("Tracking prefix must be 1–8 letters or numbers (for example DHL).", "prefix");
  out.type = input.type === "custom" ? "custom" : "carrier";
  out.brandColor = text(input.brandColor, 7, "brandColor", "Brand color");
  if (out.brandColor && !COLOR_RE.test(out.brandColor)) throw new ValidationError("Brand color must be a hex color such as #0ea5e9.", "brandColor");
  out.phone = text(input.phone, 40, "phone", "Phone");
  out.email = text(input.email, 120, "email", "Email");
  if (out.email && !EMAIL_RE.test(out.email)) throw new ValidationError("Email address is not valid.", "email");
  out.website = url(input.website, "website", "Website");
  out.trackingUrl = url(input.trackingUrl, "trackingUrl", "Tracking URL", { httpsOnly: true });
  if (out.trackingUrl && !out.trackingUrl.includes("{code}")) throw new ValidationError("Tracking URL must include {code} where the carrier tracking number goes.", "trackingUrl");
  out.region = text(input.region, 60, "region", "Country / region");
  out.logo = text(input.logo, 200, "logo", "Logo");
  if (out.logo.length > 8 && !/^https:\/\//i.test(out.logo)) throw new ValidationError("Logo must be an emoji or an https:// image address.", "logo");
  out.apiEndpoint = url(input.apiEndpoint, "apiEndpoint", "API endpoint", { httpsOnly: true });
  out.note = text(input.note, 200, "note", "Note");
  out.active = input.active !== false;
  if (!creating) { // an edit only changes the fields it sends; anything omitted keeps its stored value
    for (const k of Object.keys(out)) if (input[k] === undefined && k !== "name" && k !== "prefix") delete out[k];
  }
  return out;
}

const view = (rec) => ({
  id: rec.id, docId: rec.docId || null, name: rec.name || rec.id, prefix: rec.prefix || "", type: rec.type === "custom" ? "custom" : "carrier",
  brandColor: rec.brandColor || "#64748b", logo: rec.logo || "🚚",
  phone: rec.phone && rec.phone !== "--" ? rec.phone : (rec.contact?.phone || ""),
  email: rec.email && rec.email !== "--" ? rec.email : (rec.contact?.email || ""),
  website: rec.website && rec.website !== "--" ? rec.website : (rec.contact?.website || ""),
  trackingUrl: rec.trackingUrl || "", region: rec.region || "", apiEndpoint: rec.apiEndpoint || "", note: rec.note || "",
  active: rec.active !== false && rec.archived !== true, archived: rec.archived === true,
  builtIn: !!builtInCarrier(rec.id), stored: !!rec.docId, updatedAt: rec.updatedAt || null
});

/** Built-in catalog merged with stored records (stored values win field by field). Includes inactive/archived. */
export async function listCouriers() {
  const store = await getStore();
  const stored = await store.listCouriers();
  const byId = new Map(CARRIERS.map((c) => [c.id, { ...c }]));
  for (const rec of stored) {
    const id = carrierId(rec.id || rec.docId);
    if (!id) continue;
    const clean = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "--"));
    byId.set(id, { ...(byId.get(id) || {}), ...clean, id });
  }
  return [...byId.values()].map(view).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

async function prefixTaken(prefix, exceptId) {
  const all = await listCouriers();
  return all.find((c) => c.active && c.id !== exceptId && c.prefix.toUpperCase() === prefix) || null;
}

const audit = (identity, action, id, extra = {}) => ({
  at: new Date().toISOString(), actor: identity.sub, role: identity.role, via: identity.via || "admin",
  shipment: null, courier: id, action, ...extra
});

/** Create (mode "create") or edit (mode "update") a courier. Returns the saved record and a message. */
export async function saveCourier(identity, input = {}) {
  const store = await getStore();
  const creating = input.mode === "create";
  const data = parseCourierInput(input.courier || {}, { creating });
  const now = new Date().toISOString();

  if (creating) {
    if (builtInCarrier(data.id)) throw new ServiceError("duplicate", `"${data.id}" is already a built-in courier. Use Edit on that courier instead.`, 409);
    if (await store.findCourierDoc(data.id)) throw new ServiceError("duplicate", `A courier with the ID "${data.id}" already exists.`, 409);
    const clash = await prefixTaken(data.prefix, data.id);
    if (clash) throw new ServiceError("duplicate_prefix", `The tracking prefix ${data.prefix} is already used by ${clash.name}.`, 409);
    try {
      await store.createCourier(data.id, { ...data, archived: false, createdAt: now, createdBy: identity.sub, updatedAt: now, updatedBy: identity.sub },
        audit(identity, "courier.create", data.id, { changes: { name: data.name, prefix: data.prefix } }));
    } catch (err) {
      if (err.code === "courier_exists") throw new ServiceError("duplicate", `A courier with the ID "${data.id}" already exists.`, 409);
      throw err;
    }
    return { courier: view({ ...data, docId: data.id }), message: "Courier created successfully." };
  }

  const id = carrierId(input.id);
  if (!id) throw new ValidationError("Courier ID is missing.", "id");
  const existing = await store.findCourierDoc(id);
  if (!existing && !builtInCarrier(id)) throw new ServiceError("not_found", "This courier no longer exists. Refresh the list and try again.", 404);
  const currentPrefix = String(existing?.prefix || builtInCarrier(id)?.prefix || "").toUpperCase();
  const clash = data.prefix !== currentPrefix ? await prefixTaken(data.prefix, id) : null; // unchanged prefixes are never re-checked
  if (clash) throw new ServiceError("duplicate_prefix", `The tracking prefix ${data.prefix} is already used by ${clash.name}.`, 409);
  const patch = { ...data, updatedAt: now, updatedBy: identity.sub };
  if (data.active === true) patch.archived = false;
  const entry = audit(identity, "courier.update", id, { changes: { name: data.name, prefix: data.prefix, ...(data.active !== undefined ? { active: data.active } : {}) } });
  if (existing) await store.updateCourier(existing.docId, patch, entry);
  else await store.createCourier(id, { ...patch, id, createdAt: now, createdBy: identity.sub }, entry); // first save of a built-in = stored override
  return { courier: view({ ...(existing || builtInCarrier(id)), ...patch, id, docId: existing?.docId || id }), message: "Courier updated successfully." };
}

/** Enable / disable / archive / restore. Never deletes the record. */
export async function setCourierState(identity, input = {}) {
  const store = await getStore();
  const id = carrierId(input.id);
  const state = String(input.state || "");
  const patches = { active: { active: true, archived: false }, inactive: { active: false }, archived: { active: false, archived: true } };
  if (!patches[state]) throw new ValidationError("Unknown courier state.", "state");
  const existing = await store.findCourierDoc(id);
  const base = existing || builtInCarrier(id);
  if (!base) throw new ServiceError("not_found", "This courier no longer exists. Refresh the list and try again.", 404);
  const now = new Date().toISOString();
  const patch = { ...patches[state], updatedAt: now, updatedBy: identity.sub };
  const entry = audit(identity, `courier.${state}`, id);
  if (existing) await store.updateCourier(existing.docId, patch, entry);
  else await store.createCourier(id, { id, name: base.name, prefix: base.prefix, type: base.type, ...patch, createdAt: now, createdBy: identity.sub }, entry);
  const label = { active: "enabled", inactive: "disabled", archived: "archived" }[state];
  return { ok: true, message: `Courier ${label}.` };
}
