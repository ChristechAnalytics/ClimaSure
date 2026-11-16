"""HTTP API. Run with: uvicorn climasure.api:app --reload

Interactive docs at /docs.
"""

from __future__ import annotations

import sqlite3
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, HttpUrl, ValidationError

from climasure import __version__
from climasure.config import Settings, get_settings
from climasure.data.providers import WeatherProvider, get_provider
from climasure.db import Store
from climasure.geo import cell_center, cell_id
from climasure.triggers.contracts import Contract, ContractIn, TriggerSpec
from climasure.triggers.engine import Evaluation, backtest, compute_index, payout_fraction, verify_evaluation
from climasure.triggers.service import run_all_active, run_evaluation
from climasure.triggers.templates import TEMPLATES, build_triggers

LAGOS_TZ = timezone(timedelta(hours=1))


def default_as_of() -> date:
    """Yesterday in Lagos: today's rainfall total is not complete yet."""
    return datetime.now(LAGOS_TZ).date() - timedelta(days=1)


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class ClientIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    webhook_url: Optional[HttpUrl] = None
    auto_approve: bool = False


class ClientUpdate(BaseModel):
    webhook_url: Optional[HttpUrl] = None
    auto_approve: Optional[bool] = None


class FromTemplateIn(BaseModel):
    template: str
    season_year: int = Field(ge=1990, le=2100)
    policy_ref: str
    insured_ref: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    sum_insured: float = Field(gt=0)
    currency: str = "NGN"
    crop: Optional[str] = None


class BacktestIn(BaseModel):
    contract: ContractIn
    years: int = Field(default=20, ge=3, le=40)
    loading_factor: float = Field(default=1.5, ge=1.0, le=5.0, description="Multiplier on burn cost for expenses, risk and profit")


