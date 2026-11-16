import json
import time
from datetime import date

import pytest
from fastapi.testclient import TestClient

from climasure.api import create_app
from climasure.config import get_settings
from climasure.data.providers import SyntheticProvider
from climasure.db import Store
from climasure.notify import sign, verify_signature

SEASON = date.today().year - 1


@pytest.fixture
def ctx():
    store = Store(":memory:")
    app = create_app(settings=get_settings(), provider=SyntheticProvider(scenario="drought"), store=store)
    http = TestClient(app)
    r = http.post("/v1/admin/clients", json={"name": "Test MFI"}, headers={"X-Admin-Key": "test-admin"})
    assert r.status_code == 201
    creds = r.json()
    http.headers["X-API-Key"] = creds["api_key"]
    return http, store, creds


def maize_body(ref="POL-1"):
    return {
        "template": "maize_drought_north",
        "season_year": SEASON,
        "policy_ref": ref,
        "insured_ref": "FARMER-1",
        "lat": 12.0,
        "lon": 8.52,
        "sum_insured": 200000,
    }


def test_auth_required(ctx):
    http, _, _ = ctx
    assert http.get("/v1/me", headers={"X-API-Key": "nope"}).status_code == 401
    assert http.post("/v1/admin/clients", json={"name": "x"}, headers={"X-Admin-Key": "wrong"}).status_code == 401


def test_full_settlement_flow(ctx):
    http, _, _ = ctx
    c = http.post("/v1/contracts/from-template", json=maize_body()).json()
    assert c["cell_id"].startswith("r0.05_")

    ev = http.post(f"/v1/contracts/{c['id']}/evaluate", params={"as_of": f"{SEASON}-12-31"}).json()
    assert ev["total_payout"] > 0
    payout = ev["payout"]
    assert payout["status"] == "pending_approval"
    assert payout["amount"] == ev["total_payout"]

    # Re-evaluating never raises the same payout twice.
    again = http.post(f"/v1/contracts/{c['id']}/evaluate", params={"as_of": f"{SEASON}-12-31"}).json()
    assert again["payout"] is None

    verified = http.get(f"/v1/evaluations/{ev['evaluation_id']}/verify").json()
    assert verified["verified"] is True

    full = http.get(f"/v1/evaluations/{ev['evaluation_id']}").json()
    assert len(full["data"]) > 100  # every daily value used is kept as evidence

    assert http.post(f"/v1/payouts/{payout['id']}/mark-paid", json={"note": "x"}).status_code == 409
    assert http.post(f"/v1/payouts/{payout['id']}/approve").json()["status"] == "approved"
    assert http.post(f"/v1/payouts/{payout['id']}/mark-paid").status_code == 422  # needs a reference
    paid = http.post(f"/v1/payouts/{payout['id']}/mark-paid", json={"note": "MOMO-REF-123"}).json()
    assert paid["status"] == "paid" and paid["note"] == "MOMO-REF-123"

    assert http.get(f"/v1/contracts/{c['id']}").json()["status"] == "expired"


def test_auto_approve(ctx):
    http, _, _ = ctx
    http.patch("/v1/me", json={"auto_approve": True})
    c = http.post("/v1/contracts/from-template", json=maize_body()).json()
    ev = http.post(f"/v1/contracts/{c['id']}/evaluate", params={"as_of": f"{SEASON}-12-31"}).json()
    assert ev["payout"]["status"] == "approved"


def test_duplicate_policy_ref(ctx):
    http, _, _ = ctx
    assert http.post("/v1/contracts/from-template", json=maize_body()).status_code == 201
    assert http.post("/v1/contracts/from-template", json=maize_body()).status_code == 409


def test_bulk_upload_reports_bad_rows(ctx):
    http, _, _ = ctx
    good = {
        "policy_ref": "B1",
        "insured_ref": "F1",
        "lat": 11.5,
        "lon": 8.0,
        "sum_insured": 50000,
        "triggers": [{"peril": "drought", "window_start": f"{SEASON}-06-15", "window_end": f"{SEASON}-09-30", "trigger": 400, "exit": 200}],
    }
    bad = {**good, "policy_ref": "B2", "triggers": [{**good["triggers"][0], "exit": 500}]}
    r = http.post("/v1/contracts/bulk", json=[good, bad]).json()
    assert r["created"] == 1
    assert r["errors"][0]["row"] == 1


