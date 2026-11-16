from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from climasure.data.providers import SyntheticProvider
from climasure.models import DailyWeather
from climasure.triggers.contracts import Contract, ContractIn, Peril, TriggerSpec
from climasure.triggers.engine import backtest, compute_index, evaluate_contract, payout_fraction, verify_evaluation
from climasure.triggers.templates import TEMPLATES, build_triggers

START = date(2025, 7, 1)


def days(rains, start=START, tmax=None):
    tmax = tmax or [30.0] * len(rains)
    return [DailyWeather(date=start + timedelta(days=i), rain_mm=r, tmax_c=t) for i, (r, t) in enumerate(zip(rains, tmax))]


def spec(**kw):
    base = dict(peril=Peril.DROUGHT, window_start=START, window_end=START + timedelta(days=9), trigger=100, exit=50)
    base.update(kw)
    return TriggerSpec(**base)


def contract(*specs, si=100_000):
    body = ContractIn(policy_ref="P1", insured_ref="F1", lat=12.0, lon=8.5, sum_insured=si, triggers=list(specs))
    return Contract(**body.model_dump(), client_id="cli_test", cell_id="c")


# -- indices -----------------------------------------------------------------


def test_drought_index_is_cumulative_rain():
    assert compute_index(spec(), days([5, 10, 0, 2.5]))[0] == 17.5


def test_excess_rain_rolling_max():
    s = spec(peril=Peril.EXCESS_RAIN, trigger=50, exit=100, rolling_days=3)
    value, detail = compute_index(s, days([0, 10, 40, 30, 0, 5]))
    assert value == 80
    assert detail["worst_period_start"] == "2025-07-02"


def test_heat_counts_days_at_or_above_threshold():
    s = spec(peril=Peril.HEAT, trigger=2, exit=5, heat_threshold_c=38)
    assert compute_index(s, days([0] * 4, tmax=[37.9, 38.0, 41, 30]))[0] == 2


def test_dry_spell_longest_run():
    s = spec(peril=Peril.DRY_SPELL, trigger=5, exit=10, dry_day_mm=1.0)
    value, detail = compute_index(s, days([5, 0, 0.5, 0, 3, 0, 0, 0, 0, 2]))
    assert value == 4
    assert detail["longest_spell_start"] == "2025-07-06"


# -- payout rules --------------------------------------------------------------


@pytest.mark.parametrize("index,expected", [(120, 0), (100, 0), (75, 0.5), (50, 1), (10, 1)])
def test_drought_payout_is_linear(index, expected):
    assert payout_fraction(spec(), index) == expected


@pytest.mark.parametrize("index,expected", [(50, 0), (75, 0.5), (100, 1), (200, 1)])
def test_excess_rain_payout_is_linear(index, expected):
    assert payout_fraction(spec(peril=Peril.EXCESS_RAIN, trigger=50, exit=100), index) == expected


def test_minimum_payout_applies_once_triggered():
    s = spec(min_payout_pct=20)
    assert payout_fraction(s, 99) == 0.2
    assert payout_fraction(s, 100) == 0


def test_invalid_terms_rejected():
    with pytest.raises(ValidationError):
        spec(trigger=50, exit=100)  # drought: exit must be below trigger
    with pytest.raises(ValidationError):
        spec(peril=Peril.HEAT, trigger=10, exit=5)
    with pytest.raises(ValidationError):
        contract(spec(share=0.7), spec(share=0.7))  # shares > 1


# -- evaluation ----------------------------------------------------------------


def test_drought_pays_only_after_window_closes():
    c = contract(spec())
    data = days([5] * 10)  # 50 mm total -> full payout at close
    mid = evaluate_contract(c, data, START + timedelta(days=4), "test")
    assert mid.results[0].status == "monitoring"
    assert mid.total_payout == 0
    final = evaluate_contract(c, data, START + timedelta(days=9), "test")
    assert final.results[0].status == "final"
    assert final.total_payout == 100_000


def test_excess_rain_can_pay_mid_window():
    c = contract(spec(peril=Peril.EXCESS_RAIN, trigger=50, exit=100))
    ev = evaluate_contract(c, days([0, 75, 0]), START + timedelta(days=2), "test")
    assert ev.results[0].status == "triggered"
    assert ev.total_payout == 50_000


def test_missing_data_blocks_automatic_payout():
    c = contract(spec())
    data = days([0] * 10)
    data[3].rain_mm = None  # 1 of 10 days missing = 10% > 5% limit
    ev = evaluate_contract(c, data, START + timedelta(days=9), "test")
    assert ev.results[0].status == "insufficient_data"
    assert ev.total_payout == 0


def test_shares_split_the_sum_insured():
    c = contract(spec(share=0.6), spec(peril=Peril.DRY_SPELL, trigger=3, exit=6, share=0.4))
    ev = evaluate_contract(c, days([0] * 10), START + timedelta(days=9), "test")
    assert ev.total_payout == 100_000
    assert [r.payout_amount for r in ev.results] == [60_000, 40_000]


def test_not_started():
    ev = evaluate_contract(contract(spec()), [], START - timedelta(days=1), "test")
    assert ev.results[0].status == "not_started"


# -- evidence ------------------------------------------------------------------


def test_evidence_hash_verifies_and_detects_tampering():
    c = contract(spec())
    ev = evaluate_contract(c, days([5] * 10), START + timedelta(days=9), "test")
    assert verify_evaluation(c, ev)

    tampered = ev.model_copy(deep=True)
    tampered.data[0].rain_mm = 0.0
    assert not verify_evaluation(c, tampered)

    other_terms = c.model_copy(update={"sum_insured": 200_000})
    assert not verify_evaluation(other_terms, ev)


def test_evaluation_is_deterministic():
    c = contract(spec())
    a = evaluate_contract(c, days([5] * 10), START + timedelta(days=9), "test")
    b = evaluate_contract(c, days([5] * 10), START + timedelta(days=9), "test")
    assert a.evidence_hash == b.evidence_hash


# -- templates & backtest ------------------------------------------------------


@pytest.mark.parametrize("name", list(TEMPLATES))
def test_templates_build_valid_triggers(name):
    triggers = build_triggers(name, 2026)
    assert triggers and all(t.window_start.year == 2026 for t in triggers)


def test_backtest_summary():
    c = contract(*build_triggers("maize_drought_north", 2025))
    result = backtest(c, SyntheticProvider(), years=10)
    assert len(result["seasons"]) == 10
    assert 0 <= result["payout_frequency"] <= 1
    assert result["seasons"][0]["season_start"].startswith("2024")


def test_synthetic_drought_scenario_is_drier():
    lat, lon, a, b = 12.0, 8.5, date(2025, 6, 1), date(2025, 9, 30)
    normal = sum(d.rain_mm for d in SyntheticProvider("normal").daily_history(lat, lon, a, b))
    dry = sum(d.rain_mm for d in SyntheticProvider("drought").daily_history(lat, lon, a, b))
    assert dry < 0.5 * normal
