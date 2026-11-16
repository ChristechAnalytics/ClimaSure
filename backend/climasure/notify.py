"""Signed webhooks.

Header: X-ClimaSure-Signature: t=<unix-ts>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
Clients verify with their webhook secret.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Optional

from climasure.db import Store, new_id


def sign(secret: str, timestamp: int, body: str) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()


def verify_signature(secret: str, header: str, body: str, tolerance_s: int = 300) -> bool:
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts = int(parts["t"])
    except (ValueError, KeyError):
        return False
    if abs(time.time() - ts) > tolerance_s:
        return False
    return hmac.compare_digest(sign(secret, ts, body), parts.get("v1", ""))


def send_event(store: Store, client: dict, event: str, data: dict, timeout_s: float = 5.0) -> bool:
    """Send one event. Always logged, even when the client has no webhook URL configured."""
    payload = {"id": new_id("evt"), "type": event, "created": int(time.time()), "data": data}
    url: Optional[str] = client.get("webhook_url")
    if not url:
        store.log_delivery(client["id"], event, None, False, None, "no webhook_url configured", payload)
        return False

    import requests

    body = json.dumps(payload, default=str, separators=(",", ":"))
    ts = int(time.time())
    headers = {
        "Content-Type": "application/json",
        "X-ClimaSure-Event": event,
        "X-ClimaSure-Signature": f"t={ts},v1={sign(client['webhook_secret'], ts, body)}",
    }
    try:
        resp = requests.post(url, data=body, headers=headers, timeout=timeout_s)
        ok = 200 <= resp.status_code < 300
        store.log_delivery(client["id"], event, url, ok, resp.status_code, None if ok else resp.text[:300], payload)
        return ok
    except requests.RequestException as exc:
        store.log_delivery(client["id"], event, url, False, None, str(exc)[:300], payload)
        return False
