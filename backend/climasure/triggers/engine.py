"""Index calculation, payout rules, evaluation and historical backtesting."""

from __future__ import annotations

import statistics
from datetime import date, timedelta
from typing import Optional

from pydantic import BaseModel

from climasure.data.providers import WeatherProvider
from climasure.models import DailyWeather
from climasure.triggers.audit import sha256_hex
from climasure.triggers.contracts import LOWER_IS_WORSE, Contract, Peril, TriggerSpec

ENGINE_VERSION = "1.0.0"
MAX_MISSING_FRACTION = 0.05  # more than 5% missing days -> no automatic payout


class TriggerResult(BaseModel):
    position: int
    peril: Peril
    label: Optional[str] = None
    status: str  # not_started | monitoring | triggered | final | insufficient_data
    index_value: Optional[float] = None
    trigger: float
    exit: float
    payout_fraction: float = 0.0  # 0..1 of this trigger's share
    payout_amount: float = 0.0
    days_expected: int = 0
    days_observed: int = 0
    detail: dict = {}


class Evaluation(BaseModel):
    contract_id: str
    as_of: date
    provider: str
    engine_version: str = ENGINE_VERSION
    currency: str
    sum_insured: float
    total_payout: float
    results: list[TriggerResult]
    data: list[DailyWeather]
    evidence_hash: str = ""


# ---------------------------------------------------------------------------
# Index functions
# ---------------------------------------------------------------------------


def _value(day: DailyWeather, peril: Peril) -> Optional[float]:
    return day.tmax_c if peril == Peril.HEAT else day.rain_mm


def compute_index(spec: TriggerSpec, days: list[DailyWeather]) -> tuple[float, dict]:
    """Index value over the given (complete, ordered) days. Missing values count as 0 / not-hot."""
    if spec.peril == Peril.DROUGHT:
        total = sum(d.rain_mm or 0.0 for d in days)
        return round(total, 2), {"cumulative_rain_mm": round(total, 2)}

    if spec.peril == Peril.EXCESS_RAIN:
        n = spec.rolling_days
        best, best_start = 0.0, None
        for i in range(len(days)):
            chunk = days[i : i + n]
            if len(chunk) < n and i > 0:
                break
            s = sum(d.rain_mm or 0.0 for d in chunk)
            if s > best:
                best, best_start = s, chunk[0].date
        detail = {"rolling_days": n}
        if best_start:
            detail["worst_period_start"] = best_start.isoformat()
        return round(best, 2), detail

    if spec.peril == Peril.HEAT:
        hot = [d.date.isoformat() for d in days if d.tmax_c is not None and d.tmax_c >= spec.heat_threshold_c]
        return float(len(hot)), {"threshold_c": spec.heat_threshold_c, "hot_days": hot}

    if spec.peril == Peril.DRY_SPELL:
        longest, run, run_start, best_start = 0, 0, None, None
        for d in days:
            if (d.rain_mm or 0.0) < spec.dry_day_mm:
                if run == 0:
                    run_start = d.date
                run += 1
                if run > longest:
                    longest, best_start = run, run_start
            else:
                run = 0
        detail = {"dry_day_mm": spec.dry_day_mm}
        if best_start:
            detail["longest_spell_start"] = best_start.isoformat()
        return float(longest), detail

    raise ValueError(f"unsupported peril {spec.peril}")


def payout_fraction(spec: TriggerSpec, index: float) -> float:
    """Linear payout between trigger and exit, with optional minimum once triggered."""
    if spec.peril in LOWER_IS_WORSE:
        if index >= spec.trigger:
            return 0.0
        f = 1.0 if index <= spec.exit else (spec.trigger - index) / (spec.trigger - spec.exit)
    else:
        if index <= spec.trigger:
            return 0.0
        f = 1.0 if index >= spec.exit else (index - spec.trigger) / (spec.exit - spec.trigger)
    return round(max(f, spec.min_payout_pct / 100.0), 6)


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def data_span(contract: Contract, as_of: date) -> tuple[date, date]:
    start = min(t.window_start for t in contract.triggers)
    end = min(max(t.window_end for t in contract.triggers), as_of)
    return start, max(start, end)