def test_tenants_are_isolated(ctx):
    http, _, _ = ctx
    c = http.post("/v1/contracts/from-template", json=maize_body()).json()
    other = http.post("/v1/admin/clients", json={"name": "Other"}, headers={"X-Admin-Key": "test-admin"}).json()
    r = http.get(f"/v1/contracts/{c['id']}", headers={"X-API-Key": other["api_key"]})
    assert r.status_code == 404


def test_backtest_and_climatology(ctx):
    http, _, _ = ctx
    body = maize_body()
    triggers = http.get("/v1/templates/maize_drought_north", params={"season_year": SEASON}).json()["triggers"]
    contract = {k: body[k] for k in ("policy_ref", "insured_ref", "lat", "lon", "sum_insured")} | {"triggers": triggers}
    bt = http.post("/v1/backtest", json={"contract": contract, "years": 5}).json()
    assert len(bt["seasons"]) == 5 and "indicative_premium" in bt

    clim = http.get("/v1/climatology", params={"lat": 12, "lon": 8.5, "start_month": 6, "end_month": 9, "years": 5}).json()
    assert len(clim["seasons"]) == 5


def test_index_query(ctx):
    http, _, _ = ctx
    r = http.post(
        "/v1/index",
        json={"lat": 12, "lon": 8.5, "trigger": {"peril": "drought", "window_start": f"{SEASON}-06-01", "window_end": f"{SEASON}-09-30", "trigger": 400, "exit": 200}},
    ).json()
    assert r["index_value"] >= 0 and 0 <= r["payout_fraction_if_settled_now"] <= 1


def test_future_as_of_rejected(ctx):
    http, _, _ = ctx
    c = http.post("/v1/contracts/from-template", json=maize_body()).json()
    assert http.post(f"/v1/contracts/{c['id']}/evaluate", params={"as_of": "2999-01-01"}).status_code == 422


def test_daily_batch_and_webhook_log(ctx):
    http, _, _ = ctx
    for i in range(3):
        http.post("/v1/contracts/from-template", json=maize_body(f"POL-{i}"))
    summary = http.post("/v1/admin/run-daily", params={"as_of": f"{SEASON}-12-31"}, headers={"X-Admin-Key": "test-admin"}).json()
    assert summary["evaluated"] == 3 and summary["payouts_raised"] == 3
    events = [d["event"] for d in http.get("/v1/webhooks/deliveries").json()]
    assert events.count("payout.triggered") == 3  # logged even with no URL configured


def test_webhook_signature_roundtrip():
    body = json.dumps({"hello": "world"})
    ts = int(time.time())
    header = f"t={ts},v1={sign('whsec_x', ts, body)}"
    assert verify_signature("whsec_x", header, body)
    assert not verify_signature("whsec_y", header, body)
    assert not verify_signature("whsec_x", header, body + " ")
    old = ts - 3600
    assert not verify_signature("whsec_x", f"t={old},v1={sign('whsec_x', old, body)}", body)


def test_summary_counts_policies_and_payouts(ctx):
    http, _, _ = ctx
    c = http.post("/v1/contracts/from-template", json=maize_body()).json()
    http.post("/v1/contracts/from-template", json=maize_body("POL-2"))
    assert http.get("/v1/summary").json()["contracts"]["active"] == {"count": 2, "sum_insured": 400000.0}

    ev = http.post(f"/v1/contracts/{c['id']}/evaluate", params={"as_of": f"{SEASON}-12-31"}).json()
    s = http.get("/v1/summary").json()
    assert s["payouts"]["pending_approval"]["amount"] == ev["payout"]["amount"]
    assert s["contracts"]["expired"]["count"] == 1


def test_admin_lists_clients_with_policy_counts(ctx):
    http, _, creds = ctx
    http.post("/v1/contracts/from-template", json=maize_body())
    assert http.get("/v1/admin/clients", headers={"X-Admin-Key": "wrong"}).status_code == 401
    rows = http.get("/v1/admin/clients", headers={"X-Admin-Key": "test-admin"}).json()
    mine = next(r for r in rows if r["id"] == creds["client_id"])
    assert mine["contracts"] == 1 and "key_hash" not in mine and "webhook_secret" not in mine


def test_root_redirects_to_docs(ctx):
    http, _, _ = ctx
    r = http.get("/", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/docs"
