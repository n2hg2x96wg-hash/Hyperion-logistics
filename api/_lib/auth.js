// Server-side admin authentication & authorization.
// Two accepted credentials:
//   1. Signed, HttpOnly session cookie issued by POST /api/admin {action:"login"} (password in ADMIN_PASSWORD env).
//   2. Firebase ID token (Authorization: Bearer ...) carrying a custom claim admin:true (optional `role` claim).
import crypto from "node:crypto";
import { ROLES } from "../../shared/status.js";
import { getStore } from "./store/index.js";

const COOKIE = "hx_admin";
export const SESSION_TTL_MS = 30 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV !== "production" && process.env.STORE === "memory") return "dev-only-session-secret-change-me";
  return null; // fail closed
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (data, key) => crypto.createHmac("sha256", key).update(data).digest("base64url");

export function adminConfigured() {
  return !!(secret() && (process.env.ADMIN_PASSWORD || process.env.FIREBASE_ADMIN_CLAIM_ONLY));
}

export function checkPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof candidate !== "string") return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function issueSession({ sub = "admin", role = "admin" } = {}) {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not configured");
  const payload = b64(JSON.stringify({ sub, role, exp: Date.now() + SESSION_TTL_MS, n: crypto.randomBytes(6).toString("hex") }));
  return `${payload}.${sign(payload, key)}`;
}

export function sessionCookie(token, { clear = false, secure = true } = {}) {
  const attrs = [`${COOKIE}=${clear ? "" : token}`, "Path=/api", "HttpOnly", "SameSite=Strict", `Max-Age=${clear ? 0 : Math.floor(SESSION_TTL_MS / 1000)}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function verifySession(token) {
  const key = secret();
  if (!key || !token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = sign(payload, key);
  const a = Buffer.from(sig || ""); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now() || !ROLES[data.role]) return null;
    return { sub: data.sub, role: data.role, exp: data.exp, via: "session" };
  } catch { return null; }
}

/** Returns {sub, role} or null. Never throws. */
export async function authenticateAdmin(req) {
  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = verifySession(cookies[COOKIE]);
  if (fromCookie) return fromCookie;

  const authz = req.headers.authorization || "";
  if (authz.startsWith("Bearer ")) {
    try {
      const store = await getStore();
      const claims = store.verifyIdToken ? await store.verifyIdToken(authz.slice(7)) : null;
      if (claims && claims.admin === true) {
        const role = ROLES[claims.role] ? claims.role : "admin";
        return { sub: claims.email || claims.uid || "firebase-admin", role, via: "firebase" };
      }
    } catch { /* invalid token => unauthenticated */ }
  }
  return null;
}

/** Same-origin guard for state-changing requests (defence in depth beside SameSite=Strict). */
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (they still need credentials)
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return new URL(origin).host === host;
  } catch { return false; }
}