class IndexQuery(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    trigger: TriggerSpec
    as_of: Optional[date] = None


class PayoutAction(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500, description="Reason, or the payment reference for mark-paid")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app(settings: Optional[Settings] = None, provider: Optional[WeatherProvider] = None, store: Optional[Store] = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="ClimaSure Weather Triggers API",
        version=__version__,
        description="Hyperlocal rainfall and heat indices for parametric insurance. Pay farmers from the data, with no claims adjuster.",
    )
    app.state.settings = settings
    app.state.store = store or Store(settings.db_path)
    app.state.provider = provider or get_provider(settings.weather_provider)

    def get_store(request: Request) -> Store:
        return request.app.state.store

    def get_prov(request: Request) -> WeatherProvider:
        return request.app.state.provider

    def client_auth(request: Request, x_api_key: str = Header(..., alias="X-API-Key")) -> dict:
        client = request.app.state.store.client_by_key(x_api_key)
        if not client:
            raise HTTPException(401, "invalid API key")
        return client

    def admin_auth(request: Request, x_admin_key: str = Header(..., alias="X-Admin-Key")) -> None:
        if x_admin_key != request.app.state.settings.admin_api_key:
            raise HTTPException(401, "invalid admin key")

    def load_contract(store: Store, contract_id: str, client: dict) -> Contract:
        raw = store.get_contract(contract_id, client["id"])
        if not raw:
            raise HTTPException(404, "contract not found")
        return Contract(**raw)

    def check_as_of(as_of: Optional[date]) -> date:
        as_of = as_of or default_as_of()
        if as_of > datetime.now(LAGOS_TZ).date():
            raise HTTPException(422, "as_of cannot be in the future")
        return as_of

    def create_contract(store: Store, client: dict, body: ContractIn) -> Contract:
        contract = Contract(
            **body.model_dump(),
            client_id=client["id"],
            cell_id=cell_id(body.lat, body.lon, settings.grid_resolution_deg),
        )
        try:
            store.insert_contract(contract.model_dump(mode="json"))
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"policy_ref '{body.policy_ref}' already exists")
        return contract

    # The dashboard is a separate Next.js app (frontend/). The API root points to the docs.
    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse("/docs")

    # -- meta ---------------------------------------------------------------

    @app.get("/health", tags=["meta"])
    def health(request: Request):
        return {"status": "ok", "version": __version__, "provider": request.app.state.provider.name}

    # -- admin --------------------------------------------------------------

    @app.post("/v1/admin/clients", tags=["admin"], dependencies=[Depends(admin_auth)], status_code=201)
    def admin_create_client(body: ClientIn, store: Store = Depends(get_store)):
        """Create an insurer / MFI account. The API key and webhook secret are shown only once."""
        return store.create_client(body.name, str(body.webhook_url) if body.webhook_url else None, body.auto_approve)

    @app.get("/v1/admin/clients", tags=["admin"], dependencies=[Depends(admin_auth)])
    def admin_list_clients(store: Store = Depends(get_store)):
        return store.list_clients()

    @app.post("/v1/admin/run-daily", tags=["admin"], dependencies=[Depends(admin_auth)])
    def admin_run_daily(as_of: Optional[date] = None, store: Store = Depends(get_store), provider: WeatherProvider = Depends(get_prov)):
        """Evaluate every active contract. Normally run by the scheduler (scripts/run_daily.py)."""
        return run_all_active(store, provider, check_as_of(as_of))

    # -- account ------------------------------------------------------------

    @app.get("/v1/me", tags=["account"])
    def me(client: dict = Depends(client_auth)):
        return {k: client[k] for k in ("id", "name", "webhook_url", "auto_approve", "created_at")}

    @app.patch("/v1/me", tags=["account"])
    def update_me(body: ClientUpdate, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        fields = {}
        if "webhook_url" in body.model_fields_set:
            fields["webhook_url"] = str(body.webhook_url) if body.webhook_url else None
        if body.auto_approve is not None:
            fields["auto_approve"] = int(body.auto_approve)
        store.update_client(client["id"], **fields)
        return me(store.get_client(client["id"]))

    @app.get("/v1/summary", tags=["account"])
    def summary(client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        """Policy and payout totals by status, for the dashboard overview."""
        return store.summary(client["id"])

    @app.get("/v1/webhooks/deliveries", tags=["account"])
    def deliveries(limit: int = Query(50, ge=1, le=500), client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        return store.list_deliveries(client["id"], limit)

    # -- product design ------------------------------------------------------

    @app.get("/v1/templates", tags=["design"])
    def list_templates(_: dict = Depends(client_auth)):
        return {name: t["description"] for name, t in TEMPLATES.items()}

    @app.get("/v1/templates/{name}", tags=["design"])
    def get_template(name: str, season_year: int = Query(..., ge=1990, le=2100), _: dict = Depends(client_auth)):
        try:
            return {"template": name, "triggers": build_triggers(name, season_year)}
        except KeyError:
            raise HTTPException(404, "unknown template")

    @app.post("/v1/backtest", tags=["design"])
    def run_backtest(body: BacktestIn, client: dict = Depends(client_auth), provider: WeatherProvider = Depends(get_prov)):
        """Apply proposed terms to past seasons. Returns payout frequency, burn cost and an indicative premium."""
        c = Contract(**body.contract.model_dump(), client_id=client["id"], cell_id=cell_id(body.contract.lat, body.contract.lon, settings.grid_resolution_deg), id="draft")
        result = backtest(c, provider, body.years)
        result["indicative_premium_pct"] = round(result["burn_cost_pct"] * body.loading_factor, 3)
        result["indicative_premium"] = round(c.sum_insured * result["indicative_premium_pct"] / 100, 2)
        result["note"] = "Indicative only. Final pricing is the insurer's actuarial decision."
        return result

    @app.post("/v1/index", tags=["design"])
    def query_index(body: IndexQuery, _: dict = Depends(client_auth), provider: WeatherProvider = Depends(get_prov)):
        """Current value of one index at one location, without creating a contract."""
        as_of = check_as_of(body.as_of)
        end = min(as_of, body.trigger.window_end)
        if end < body.trigger.window_start:
            raise HTTPException(422, "window has not started yet")
        data = provider.daily_history(body.lat, body.lon, body.trigger.window_start, end)
        value, detail = compute_index(body.trigger, data)
        return {
            "cell_id": cell_id(body.lat, body.lon, settings.grid_resolution_deg),
            "cell_center": cell_center(body.lat, body.lon, settings.grid_resolution_deg),
            "provider": provider.name,
            "window_start": body.trigger.window_start,
            "window_end_used": end,
            "index_value": value,
            "payout_fraction_if_settled_now": payout_fraction(body.trigger, value),
            "detail": detail,
        }

    @app.get("/v1/climatology", tags=["design"])
    def climatology(
        lat: float = Query(..., ge=-90, le=90),
        lon: float = Query(..., ge=-180, le=180),
        start_month: int = Query(..., ge=1, le=12),
        end_month: int = Query(..., ge=1, le=12),
        years: int = Query(20, ge=3, le=40),
        _: dict = Depends(client_auth),
        provider: WeatherProvider = Depends(get_prov),
    ):
        """Season rainfall totals for past years. A quick way to choose drought trigger levels."""
        if end_month < start_month:
            raise HTTPException(422, "season must not cross the new year")
        this_year = default_as_of().year
        rows = []
        for y in range(this_year - years, this_year):
            end = (date(y, end_month + 1, 1) - timedelta(days=1)) if end_month < 12 else date(y, 12, 31)
            data = provider.daily_history(lat, lon, date(y, start_month, 1), end)
            rows.append({"year": y, "rain_mm": round(sum(d.rain_mm or 0 for d in data), 1)})
        totals = sorted(r["rain_mm"] for r in rows)
        pct = lambda p: totals[min(len(totals) - 1, int(p * len(totals)))]  # noqa: E731
        return {
            "provider": provider.name,
            "seasons": rows,
            "mean_mm": round(statistics.mean(totals), 1),
            "p10_mm": pct(0.1),
            "p20_mm": pct(0.2),
            "median_mm": pct(0.5),
        }

    # -- contracts ----------------------------------------------------------

    @app.post("/v1/contracts", tags=["contracts"], status_code=201)
    def post_contract(body: ContractIn, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        return create_contract(store, client, body)

    @app.post("/v1/contracts/from-template", tags=["contracts"], status_code=201)
    def post_from_template(body: FromTemplateIn, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        try:
            triggers = build_triggers(body.template, body.season_year)
        except KeyError:
            raise HTTPException(404, "unknown template")
        fields = body.model_dump(exclude={"template", "season_year"})
        return create_contract(store, client, ContractIn(**fields, triggers=triggers))

    @app.post("/v1/contracts/bulk", tags=["contracts"])
    def post_bulk(body: list[dict], client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        """Register up to 5,000 policies in one call. Each row is validated on its own; bad rows don't block good ones."""
        if len(body) > 5000:
            raise HTTPException(413, "max 5000 contracts per call")
        created, errors = [], []
        for i, row in enumerate(body):
            try:
                created.append(create_contract(store, client, ContractIn(**row)).id)
            except ValidationError as exc:
                errors.append({"row": i, "error": exc.errors(include_url=False, include_context=False)})
            except HTTPException as exc:
                errors.append({"row": i, "error": exc.detail})
        return {"created": len(created), "contract_ids": created, "errors": errors}

    @app.get("/v1/contracts", tags=["contracts"])
    def get_contracts(
        status: Optional[Literal["active", "expired", "cancelled"]] = None,
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        client: dict = Depends(client_auth),
        store: Store = Depends(get_store),
    ):
        return store.list_contracts(client["id"], status, limit, offset)

    @app.get("/v1/contracts/{contract_id}", tags=["contracts"])
    def get_contract(contract_id: str, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        return load_contract(store, contract_id, client)

    @app.post("/v1/contracts/{contract_id}/cancel", tags=["contracts"])
    def cancel_contract(contract_id: str, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        load_contract(store, contract_id, client)
        store.set_contract_status(contract_id, "cancelled")
        return load_contract(store, contract_id, client)

    @app.post("/v1/contracts/{contract_id}/evaluate", tags=["contracts"])
    def evaluate(
        contract_id: str,
        as_of: Optional[date] = None,
        client: dict = Depends(client_auth),
        store: Store = Depends(get_store),
        provider: WeatherProvider = Depends(get_prov),
    ):
        """Compute indices now, store the evidence, and raise a payout if one is due."""
        contract = load_contract(store, contract_id, client)
        res = run_evaluation(store, provider, contract, check_as_of(as_of))
        return {
            "evaluation_id": res["evaluation_id"],
            "warnings": res["warnings"],
            "payout": res["payout"],
            **res["evaluation"].model_dump(mode="json", exclude={"data"}),
        }

    @app.get("/v1/contracts/{contract_id}/evaluations", tags=["contracts"])
    def contract_evaluations(contract_id: str, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        load_contract(store, contract_id, client)
        return store.list_evaluations(contract_id)

    # -- evidence -----------------------------------------------------------

    @app.get("/v1/evaluations/{evaluation_id}", tags=["evidence"])
    def get_evaluation(evaluation_id: str, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        """Full evidence record, including every daily data point used."""
        ev = store.get_evaluation(evaluation_id, client["id"])
        if not ev:
            raise HTTPException(404, "evaluation not found")
        return ev

    @app.get("/v1/evaluations/{evaluation_id}/verify", tags=["evidence"])
    def verify(evaluation_id: str, client: dict = Depends(client_auth), store: Store = Depends(get_store)):
        """Re-run the engine on the stored data and confirm the result and evidence hash match."""
        ev = store.get_evaluation(evaluation_id, client["id"])
        if not ev:
            raise HTTPException(404, "evaluation not found")
        contract = load_contract(store, ev["contract_id"], client)
        stored = Evaluation(**{k: v for k, v in ev.items() if k not in {"id", "created_at"}})
        return {"evaluation_id": evaluation_id, "evidence_hash": stored.evidence_hash, "verified": verify_evaluation(contract, stored)}

    # -- payouts ------------------------------------------------------------

    @app.get("/v1/payouts", tags=["payouts"])
    def get_payouts(
        status: Optional[Literal["pending_approval", "approved", "paid", "rejected"]] = None,
        contract_id: Optional[str] = None,
        client: dict = Depends(client_auth),
        store: Store = Depends(get_store),
    ):
        return store.list_payouts(client["id"], status, contract_id)

    transitions = {
        "approve": ({"pending_approval"}, "approved"),
        "reject": ({"pending_approval", "approved"}, "rejected"),
        "mark-paid": ({"approved"}, "paid"),
    }

    @app.post("/v1/payouts/{payout_id}/{action}", tags=["payouts"])
    def payout_action(
        payout_id: str,
        action: Literal["approve", "reject", "mark-paid"],
        body: Optional[PayoutAction] = None,
        client: dict = Depends(client_auth),
        store: Store = Depends(get_store),
    ):
        """approve / reject (with reason) / mark-paid (with payment reference)."""
        p = store.get_payout(payout_id, client["id"])
        if not p:
            raise HTTPException(404, "payout not found")
        allowed_from, to = transitions[action]
        if p["status"] not in allowed_from:
            raise HTTPException(409, f"cannot {action} a payout that is {p['status']}")
        if action in {"reject", "mark-paid"} and not (body and body.note):
            raise HTTPException(422, "note is required (reason for reject, payment reference for mark-paid)")
        store.update_payout(payout_id, to, body.note if body else None)
        return store.get_payout(payout_id, client["id"])

    return app


app = create_app()
