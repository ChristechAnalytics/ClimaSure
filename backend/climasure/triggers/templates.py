"""Starter product templates.

Thresholds are ILLUSTRATIVE starting points. Every product must be calibrated
for its location with a backtest (POST /v1/backtest) and agreed with the
insurer's actuary before sale.
"""

from __future__ import annotations

from datetime import date

from climasure.triggers.contracts import Peril, TriggerSpec

TEMPLATES: dict[str, dict] = {
    "maize_drought_north": {
        "description": "Rain-fed maize, northern Nigeria. Season rainfall plus mid-season dry spell.",
        "triggers": [
            dict(peril=Peril.DROUGHT, start=(6, 15), end=(9, 30), trigger=450, exit=200, share=0.6, label="Season rainfall"),
            dict(peril=Peril.DRY_SPELL, start=(7, 1), end=(8, 31), trigger=12, exit=25, share=0.4, dry_day_mm=2.0, label="Mid-season dry spell"),
        ],
    },
    "rice_flood": {
        "description": "Lowland rice (e.g. Kebbi, Niger, Benue floodplains). Extreme 3-day rainfall.",
        "triggers": [
            dict(peril=Peril.EXCESS_RAIN, start=(7, 1), end=(10, 15), trigger=150, exit=300, share=1.0, rolling_days=3, label="3-day extreme rain"),
        ],
    },
    "cassava_drought_south": {
        "description": "Cassava / mixed cropping, southern Nigeria. Early-season rainfall shortfall.",
        "triggers": [
            dict(peril=Peril.DROUGHT, start=(4, 1), end=(7, 31), trigger=600, exit=300, share=1.0, label="Early-season rainfall"),
        ],
    },
    "poultry_heat": {
        "description": "Poultry / livestock heat stress, dry-season peak.",
        "triggers": [
            dict(peril=Peril.HEAT, start=(3, 1), end=(5, 31), trigger=15, exit=45, share=1.0, heat_threshold_c=38.0, label="Heat-stress days"),
        ],
    },
}


def build_triggers(template: str, season_year: int) -> list[TriggerSpec]:
    if template not in TEMPLATES:
        raise KeyError(template)
    specs = []
    for t in TEMPLATES[template]["triggers"]:
        t = dict(t)
        sm, sd = t.pop("start")
        em, ed = t.pop("end")
        specs.append(TriggerSpec(window_start=date(season_year, sm, sd), window_end=date(season_year, em, ed), **t))
    return specs
