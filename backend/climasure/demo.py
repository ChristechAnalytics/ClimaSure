"""Public demo account.

With CLIMASURE_DEMO_MODE=true the API seeds one fictional client, "Kano Farmers
MFB", with 12 policies for the most recent season that has already closed, and
hands its API key to anyone who asks (POST /v1/demo/session). Visitors can then
settle the season and watch payouts appear without any setup.

The demo client is wiped and re-seeded on startup, every
CLIMASURE_DEMO_RESET_HOURS, and on request. It cannot send webhooks and can
hold at most DEMO_MAX_CONTRACTS policies. Other client accounts are untouched.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from climasure.config import Settings
from climasure.db import Store
from climasure.geo import cell_id
from climasure.triggers.contracts import Contract
from climasure.triggers.templates import TEMPLATES, build_triggers

DEMO_CLIENT_ID = "cli_demo"
DEMO_NAME = "Kano Farmers MFB (demo)"
DEMO_MAX_CONTRACTS = 300

LAGOS_TZ = timezone(timedelta(hours=1))

# Fictional borrowers at approximate town centres in Kano State (same as samples/kano-policies.csv).
# (number, insured prefix, lat, lon, sum insured NGN, template, crop)
DEMO_POLICIES = [
    (1, "BORROWER", 12.00, 8.52, 200_000, "maize_drought_north", "maize"),  # Kano city
    (2, "BORROWER", 11.83, 8.60, 150_000, "maize_drought_north", "maize"),  # Dawakin Kudu
    (3, "BORROWER", 12.23, 8.24, 250_000, "maize_drought_north", "maize"),  # Bichi
    (4, "BORROWER", 11.92, 7.93, 180_000, "maize_drought_north", "maize"),  # Gwarzo
    (5, "BORROWER", 11.81, 8.84, 220_000, "maize_drought_north", "maize"),  # Wudil
    (6, "BORROWER", 11.56, 8.58, 160_000, "maize_drought_north", "maize"),  # Rano
    (7, "BORROWER", 11.77, 8.43, 300_000, "maize_drought_north", "maize"),  # Kura
    (8, "BORROWER", 11.86, 9.00, 175_000, "maize_drought_north", "maize"),  # Gaya
    (9, "BORROWER", 11.25, 8.40, 210_000, "maize_drought_north", "maize"),  # Tudun Wada
    (10, "BORROWER", 12.43, 8.52, 190_000, "maize_drought_north", "maize"),  # Dambatta
    (11, "POULTRY", 12.01, 8.55, 400_000, "poultry_heat", "poultry"),  # Kano city
    (12, "POULTRY", 11.98, 8.49, 350_000, "poultry_heat", "poultry"),  # Kano city
]


def demo_api_key(settings: Settings) -> str:
    """Stable for a given deployment (derived from the admin key), so visitors' tabs survive a reset."""
    digest = hmac.new(settings.admin_api_key.encode(), b"climasure-public-demo", hashlib.sha256).hexdigest()
    return f"cs_live_demo_{digest[:32]}"


def is_demo_client(settings: Settings, client: dict) -> bool:
    return settings.demo_mode and client.get("id") == DEMO_CLIENT_ID


def demo_season_year(today: Optional[date] = None) -> int:
    """Latest year in which every demo policy's risk window has closed, so the season can be settled now."""
    yesterday = (today or datetime.now(LAGOS_TZ).date()) - timedelta(days=1)
    templates = {p[5] for p in DEMO_POLICIES}
    year = yesterday.year
    while True:
        last_close = max(t.window_end for name in templates for t in build_triggers(name, year))
        if last_close <= yesterday:
            return year
        year -= 1


def reset_demo(store: Store, settings: Settings, today: Optional[date] = None) -> dict:
    """Wipe the demo client and seed it again with fresh, unsettled policies."""
    season = demo_season_year(today)
    store.delete_client(DEMO_CLIENT_ID)
    store.create_client(DEMO_NAME, None, False, client_id=DEMO_CLIENT_ID, api_key=demo_api_key(settings))
    for num, prefix, lat, lon, sum_insured, template, crop in DEMO_POLICIES:
        contract = Contract(
            policy_ref=f"KFM-{season}-{num:04d}",
            insured_ref=f"KN-{prefix}-{num:04d}",
            lat=lat,
            lon=lon,
            sum_insured=sum_insured,
            crop=crop,
            triggers=build_triggers(template, season),
            client_id=DEMO_CLIENT_ID,
            cell_id=cell_id(lat, lon, settings.grid_resolution_deg),
        )
        store.insert_contract(contract.model_dump(mode="json"))
    return {"season_year": season, "reset_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def demo_info(settings: Settings, provider_name: str, state: dict) -> dict:
    templates = sorted({p[5] for p in DEMO_POLICIES})
    return {
        "name": DEMO_NAME,
        "season_year": state["season_year"],
        "policies": len(DEMO_POLICIES),
        "products": {name: TEMPLATES[name]["description"] for name in templates},
        "provider": provider_name,
        "resets_every_hours": settings.demo_reset_hours or None,
        "last_reset_at": state["reset_at"],
    }
