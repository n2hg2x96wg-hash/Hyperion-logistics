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

## 4. First admin login, backup, migration
1. Open `https://<your-site>/admin.html` and sign in with `ADMIN_PASSWORD`.
2. **Back up first.** Admin → **Settings & Backup** → **Download full backup**. This saves every shipment with its
   tracking events and location history, plus carriers, as one JSON file with a SHA-256 checksum, and records the
   backup in the Activity Log. Keep the file somewhere safe. (Optional extra safety: Google Cloud console →
   Firestore → **Import/Export** → Export, or `gcloud firestore export gs://<bucket>`.)
3. On the Overview, click **Run data migration** (enabled for 2 hours after a backup). It only *adds* fields
   (status codes, search fields, derived countries) to existing shipments; it never removes or rewrites anything,
   and running it again changes nothing.

## 5. Quick check (2 minutes)
1. Admin → **Create Shipment** → fill origin/destination, courier → Save.
2. In **Live Tracking**, enter a location + latitude/longitude → **UPDATE LOCATION**.
3. Open `https://<your-site>/track.html` in another browser/phone, enter the tracking code.
4. Update the location again in admin; the client page updates by itself within seconds.

## 6. Lock down Firestore (only after step 3 shows ready)
Firebase console → **Firestore → Rules** → replace with the contents of `firestore.rules` → **Publish**.
Browsers can then no longer read or write shipment data directly; only the secure API can.

## Public homepage (globe, live activity, statistics)
- Statistics (active, in transit, delivered, countries) are counted from your shipment records; the counting rules
  are shown under "How these numbers are counted" on the homepage.
- **No shipment appears individually on the homepage until you choose it**: Admin → Live Tracking → Client visibility →
  **Show on public homepage**. It is then shown with a masked code (e.g. HY-12••56), city-level origin/destination,
  status, the last recorded position (if "Show current location" is on) and recent event titles. Client names,
  references, notes, addresses, fees and full tracking numbers are never public.
- A shipment needs coordinates (route points or a recorded location) to be drawn on the map.
- The 3D globe (MapLibre GL, free, no key) loads after the page and only on capable devices; slower or older phones,
  data-saver mode and failures fall back automatically to a flat world map. Country shapes come from Natural Earth
  (public domain), so the homepage needs no map key. `?map=flat` / `?map=globe` force a mode for testing.

## Carrier directory
- Shown on the homepage from Admin → Carriers. Each carrier has a category (Express & Parcel, Ocean Freight, Regional,
  Custom), a short description and coverage. Fill these only with what the carrier publishes.
- Logos: wordmark tiles are shown by default. To use an official logo you are licensed to use, set the carrier's
  "Logo / badge" to an `https://` image address.
- Integration status is honest: "Manual updates by Hyperion" unless an official tracking link is set ("Official tracking
  link") or a carrier API adapter is configured AND has delivered a signed update ("Live API connected").
  No carrier API is connected today.

## Map provider (shipment tracking map)
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
