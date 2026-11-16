"""End-to-end demo on synthetic data, no server needed.

Creates a demo MFI client, registers a few farmer policies, prices one with a
backtest, settles last season and verifies the evidence.

Usage: python -m scripts.demo
"""

from __future__ import annotations

import os
import tempfile
from datetime import date

from climasure.data.providers import SyntheticProvider
from climasure.db import Store
from climasure.geo import cell_id
from climasure.triggers.contracts import Contract, ContractIn
from climasure.triggers.engine import Evaluation, backtest, verify_evaluation
from climasure.triggers.service import run_all_active
from climasure.triggers.templates import build_triggers

FARMS = [
    # insured_ref, lat, lon, template, sum insured (NGN)
    ("KN-coop-001", 12.00, 8.52, "maize_drought_north", 250_000),  # Kano
    ("KD-coop-014", 10.52, 7.44, "maize_drought_north", 180_000),  # Kaduna
    ("KB-rice-007", 12.45, 4.20, "rice_flood", 300_000),  # Kebbi
    ("OY-cass-022", 7.85, 3.93, "cassava_drought_south", 150_000),  # Oyo
]


def main() -> None:
    season = date.today().year - 1
    db_path = os.path.join(tempfile.gettempdir(), "climasure-demo.db")
    if os.path.exists(db_path):
        os.remove(db_path)
    store = Store(db_path)
    provider = SyntheticProvider(scenario="drought")
    client = store.create_client("Demo Microfinance Bank", webhook_url=None, auto_approve=True)
    print(f"Client: {client['name']} ({client['client_id']})\n")

    for ref, lat, lon, template, si in FARMS:
        body = ContractIn(policy_ref=f"POL-{ref}", insured_ref=ref, lat=lat, lon=lon, sum_insured=si, triggers=build_triggers(template, season))
        c = Contract(**body.model_dump(), client_id=client["client_id"], cell_id=cell_id(lat, lon))
        store.insert_contract(c.model_dump(mode="json"))

    first = Contract(**store.list_contracts(client["client_id"], None)[0])
    bt = backtest(first, SyntheticProvider(), years=20)
    print(f"Backtest {first.policy_ref} over 20 seasons (normal climate): pays in {bt['payout_frequency']:.0%} of years, burn cost {bt['burn_cost_pct']}% of sum insured\n")

    summary = run_all_active(store, provider, date(season, 12, 31))
    print(f"Settled season {season} (synthetic drought scenario): {summary['evaluated']} evaluated, {summary['payouts_raised']} payouts, NGN {summary['payout_total']:,.2f}\n")

    for p in store.list_payouts(client["client_id"]):
        ev = store.get_evaluation(p["evaluation_id"])
        contract = Contract(**store.get_contract(p["contract_id"]))
        ok = verify_evaluation(contract, Evaluation(**{k: v for k, v in ev.items() if k not in {"id", "created_at"}}))
        print(f"  {p['insured_ref']:<13} NGN {p['amount']:>12,.2f}  status={p['status']:<9} evidence={ev['evidence_hash'][:16]}...  verified={ok}")
    print(f"\nDemo database: {db_path}")


if __name__ == "__main__":
    main()
