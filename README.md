# ClimaSure: Hyperlocal Weather Insurance Triggers

ClimaSure sells rainfall and heat data to insurers and microfinance banks, so they
can pay farmers automatically when drought or flood hits. **The weather data
settles the claim. There is no claims adjuster.**


```
Farmer buys cover through an MFI / insurer
        │
        ▼
ClimaSure measures rainfall & heat on a ~5 km grid every day
        │
        ▼
Index crosses the agreed trigger ──► payout instruction + evidence hash sent to the insurer (webhook)
        │
        ▼
Insurer pays the farmer by mobile money / bank, usually within days of the season closing
```

## Why it matters

Traditional crop insurance needs someone to visit each farm and assess the loss.
For a smallholder with ₦150,000 of cover, that visit can cost more than the
premium, so the cover is never offered. Parametric (index) cover removes the
visit: the contract pays when the measured index crosses a level agreed up
front. ClimaSure provides the index, the payout calculation and the audit trail.

## What's in this repo

```
hyperlocal-wi-triggers/
├── backend/             Python API (FastAPI): trigger engine, data, storage, webhooks
├── frontend/            Web dashboard (Next.js 16, React 19, Tailwind CSS 4)
├── samples/             Test data, e.g. Kano policies CSV for the dashboard upload
├── .github/workflows/   CI: backend tests, frontend lint, type-check and build
└── docker-compose.yml   Runs the API, dashboard and daily job together
```

| Folder | Details |
|---|---|
| [backend/](backend/) | [backend/README.md](backend/README.md): setup, tests, code layout |
| [frontend/](frontend/) | [frontend/README.md](frontend/README.md): screens, code layout |
| [samples/](samples/) | [samples/README.md](samples/README.md): what the test data contains |

### Supported perils

| Peril | Index | Bad when | Pays |
|---|---|---|---|
| `drought` | Total rainfall in the window (mm) | Low | At window close |
| `dry_spell` | Longest run of dry days | High | As soon as triggered |
| `excess_rain` | Highest rolling N-day rainfall (mm) | High | As soon as triggered |
| `heat` | Days with max temperature ≥ threshold | High | As soon as triggered |

Payouts rise linearly from 0% at the trigger level to 100% at the exit level.
A contract can combine several triggers, each with a share of the sum insured.

## Quick start

Needs Python 3.10+ and Node.js 20+.

**Terminal 1: backend**

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn climasure.api:app --reload --env-file .env    # API on http://localhost:8000
```

**Terminal 2: dashboard**

```bash
cd frontend
npm install
npm run dev                                       # open http://localhost:3000
```

In the dashboard, click **ClimaSure staff: manage client accounts**, enter the
admin key from `backend/.env` (`dev-admin-key-change-me` by default), create a
client, then click **Open the dashboard as …**. To load test policies, upload
[samples/kano-policies.csv](samples/kano-policies.csv) on
**Policies → Upload CSV**.

Other useful commands (from `backend/`):

```bash
python -m scripts.demo    # whole flow on synthetic data, no server needed
python -m pytest          # backend tests
```

For a demo where payouts happen, set `CLIMASURE_SYNTHETIC_SCENARIO=drought` in
`backend/.env` and restart the backend.

### Try the API directly

```bash
# Create a client account (admin key from backend/.env)
curl -X POST localhost:8000/v1/admin/clients \
  -H "X-Admin-Key: dev-admin-key-change-me" -H "Content-Type: application/json" \
  -d '{"name": "Demo MFI"}'
# -> save the api_key from the response

# Register a policy from a template
curl -X POST localhost:8000/v1/contracts/from-template \
  -H "X-API-Key: <api_key>" -H "Content-Type: application/json" \
  -d '{"template":"maize_drought_north","season_year":2025,"policy_ref":"POL-1",
       "insured_ref":"FARMER-1","lat":12.0,"lon":8.52,"sum_insured":200000}'

# Settle it
curl -X POST "localhost:8000/v1/contracts/<contract_id>/evaluate?as_of=2025-12-31" \
  -H "X-API-Key: <api_key>"
```

Set `CLIMASURE_WEATHER_PROVIDER=open-meteo` to use real data. Commercial use of
Open-Meteo needs a paid API key (`CLIMASURE_OPEN_METEO_API_KEY`).

### Docker

```bash
cp backend/.env.example backend/.env   # edit it first
docker compose up --build
```

This starts the API (port 8000), the dashboard (port 3000) and the daily
settlement job.

## Documentation

- [Backend](backend/README.md): API setup and code layout
- [Frontend](frontend/README.md): dashboard screens and code layout
- API reference: run the backend and open http://localhost:8000/docs for the
  interactive reference to every endpoint

Business, product design, data methodology and compliance documents are
available on request.

## Status

v0.1, pre-pilot. The engine, API, evidence trail, webhooks and web dashboard
work end to end and are tested. Before the first live contract: switch to a licensed data
source, calibrate products against local yield data with an insurer's actuary,
move to Postgres, and complete regulatory approval.
