"""Evidence hashing.

Every evaluation stores the exact data it used and a SHA-256 hash over
(contract terms + data + results). An insurer, reinsurer or regulator can
re-run the engine on the stored data and check the hash matches. This is what
replaces the claims adjuster: the payout is reproducible by anyone.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def sha256_hex(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()