def evaluate_trigger(position: int, spec: TriggerSpec, data: list[DailyWeather], as_of: date, sum_insured: float) -> TriggerResult:
    base = dict(position=position, peril=spec.peril, label=spec.label, trigger=spec.trigger, exit=spec.exit)
    if as_of < spec.window_start:
        return TriggerResult(status="not_started", **base)

    end = min(spec.window_end, as_of)
    expected = (end - spec.window_start).days + 1
    by_date = {d.date: d for d in data}
    window = [
        by_date.get(spec.window_start + timedelta(days=k), DailyWeather(date=spec.window_start + timedelta(days=k)))
        for k in range(expected)
    ]
    observed = sum(1 for d in window if _value(d, spec.peril) is not None)
    window_closed = as_of >= spec.window_end

    if expected - observed > MAX_MISSING_FRACTION * expected:
        return TriggerResult(
            status="insufficient_data",
            days_expected=expected,
            days_observed=observed,
            detail={"reason": "too many missing days for automatic settlement; route to manual review"},
            **base,
        )

    index, detail = compute_index(spec, window)
    fraction = payout_fraction(spec, index)

    # High-is-bad indices can only rise as the window goes on, so a mid-window
    # payout is safe to release early. Drought (cumulative rain) can still
    # recover, so it only pays once the window has closed.
    if spec.peril in LOWER_IS_WORSE and not window_closed:
        detail["provisional_fraction_if_window_closed_today"] = fraction
        fraction = 0.0
        status = "monitoring"
    elif window_closed:
        status = "final"
    else:
        status = "triggered" if fraction > 0 else "monitoring"

    return TriggerResult(
        status=status,
        index_value=index,
        payout_fraction=fraction,
        payout_amount=round(fraction * spec.share * sum_insured, 2),
        days_expected=expected,
        days_observed=observed,
        detail=detail,
        **base,
    )


def evidence_payload(contract: Contract, ev: Evaluation) -> dict:
    terms = contract.model_dump(mode="json", exclude={"status"})
    body = ev.model_dump(mode="json", exclude={"evidence_hash"})
    return {"terms": terms, "evaluation": body}


def evaluate_contract(contract: Contract, data: list[DailyWeather], as_of: date, provider_name: str) -> Evaluation:
    results = [evaluate_trigger(i, t, data, as_of, contract.sum_insured) for i, t in enumerate(contract.triggers)]
    total = round(min(sum(r.payout_amount for r in results), contract.sum_insured), 2)
    start, end = data_span(contract, as_of)
    used = sorted((d for d in data if start <= d.date <= end), key=lambda d: d.date)
    ev = Evaluation(
        contract_id=contract.id,
        as_of=as_of,
        provider=provider_name,
        currency=contract.currency,
        sum_insured=contract.sum_insured,
        total_payout=total,
        results=results,
        data=used,
    )
    ev.evidence_hash = sha256_hex(evidence_payload(contract, ev))
    return ev


def verify_evaluation(contract: Contract, stored: Evaluation) -> bool:
    """Re-run the engine on the stored data and check both the result and the hash."""
    rerun = evaluate_contract(contract, stored.data, stored.as_of, stored.provider)
    return rerun.evidence_hash == stored.evidence_hash == sha256_hex(evidence_payload(contract, stored))


# ---------------------------------------------------------------------------
# Backtest (pricing support for insurers)
# ---------------------------------------------------------------------------


def _shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year - years, day=28)


def backtest(contract: Contract, provider: WeatherProvider, years: int = 20) -> dict:
    """Apply the contract terms to each of the past N seasons.

    Gives the historical payout frequency and burn cost (average payout as % of
    sum insured), which is what an insurer needs to price the cover.
    """
    rows = []
    for y in range(1, years + 1):
        shifted = contract.model_copy(
            update={
                "triggers": [
                    t.model_copy(update={"window_start": _shift_year(t.window_start, y), "window_end": _shift_year(t.window_end, y)})
                    for t in contract.triggers
                ]
            }
        )
        start = min(t.window_start for t in shifted.triggers)
        end = max(t.window_end for t in shifted.triggers)
        data = provider.daily_history(contract.lat, contract.lon, start, end)
        ev = evaluate_contract(shifted, data, end, provider.name)
        rows.append(
            {
                "season_start": start.isoformat(),
                "payout": ev.total_payout,
                "payout_pct": round(100 * ev.total_payout / contract.sum_insured, 2),
                "indices": [r.index_value for r in ev.results],
                "statuses": [r.status for r in ev.results],
            }
        )
    pcts = [r["payout_pct"] for r in rows]
    return {
        "contract_id": contract.id,
        "provider": provider.name,
        "years": years,
        "payout_frequency": round(sum(1 for p in pcts if p > 0) / len(pcts), 3),
        "burn_cost_pct": round(statistics.mean(pcts), 3),
        "burn_cost_std_pct": round(statistics.pstdev(pcts), 3),
        "worst_year_pct": max(pcts),
        "seasons": rows,
    }
