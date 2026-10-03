// Notification architecture. The project has NO existing email/SMS/push provider (only the Smartsupp chat
// widget), so nothing is sent unless a provider is explicitly configured:
//   NOTIFY_WEBHOOK_URL (+ optional NOTIFY_WEBHOOK_SECRET) -> POSTs a signed JSON payload for each customer-relevant event.
// Add more providers by implementing { id, enabled(), send(payload) } and registering below.
// Delivery is de-duplicated per event id via store.claimNotification, and credentials never leave the server.
import crypto from "node:crypto";
import { STATUS } from "../../shared/status.js";

const NOTIFY_STATUSES = new Set([STATUS.CREATED, STATUS.PICKED_UP, STATUS.IN_TRANSIT, STATUS.AT_FACILITY,
  STATUS.DELAYED, STATUS.OUT_FOR_DELIVERY, STATUS.DELIVERED]);

const providers = [
  {
    id: "webhook",
    enabled: () => !!process.env.NOTIFY_WEBHOOK_URL,
    async send(payload) {
      const body = JSON.stringify(payload);
      const headers = { "Content-Type": "application/json" };
      if (process.env.NOTIFY_WEBHOOK_SECRET) {
        headers["X-Hyperion-Signature"] = crypto.createHmac("sha256", process.env.NOTIFY_WEBHOOK_SECRET).update(body).digest("hex");
      }
      const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    }
  }
];

export function notificationsConfigured() { return providers.some((p) => p.enabled()); }

export async function notifyEvents(store, shipment, events) {
  const active = providers.filter((p) => p.enabled());
  if (!active.length) return { sent: 0 };
  let sent = 0;
  for (const event of events) {
    if (event.kind === "location" || event.kind === "manual" && !NOTIFY_STATUSES.has(event.statusCode)) continue;
    if (!event.statusCode || !NOTIFY_STATUSES.has(event.statusCode) || event.clientVisible === false) continue;
    for (const provider of active) {
      const key = `${provider.id}_${shipment.id}_${event.id}`;
      if (!(await store.claimNotification(key))) continue;
      try {
        await provider.send({
          type: "shipment.event", trackingCode: shipment.id, status: event.statusCode, title: event.title,
          location: event.location || null, occurredAt: event.timestamp, eventId: event.id
        });
        sent += 1;
      } catch (err) { console.error(`[notifications] ${provider.id} failed`, err.message); }
    }
  }
  return { sent };
}
