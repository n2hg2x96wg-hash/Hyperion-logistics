// Notification architecture. Nothing is sent unless a provider is explicitly configured on the server:
//   NOTIFY_WEBHOOK_URL (+ optional NOTIFY_WEBHOOK_SECRET) -> POSTs a signed JSON payload for each customer-relevant event.
//   RESEND_API_KEY + NOTIFY_EMAIL_FROM (+ SITE_URL for the tracking link) -> e-mails the customer, but only for
//     shipments where an admin entered an optional notification address (shipment.notifyEmail).
// Add more providers by implementing { id, enabled(), applies(shipment), send(payload, shipment) } and registering below.
// Delivery is de-duplicated per provider + shipment + event id via store.claimNotification (only real, committed
// events reach here), and credentials never leave the server.
import crypto from "node:crypto";
import { STATUS, resolveVisibility } from "../../shared/status.js";

const NOTIFY_STATUSES = new Set([STATUS.CREATED, STATUS.PICKED_UP, STATUS.IN_TRANSIT, STATUS.AT_FACILITY,
  STATUS.DELAYED, STATUS.OUT_FOR_DELIVERY, STATUS.DELIVERED]);
const SUPPORT_EMAIL = "hyperionlogistics.com@gmail.com";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"; };

/** The milestone e-mail: only what the customer's own tracking page shows (status, recorded place, recorded time). */
export function milestoneEmail(payload) {
  const site = String(process.env.SITE_URL || "").replace(/\/+$/, "");
  const link = site ? `${site}/track.html?code=${encodeURIComponent(payload.trackingCode)}` : "";
  const when = fmtTime(payload.occurredAt);
  const subject = `Your shipment ${payload.trackingCode}: ${payload.title}`;
  const lines = [`Your shipment ${payload.trackingCode} has a new recorded milestone.`, "", `Milestone: ${payload.title}`,
    payload.location ? `Recorded at: ${payload.location}` : null, when ? `Recorded: ${when}` : null, "",
    link ? `Track your shipment: ${link}` : `Track your shipment on our website with your tracking number.`,
    `Questions? E-mail ${SUPPORT_EMAIL}.`, "", "Hyperion Logistics"].filter((l) => l !== null);
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1a3d;max-width:560px">
<p>Your shipment <strong>${esc(payload.trackingCode)}</strong> has a new recorded milestone.</p>
<table style="border-collapse:collapse;margin:12px 0"><tr><td style="padding:4px 12px 4px 0;color:#44557a">Milestone</td><td style="padding:4px 0"><strong>${esc(payload.title)}</strong></td></tr>
${payload.location ? `<tr><td style="padding:4px 12px 4px 0;color:#44557a">Recorded at</td><td style="padding:4px 0">${esc(payload.location)}</td></tr>` : ""}
${when ? `<tr><td style="padding:4px 12px 4px 0;color:#44557a">Recorded</td><td style="padding:4px 0">${esc(when)}</td></tr>` : ""}</table>
${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">Track your shipment</a></p>` : "<p>Track your shipment on our website with your tracking number.</p>"}
<p style="color:#44557a;font-size:13px">Questions? E-mail <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.<br>Hyperion Logistics</p></div>`;
  return { subject, text: lines.join("\n"), html };
}

const providers = [
  {
    id: "webhook",
    enabled: () => !!process.env.NOTIFY_WEBHOOK_URL,
    applies: () => true,
    async send(payload) {
      const body = JSON.stringify(payload);
      const headers = { "Content-Type": "application/json" };
      if (process.env.NOTIFY_WEBHOOK_SECRET) {
        headers["X-Hyperion-Signature"] = crypto.createHmac("sha256", process.env.NOTIFY_WEBHOOK_SECRET).update(body).digest("hex");
      }
      const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    }
  },
  {
    id: "email",
    enabled: () => !!(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_FROM),
    applies: (shipment) => !!shipment?.notifyEmail,
    async send(payload, shipment) {
      // respect the shipment's client visibility: no place unless the tracking page would show it
      const { subject, text, html } = milestoneEmail({ ...payload, location: resolveVisibility(shipment.visibility).location ? payload.location : null });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `hx-${shipment.id}-${payload.eventId}` },
        body: JSON.stringify({ from: process.env.NOTIFY_EMAIL_FROM, to: [shipment.notifyEmail], subject, text, html, reply_to: SUPPORT_EMAIL })
      });
      if (!res.ok) throw new Error(`email provider responded ${res.status}`);
    }
  }
];

export function notificationsConfigured() { return providers.some((p) => p.enabled()); }
/** Names of the configured providers (never their settings). */
export function configuredProviders() { return providers.filter((p) => p.enabled()).map((p) => p.id); }

export async function notifyEvents(store, shipment, events) {
  const active = providers.filter((p) => p.enabled());
  if (!active.length) return { sent: 0 };
  let sent = 0;
  for (const event of events) {
    if (event.kind === "location" || event.kind === "manual" && !NOTIFY_STATUSES.has(event.statusCode)) continue;
    if (!event.statusCode || !NOTIFY_STATUSES.has(event.statusCode) || event.clientVisible === false) continue;
    for (const provider of active) {
      if (!provider.applies(shipment)) continue; // checked before claiming, so adding an address later is not blocked
      const key = `${provider.id}_${shipment.id}_${event.id}`;
      if (!(await store.claimNotification(key))) continue;
      try {
        await provider.send({
          type: "shipment.event", trackingCode: shipment.id, status: event.statusCode, title: event.title,
          location: event.location || null, occurredAt: event.timestamp, eventId: event.id
        }, shipment);
        sent += 1;
      } catch (err) { console.error(`[notifications] ${provider.id} failed`, err.message); }
    }
  }
  return { sent };
}
