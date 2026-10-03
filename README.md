# Hyperion Logistics

Static site (Vercel) + serverless API (`/api`) + Firestore.

- `track.html`, `index.html`, `tracking-enhanced.html` – public tracking (shared component in `tracker/`)
- `admin.html` + `admin/center.js` – Admin Control Center (authenticated via `/api/admin`)
- `api/` – `track` (public lookup), `stream` (SSE), `admin`, `provider` (courier/GPS webhook), `config`
- `api/_lib/` – service layer, store adapters (Firestore / in-memory), client-view whitelist, auth, providers
- `shared/status.js` – single status engine used by server and browser (incl. Live / Last known location rules)
- `shared/carriers.js` – built-in carrier catalog; add a carrier by adding one entry (or a Firestore `couriers` doc)
- `tracker/session.js` – temporary tracking session (code kept in memory only, cleared on reload/leave/idle)
- `ui/motion.js`, `ui/motion.css`, `ui/site.css` – scroll reveal motion system and shared mobile fixes

Local: `npm install && npm run dev` (in-memory demo data, admin password `dev-password`). Tests: `npm test`.
**Going live: follow [SETUP.md](SETUP.md).** Health check after deploy: `/api/health`.

Tests: `npm test` (in-memory) and `npm run test:emulator` (Firestore emulator on 127.0.0.1:8085).
