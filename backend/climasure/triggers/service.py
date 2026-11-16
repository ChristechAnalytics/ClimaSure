"""Evaluate a contract, record evidence, raise payouts and notify the client.

Payouts are raised as *instructions* to the insurer / MFI. ClimaSure never holds or
moves money: the client pays the farmer (mobile money, bank, wallet) and marks
the payout as paid.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from climasure.config import get_settings
from climasure.data.providers import WeatherProvider
from climasure.db import Store
from climasure.notify import send_event
from climasure.triggers.contracts import LOWER_IS_WORSE, Contract
from climasure.triggers.engine import Evaluation, data_span, evaluate_contract

WARNING_RATIO = 0.8  # warn when a high-is-bad index reaches 80% of its trigger


def warnings_for(contract: Contract, ev: Evaluation) -> list[str]:
    """Early warnings so the client can prepare liquidity before a payout lands."""
    out = []
    for spec, r in zip(contract.triggers, ev.results):
        name = spec.label or spec.peril.value
        if r.status == "insufficient_data":
            out.append(f"{name}: data gap, automatic settlement paused")
        elif spec.peril in LOWER_IS_WORSE and r.detail.get("provisional_fraction_if_window_closed_today", 0) > 0:
            out.append(f"{name}: below trigger so far ({r.index_value} vs {spec.trigger})")
        elif spec.peril not in LOWER_IS_WORSE and r.payout_fraction == 0 and r.index_value is not None and r.index_value >= WARNING_RATIO * spec.trigger:
            out.append(f"{name}: approaching trigger ({r.index_value} of {spec.trigger})")
    return out


def run_evaluation(store: Store, provider: WeatherProvider, contract: Contract, as_of: date) -> dict:
    start, end = data_span(contract, as_of)
    data = provider.daily_history(contract.lat, contract.lon, start, end)
    ev = evaluate_contract(contract, data, as_of, provider.name)
    warnings = warnings_for(contract, ev)

    previous = store.last_evaluation(contract.id)
    contract_dict = contract.model_dump(mode="json")
    eval_id = store.insert_evaluation(contract_dict, ev.model_dump(mode="json"))

    client = store.get_client(contract.client_id)
    timeout = get_settings().webhook_timeout_s

    payout: Optional[dict] = None
    delta = round(ev.total_payout - store.payouts_total(contract.id), 2)
    if delta > 0 and contract.status == "active":
        status = "approved" if client and client["auto_approve"] else "pending_approval"
        payout = store.insert_payout(contract_dict, eval_id, delta, status)
        if client:
            send_event(
                store,
                client,
                "payout.triggered",
                {
                    "payout": payout,
                    "contract_id": contract.id,
                    "policy_ref": contract.policy_ref,
                    "evaluation_id": eval_id,
                    "evidence_hash": ev.evidence_hash,
                    "triggers": [r.model_dump(mode="json", include={"label", "peril", "status", "index_value", "trigger", "exit", "payout_amount"}) for r in ev.results],
                },
                timeout,
            )

    had_warnings = bool(previous and warnings_for(contract, Evaluation(**{k: v for k, v in previous.items() if k not in {"id", "created_at"}})))
    if warnings and not had_warnings and client:
        send_event(store, client, "index.warning", {"contract_id": contract.id, "policy_ref": contract.policy_ref, "warnings": warnings}, timeout)

    if as_of >= max(t.window_end for t in contract.triggers) and contract.status == "active":
        store.set_contract_status(contract.id, "expired")

    return {"evaluation_id": eval_id, "evaluation": ev, "warnings": warnings, "payout": payout}


def run_all_active(store: Store, provider: WeatherProvider, as_of: date, client_id: Optional[str] = None) -> dict:
    """Daily batch job: evaluate every active contract whose risk window has started."""
    summary = {"as_of": as_of.isoformat(), "evaluated": 0, "skipped": 0, "payouts_raised": 0, "payout_total": 0.0, "errors": []}
    # Load the full list first: evaluating can flip contracts to "expired", which would shift pages.
    contracts, offset = [], 0
    while batch := store.list_contracts(client_id, "active", limit=500, offset=offset):
        contracts += batch
        offset += len(batch)

    for raw in contracts:
        contract = Contract(**raw)
        if as_of < min(t.window_start for t in contract.triggers):
            summary["skipped"] += 1
            continue
        try:
            res = run_evaluation(store, provider, contract, as_of)
        except Exception as exc:  # one bad contract or data call must not stop the batch
            summary["errors"].append({"contract_id": contract.id, "error": str(exc)[:300]})
            continue
        summary["evaluated"] += 1
        if res["payout"]:
            summary["payouts_raised"] += 1
            summary["payout_total"] = round(summary["payout_total"] + res["payout"]["amount"], 2)
    return summary
