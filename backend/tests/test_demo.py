from dataclasses import replace
from datetime import date

import pytest
from fastapi.testclient import TestClient

from climasure.api import create_app
from climasure.config import get_settings
from climasure.data.providers import SyntheticProvider
from climasure.db import Store
from climasure.demo import DEMO_CLIENT_ID, DEMO_POLICIES, demo_season_year

ADMIN = {"X-Admin-Key": "test-admin"}


def make(demo: bool):
    store = Store(":memory:")
    settings = replace(get_settings(), demo_mode=demo)
    app = create_app(settings=settings, provider=SyntheticProvider(scenario="drought"), store=store)
    return TestClient(app), store


@pytest.fixture
def demo():
    http, store = make(demo=True)
    key = http.post("/v1/demo/session").json()["api_key"]
    http.headers["X-API-Key"] = key
    return http, store


def test_demo_endpoints_hidden_when_off():
    http, store = make(demo=False)
    assert http.get("/v1/demo").status_code == 404
    assert http.post("/v1/demo/session").status_code == 404
    assert store.get_client(DEMO_CLIENT_ID) is None


def test_session_signs_in_to_seeded_portfolio(demo):
    http, _ = demo
    me = http.get("/v1/me").json()
    assert me["id"] == DEMO_CLIENT_ID and me["demo"] is True
    contracts = http.get("/v1/contracts").json()
    assert len(contracts) == len(DEMO_POLICIES)
    assert all(c["status"] == "active" for c in contracts)
    assert http.get("/v1/payouts").json() == []


def test_settle_season_then_reset(demo):
    http, _ = demo
    summary = http.post("/v1/contracts/evaluate-all").json()
    assert summary["evaluated"] == len(DEMO_POLICIES)
    assert summary["payouts_raised"] > 0  # synthetic drought scenario
    assert len(http.get("/v1/payouts").json()) == summary["payouts_raised"]

    # Settled policies expire, so a second run has nothing left to do.
    assert http.post("/v1/contracts/evaluate-all").json()["evaluated"] == 0

    info = http.post("/v1/demo/reset").json()
    assert info["policies"] == len(DEMO_POLICIES)
    assert http.get("/v1/payouts").json() == []  # same key still works after a reset
    assert all(c["status"] == "active" for c in http.get("/v1/contracts").json())


def test_demo_cannot_set_webhook(demo):
    http, _ = demo
    r = http.patch("/v1/me", json={"webhook_url": "http://169.254.169.254/latest/meta-data"})
    assert r.status_code == 403
    assert http.patch("/v1/me", json={"auto_approve": True}).json()["auto_approve"] == 1


def test_only_demo_account_can_reset(demo):
    http, _ = demo
    other = http.post("/v1/admin/clients", json={"name": "Real MFI"}, headers=ADMIN).json()
    assert http.post("/v1/demo/reset", headers={"X-API-Key": other["api_key"]}).status_code == 403
    # A real client's data survives a demo reset.
    http.patch("/v1/me", json={"auto_approve": False})
    http.post("/v1/demo/reset")
    assert http.get("/v1/me", headers={"X-API-Key": other["api_key"]}).status_code == 200


def test_demo_policy_cap(demo, monkeypatch):
    http, _ = demo
    monkeypatch.setattr("climasure.api.DEMO_MAX_CONTRACTS", len(DEMO_POLICIES))
    body = {
        "template": "maize_drought_north", "season_year": 2025, "policy_ref": "EXTRA-1",
        "insured_ref": "X", "lat": 12.0, "lon": 8.5, "sum_insured": 1000,
    }
    assert http.post("/v1/contracts/from-template", json=body).status_code == 403


def test_season_year_is_always_closed():
    assert demo_season_year(date(2026, 11, 16)) == 2026  # maize window closed 30 Sep
    assert demo_season_year(date(2026, 9, 30)) == 2025  # 29 Sep is still inside the window
    assert demo_season_year(date(2026, 10, 1)) == 2026


def test_evaluate_all_is_scoped_to_caller():
    http, _ = make(demo=False)
    a = http.post("/v1/admin/clients", json={"name": "A"}, headers=ADMIN).json()["api_key"]
    b = http.post("/v1/admin/clients", json={"name": "B"}, headers=ADMIN).json()["api_key"]
    season = date.today().year - 1
    body = {"template": "maize_drought_north", "season_year": season, "policy_ref": "P1",
            "insured_ref": "F1", "lat": 12.0, "lon": 8.52, "sum_insured": 100000}
    http.post("/v1/contracts/from-template", json=body, headers={"X-API-Key": a})
    assert http.post("/v1/contracts/evaluate-all", headers={"X-API-Key": b}).json()["evaluated"] == 0
    assert http.post("/v1/contracts/evaluate-all", headers={"X-API-Key": a}).json()["evaluated"] == 1
