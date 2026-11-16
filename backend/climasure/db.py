"""SQLite storage. Swap for Postgres in production."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    webhook_url TEXT,
    webhook_secret TEXT NOT NULL,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    policy_ref TEXT NOT NULL,
    cell_id TEXT NOT NULL,
    status TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (client_id, policy_ref)
);
CREATE INDEX IF NOT EXISTS ix_contracts_status ON contracts(status);
CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id),
    client_id TEXT NOT NULL,
    as_of TEXT NOT NULL,
    total_payout REAL NOT NULL,
    evidence_hash TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_evaluations_contract ON evaluations(contract_id, created_at);
CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id),
    client_id TEXT NOT NULL,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    insured_ref TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payouts_client_status ON payouts(client_id, status);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    event TEXT NOT NULL,
    url TEXT,
    ok INTEGER NOT NULL,
    status_code INTEGER,
    error TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


class Store:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self.lock = threading.Lock()

    def _exec(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def _all(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    def _one(self, sql: str, params: tuple = ()) -> Optional[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, params).fetchone()

    # -- clients ------------------------------------------------------------

    def create_client(self, name: str, webhook_url: Optional[str], auto_approve: bool) -> dict:
        client_id = new_id("cli")
        api_key = "cs_live_" + secrets.token_urlsafe(32)
        webhook_secret = "whsec_" + secrets.token_urlsafe(24)
        self._exec(
            "INSERT INTO clients VALUES (?,?,?,?,?,?,?)",
            (client_id, name, hash_key(api_key), webhook_url, webhook_secret, int(auto_approve), now_iso()),
        )
        return {"client_id": client_id, "name": name, "api_key": api_key, "webhook_secret": webhook_secret}

    def client_by_key(self, api_key: str) -> Optional[dict]:
        row = self._one("SELECT * FROM clients WHERE key_hash = ?", (hash_key(api_key),))
        return dict(row) if row else None

    def get_client(self, client_id: str) -> Optional[dict]:
        row = self._one("SELECT * FROM clients WHERE id = ?", (client_id,))
        return dict(row) if row else None

    def update_client(self, client_id: str, **fields: Any) -> None:
        allowed = {k: v for k, v in fields.items() if k in {"webhook_url", "auto_approve"}}
        for k, v in allowed.items():
            self._exec(f"UPDATE clients SET {k} = ? WHERE id = ?", (v, client_id))

    def list_clients(self) -> list[dict]:
        rows = self._all(
            """SELECT c.id, c.name, c.webhook_url, c.auto_approve, c.created_at,
                      (SELECT COUNT(*) FROM contracts k WHERE k.client_id = c.id) AS contracts
               FROM clients c ORDER BY c.created_at, c.rowid"""
        )
        return [dict(r) for r in rows]

    def summary(self, client_id: str) -> dict:
        """Portfolio totals for the dashboard overview."""
        contracts = {
            r["status"]: {"count": r["n"], "sum_insured": round(r["si"] or 0, 2)}
            for r in self._all(
                "SELECT status, COUNT(*) AS n, SUM(json_extract(body, '$.sum_insured')) AS si FROM contracts WHERE client_id = ? GROUP BY status",
                (client_id,),
            )
        }
        payouts = {
            r["status"]: {"count": r["n"], "amount": round(r["amt"] or 0, 2)}
            for r in self._all("SELECT status, COUNT(*) AS n, SUM(amount) AS amt FROM payouts WHERE client_id = ? GROUP BY status", (client_id,))
        }
        return {"contracts": contracts, "payouts": payouts}

    # -- contracts ----------------------------------------------------------

    def insert_contract(self, contract: dict) -> None:
        self._exec(
            "INSERT INTO contracts VALUES (?,?,?,?,?,?,?)",
            (
                contract["id"],
                contract["client_id"],
                contract["policy_ref"],
                contract["cell_id"],
                contract["status"],
                json.dumps(contract),
                now_iso(),
            ),
        )

    def get_contract(self, contract_id: str, client_id: Optional[str] = None) -> Optional[dict]:
        if client_id:
            row = self._one("SELECT body FROM contracts WHERE id = ? AND client_id = ?", (contract_id, client_id))
        else:
            row = self._one("SELECT body FROM contracts WHERE id = ?", (contract_id,))
        return json.loads(row["body"]) if row else None

    def list_contracts(self, client_id: Optional[str], status: Optional[str], limit: int = 100, offset: int = 0) -> list[dict]:
        sql, params = "SELECT body FROM contracts WHERE 1=1", []
        if client_id:
            sql += " AND client_id = ?"
            params.append(client_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY rowid LIMIT ? OFFSET ?"
        params += [limit, offset]
        return [json.loads(r["body"]) for r in self._all(sql, tuple(params))]

    def set_contract_status(self, contract_id: str, status: str) -> None:
        c = self.get_contract(contract_id)
        if c is None:
            return
        c["status"] = status
        self._exec("UPDATE contracts SET status = ?, body = ? WHERE id = ?", (status, json.dumps(c), contract_id))

    # -- evaluations --------------------------------------------------------

    def insert_evaluation(self, contract: dict, evaluation: dict) -> str:
        eval_id = new_id("evl")
        self._exec(
            "INSERT INTO evaluations VALUES (?,?,?,?,?,?,?,?)",
            (
                eval_id,
                contract["id"],
                contract["client_id"],
                evaluation["as_of"],
                evaluation["total_payout"],
                evaluation["evidence_hash"],
                json.dumps(evaluation),
                now_iso(),
            ),
        )
        return eval_id

    def get_evaluation(self, eval_id: str, client_id: Optional[str] = None) -> Optional[dict]:
        sql, params = "SELECT * FROM evaluations WHERE id = ?", [eval_id]
        if client_id:
            sql += " AND client_id = ?"
            params.append(client_id)
        row = self._one(sql, tuple(params))
        if not row:
            return None
        return {"id": row["id"], "created_at": row["created_at"], **json.loads(row["body"])}

    def list_evaluations(self, contract_id: str) -> list[dict]:
        rows = self._all(
            "SELECT id, as_of, total_payout, evidence_hash, created_at FROM evaluations WHERE contract_id = ? ORDER BY created_at DESC, rowid DESC",
            (contract_id,),
        )
        return [dict(r) for r in rows]

    def last_evaluation(self, contract_id: str) -> Optional[dict]:
        rows = self.list_evaluations(contract_id)
        return self.get_evaluation(rows[0]["id"]) if rows else None

    # -- payouts ------------------------------------------------------------

    def payouts_total(self, contract_id: str) -> float:
        """Everything already raised for this contract, including rejected ones, so we never re-raise."""
        row = self._one("SELECT COALESCE(SUM(amount), 0) AS s FROM payouts WHERE contract_id = ?", (contract_id,))
        return float(row["s"])

    def insert_payout(self, contract: dict, evaluation_id: str, amount: float, status: str) -> dict:
        p = {
            "id": new_id("pay"),
            "contract_id": contract["id"],
            "client_id": contract["client_id"],
            "evaluation_id": evaluation_id,
            "insured_ref": contract["insured_ref"],
            "amount": amount,
            "currency": contract["currency"],
            "status": status,
            "note": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        self._exec("INSERT INTO payouts VALUES (?,?,?,?,?,?,?,?,?,?,?)", tuple(p.values()))
        return p

    def get_payout(self, payout_id: str, client_id: str) -> Optional[dict]:
        row = self._one("SELECT * FROM payouts WHERE id = ? AND client_id = ?", (payout_id, client_id))
        return dict(row) if row else None

    def list_payouts(self, client_id: str, status: Optional[str] = None, contract_id: Optional[str] = None) -> list[dict]:
        sql, params = "SELECT * FROM payouts WHERE client_id = ?", [client_id]
        if status:
            sql += " AND status = ?"
            params.append(status)
        if contract_id:
            sql += " AND contract_id = ?"
            params.append(contract_id)
        return [dict(r) for r in self._all(sql + " ORDER BY created_at DESC, rowid DESC", tuple(params))]

    def update_payout(self, payout_id: str, status: str, note: Optional[str]) -> None:
        self._exec("UPDATE payouts SET status = ?, note = ?, updated_at = ? WHERE id = ?", (status, note, now_iso(), payout_id))

    # -- webhooks -----------------------------------------------------------

    def log_delivery(self, client_id: str, event: str, url: Optional[str], ok: bool, status_code: Optional[int], error: Optional[str], payload: dict) -> None:
        self._exec(
            "INSERT INTO webhook_deliveries VALUES (?,?,?,?,?,?,?,?,?)",
            (new_id("whd"), client_id, event, url, int(ok), status_code, error, json.dumps(payload, default=str), now_iso()),
        )

    def list_deliveries(self, client_id: str, limit: int = 50) -> list[dict]:
        rows = self._all("SELECT * FROM webhook_deliveries WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?", (client_id, limit))
        return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]
