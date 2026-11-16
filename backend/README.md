# ClimaSure API (backend)

The Python service behind ClimaSure: the trigger engine, weather data, storage,
REST API and signed webhooks. Built with **FastAPI** and **SQLite** (Postgres
later). The dashboard in [../frontend](../frontend/) talks only to this API.

## Run it

Needs Python 3.10+. From this folder:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn climasure.api:app --reload --env-file .env    # http://localhost:8000
```

Interactive API docs are at http://localhost:8000/docs.

Other commands (run from this folder):

```powershell
python -m pytest                  # 42 tests: engine, API, evidence, webhooks
python -m scripts.demo            # whole flow on synthetic data, no server needed
python -m scripts.run_daily       # daily settlement job (normally scheduled)
```

For a demo where payouts happen, set `CLIMASURE_SYNTHETIC_SCENARIO=drought` in
`.env` and restart.

## Code layout

| Path | What it is |
|---|---|
| [climasure/triggers/contracts.py](climasure/triggers/contracts.py) | Contract terms: perils, trigger/exit levels, shares |
| [climasure/triggers/engine.py](climasure/triggers/engine.py) | Index calculation, payout rules, evaluation, backtesting |
| [climasure/triggers/service.py](climasure/triggers/service.py) | Evaluate → store evidence → raise payout → notify |
| [climasure/triggers/templates.py](climasure/triggers/templates.py) | Starter products (maize drought, rice flood, cassava, poultry heat) |
| [climasure/triggers/audit.py](climasure/triggers/audit.py) | Evidence hashing |
| [climasure/data/providers.py](climasure/data/providers.py) | Weather data sources (synthetic for demos, Open-Meteo for real data) |
| [climasure/api.py](climasure/api.py) | REST API |
| [climasure/db.py](climasure/db.py) | Storage |
| [climasure/notify.py](climasure/notify.py) | HMAC-signed webhooks |
| [climasure/config.py](climasure/config.py) | Settings from `CLIMASURE_*` environment variables |
| [scripts/](scripts/) | Daily settlement job and demo |
| [tests/](tests/) | Backend tests |

With the API running, open http://localhost:8000/docs for the interactive
reference to every endpoint.
