# Hyperion Logistics: go-live checklist

Follow these steps in order. Nothing here touches or deletes existing shipment data.

## 1. Get a Firebase service-account key
1. Firebase console → project **hyperion-logistics** → ⚙️ Project settings → **Service accounts**.
2. Click **Generate new private key** → a `.json` file downloads. Keep it private.

## 2. Add environment variables in Vercel
Vercel → your project → **Settings → Environment Variables** (Production):

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | paste the **entire contents** of the downloaded `.json` file |
| `ADMIN_PASSWORD` | a new, strong admin password (the old one is in git history; don't reuse it) |
| `SESSION_SECRET` | any random text of 32+ characters (e.g. from a password generator) |

Optional: map tiles (see "Map provider" below), `NOTIFY_WEBHOOK_URL` (event notifications),
`PROVIDER_GENERIC_SECRET` (courier/GPS webhook). See `.env.example`.

## 3. Deploy
Merge the pull request (or **Redeploy** in Vercel). Then open:

    https://<your-site>/api/health

It should say `"ready": true` and `"database": "ok (firestore)"`. If not, it tells you which variable is missing.

## 4. First admin login
1. Open `https://<your-site>/admin.html` and sign in with `ADMIN_PASSWORD`.
2. On the Dashboard, click **Run data migration** (one time). It adds search/status fields to existing
   shipments; it never removes anything.

## 5. Quick check (2 minutes)
1. Admin → **Create Shipment** → fill origin/destination, courier → Save.
2. In **Live Tracking**, enter a location + latitude/longitude → **UPDATE LOCATION**.
3. Open `https://<your-site>/track.html` in another browser/phone, enter the tracking code.
4. Update the location again in admin; the client page updates by itself within seconds.

## 6. Lock down Firestore (only after step 3 shows ready)
Firebase console → **Firestore → Rules** → replace with the contents of `firestore.rules` → **Publish**.
Browsers can then no longer read or write shipment data directly; only the secure API can.

## Map provider
The map works with no setup: it uses OpenStreetMap standard tiles (free, no key, attribution shown).
OpenStreetMap asks heavy/commercial sites to use a tile provider, so for production traffic:
1. Create a free account at MapTiler (or Stadia Maps / Mapbox) and copy the **public** key.
2. In the provider dashboard, restrict the key to your domain (e.g. `hyperion-logistics.vercel.app`).
3. In Vercel add `MAP_PROVIDER=maptiler` and `MAP_TILE_KEY=<the key>`, then redeploy.
4. `/api/health` shows `"map": { "provider": "MapTiler Streets", "issues": [] }`.
If the key is wrong or blocked, the map falls back to OpenStreetMap automatically.

## Troubleshooting
- Admin login says "not configured": `ADMIN_PASSWORD` or `SESSION_SECRET` missing → add and redeploy.
- Tracking says "temporarily unavailable": check `/api/health` (usually `FIREBASE_SERVICE_ACCOUNT`).
- Map says "Map background unavailable": no tile server answered; recorded positions are still shown as markers.
- `/api/health` lists map `issues`: e.g. `MAP_PROVIDER=mapbox needs MAP_TILE_KEY`.
