"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    db_path: str
    weather_provider: str  # "synthetic" or "open-meteo"
    admin_api_key: str
    webhook_timeout_s: float
    grid_resolution_deg: float
    timezone: str
    demo_mode: bool = False  # public demo: seeded fictional client, open sign-in, periodic reset
    demo_reset_hours: float = 24.0  # 0 = only reset on startup or when a visitor asks


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def get_settings() -> Settings:
    return Settings(
        db_path=os.getenv("CLIMASURE_DB_PATH", "climasure.db"),
        weather_provider=os.getenv("CLIMASURE_WEATHER_PROVIDER", "synthetic"),
        admin_api_key=os.getenv("CLIMASURE_ADMIN_API_KEY", "dev-admin-key-change-me"),
        webhook_timeout_s=float(os.getenv("CLIMASURE_WEBHOOK_TIMEOUT_S", "5")),
        grid_resolution_deg=float(os.getenv("CLIMASURE_GRID_RESOLUTION_DEG", "0.05")),
        timezone=os.getenv("CLIMASURE_TIMEZONE", "Africa/Lagos"),
        demo_mode=_flag("CLIMASURE_DEMO_MODE"),
        demo_reset_hours=float(os.getenv("CLIMASURE_DEMO_RESET_HOURS", "24")),
    )
