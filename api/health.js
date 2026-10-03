// PUBLIC deployment health check: GET /api/health
// Reports only booleans (never secret values) so you can confirm configuration after deploying.
import { send } from "./_lib/http.js";
import { getStore } from "./_lib/store/index.js";

export default async function handler(req, res) {
  const env = (k) => !!process.env[k];
  const checks = {
    firebaseServiceAccount: env("FIREBASE_SERVICE_ACCOUNT"),
    adminPassword: env("ADMIN_PASSWORD"),
    sessionSecret: (process.env.SESSION_SECRET || "").length >= 16,
    customMapTiles: env("MAP_TILE_URL"),
    notifications: env("NOTIFY_WEBHOOK_URL"),
    courierWebhook: env("PROVIDER_GENERIC_SECRET")
  };
  let database = "unknown";
  try {
    const store = await getStore();
    await Promise.race([store.getShipment("HEALTHCHECK-PROBE"), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    database = `ok (${store.kind})`;
  } catch { database = "unreachable - check FIREBASE_SERVICE_ACCOUNT"; }
  const ready = checks.firebaseServiceAccount && checks.adminPassword && checks.sessionSecret && database.startsWith("ok");
  send(res, ready ? 200 : 503, {
    ready,
    database,
    required: { FIREBASE_SERVICE_ACCOUNT: checks.firebaseServiceAccount, ADMIN_PASSWORD: checks.adminPassword, SESSION_SECRET_16plus_chars: checks.sessionSecret },
    optional: { MAP_TILE_URL: checks.customMapTiles, NOTIFY_WEBHOOK_URL: checks.notifications, PROVIDER_GENERIC_SECRET: checks.courierWebhook },
    nextStep: ready ? "Ready. Open /admin.html, sign in, and run the data migration from the dashboard." : "Set the missing required environment variables in Vercel, then redeploy."
  });
}
