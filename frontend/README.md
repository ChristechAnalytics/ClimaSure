# ClimaSure dashboard (frontend)

The web app insurers and microfinance banks use to run ClimaSure: register farmer
policies, watch indices during the season, approve and record payouts, and
design new products. Built with **Next.js 16** (App Router), **React 19**,
**TypeScript** and **Tailwind CSS 4**.

It talks only to the ClimaSure API (the Python backend in [../backend](../backend/)).
Browser requests go to `/api/*` on this app, and Next.js forwards them to the
backend, so no cross-origin setup is needed.

## Run it

You need the backend running first (see [../backend/README.md](../backend/README.md)):

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn climasure.api:app --reload --env-file .env      # http://localhost:8000
```

Then, in a second terminal:

```powershell
cd frontend
npm install          # first time only
npm run dev          # http://localhost:3000
```

Open http://localhost:3000.

1. Click **ClimaSure staff: manage client accounts**, enter the admin key from the
   backend's `.env` (`CLIMASURE_ADMIN_API_KEY`), and create a client.
2. Click **Open the dashboard as …** to sign in as that client.
3. Optional: upload [../samples/kano-policies.csv](../samples/kano-policies.csv)
   on **Policies → Upload CSV** for test data.

To point at a backend somewhere else, copy `.env.example` to `.env.local` and
set `CLIMASURE_API_URL`.

## Screens

| Route | What it does |
|---|---|
| `/login` | Sign in with a client API key (kept in this browser tab only) |
| `/` | Overview: totals, map of policies, latest payouts |
| `/policies` | Search and filter policies |
| `/policies/new` | Create one policy: pick location on a map, load a template, edit triggers |
| `/policies/upload` | Bulk upload from CSV, with per-row error report |
| `/policies/[id]` | Trigger gauges, weather chart, evidence (verify / download), payouts, "Check now" |
| `/payouts` | Approve, reject, mark paid (with payment reference), export approved to CSV |
| `/design` | Season rainfall history and product backtests with charts |
| `/settings` | Webhook URL, auto-approve, notification log |
| `/admin` | ClimaSure staff: create clients, list clients, run daily settlement |

## Code layout

```
src/
  app/
    layout.tsx               root layout: fonts, session + toast providers
    login/  admin/           pages outside the signed-in area
    (dashboard)/             signed-in pages; layout.tsx wraps them in AuthGate
  components/
    session.tsx              sign-in state (API key in sessionStorage)
    auth-gate.tsx            redirects to /login, renders sidebar + page
    feedback.tsx             toasts and the text-prompt dialog
    ui.tsx                   Button, Card, Tile, Badge, Table, Field…
    chart.tsx                single-series SVG chart with tooltip + data table
    meter.tsx                trigger gauge (payout zone vs current index)
    policy-map.tsx           Leaflet / OpenStreetMap map
    trigger-editor.tsx       trigger rows + template picker
  hooks/use-load.ts          data loading and busy-state helpers
  lib/                       API client, types, formatting, CSV
```

Colours are design tokens in `src/app/globals.css` (light and dark mode),
exposed to Tailwind as `bg-surface`, `text-ink-2`, `border-line`, and so on.
Status badges always pair a colour dot with a text label.

## Checks

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

## Notes

- Pages load data in the browser using the signed-in client's key, so they
  render after sign-in rather than on the server. `next.config.ts` limits
  Next.js instant-navigation checks to pages that opt in.
- Maps load OpenStreetMap tiles from the internet. For production volumes use
  a commercial tile provider.
