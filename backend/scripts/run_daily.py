"""Daily settlement job: evaluate every active contract and raise payouts.

Schedule once a day after the previous day's data is published, e.g. 09:00 Lagos.
  Linux cron:      0 9 * * *  cd /app && python -m scripts.run_daily
  Windows:         schtasks /create /sc daily /st 09:00 /tn climasure-daily /tr "python -m scripts.run_daily"

Usage: python -m scripts.run_daily [--as-of YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone

from climasure.config import get_settings
from climasure.data.providers import get_provider
from climasure.db import Store
from climasure.triggers.service import run_all_active


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", type=date.fromisoformat, default=None)
    args = parser.parse_args()
    as_of = args.as_of or (datetime.now(timezone(timedelta(hours=1))).date() - timedelta(days=1))

    settings = get_settings()
    summary = run_all_active(Store(settings.db_path), get_provider(settings.weather_provider), as_of)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
