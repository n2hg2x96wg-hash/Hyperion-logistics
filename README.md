# Hyperion Logistics

Static site (Vercel) + serverless API (`/api`) + Firestore.

- `track.html`, `index.html`, `tracking-enhanced.html` – public tracking (shared component in `tracker/`)
- `admin.html` + `admin/center.js` – Admin Control Center (authenticated via `/api/admin`)
- `api/` – `track` (public lookup), `stream` (SSE), `admin`, `provider` (courier/GPS webhook), `config`
- `api/_lib/` – service layer, store adapters (Firestore / in-memory), client-view whitelist, auth, providers
- `shared/status.js` – single status engine used by server and browser (incl. Live / Last known location rules)
- `shared/carriers.js` – built-in carrier catalog; add a carrier by adding one entry, or in Admin → Couriers (saved through `/api/admin`, `api/_lib/couriers.js`; records are archived, never deleted)
- `tracker/session.js` – temporary tracking session (code kept in memory only, cleared on reload/leave/idle)
- `ui/motion.js`, `ui/motion.css`, `ui/site.css` – scroll reveal motion system and shared mobile fixes
- `ui/tokens.css` – design tokens (navy / electric blue) shared by the public site, tracker and admin (`admin/console.css`)
- `ui/globe/` – command-center map: `globe.js` (MapLibre 3D globe, lazy, capability-gated), `flatmap.js` (Leaflet fallback),
  `command-center.js` (data polling, activity feed, statistics, route card); used by the homepage and Admin → Global Tracking
- `api/public.js` + `api/_lib/public-view.js` – public homepage data (statistics, opted-in masked routes, carrier directory)
- `api/_lib/geo.js`, `assets/geo/countries-110m.json`, `shared/countries.js` – country detection from recorded coordinates
  (Natural Earth 110m, public domain) or place text

Local: `npm install && npm run dev` (in-memory demo data, admin password `dev-password`). Tests: `npm test`.
**Going live: follow [SETUP.md](SETUP.md).** Health check after deploy: `/api/health`.

Tests: `npm test` (in-memory) and `npm run test:emulator` (Firestore emulator on 127.0.0.1:8085).
Note: the two client-account tests need Firebase Auth test data and only pass on the in-memory store.
