"""Weather data providers.

The trigger engine reads weather only through the `WeatherProvider` interface,
so the data source can change (synthetic -> Open-Meteo -> CHIRPS/TAMSAT/own
stations) without touching contract logic.

- SyntheticProvider: deterministic, offline, Nigeria-like climatology. For
  development, tests and demos. Never use it to settle a real contract.
- OpenMeteoProvider: ERA5-based reanalysis archive plus recent analysis.
  Commercial use requires an Open-Meteo API subscription (CLIMASURE_OPEN_METEO_API_KEY).
"""

from __future__ import annotations

import hashlib
import math
import os
from datetime import date, timedelta
from typing import Protocol

from climasure.models import DailyWeather


class WeatherProvider(Protocol):
    name: str

    def daily_history(self, lat: float, lon: float, start: date, end: date) -> list[DailyWeather]:
        """Observed/reanalysis daily values, inclusive of both ends."""
        ...


# ---------------------------------------------------------------------------
# Synthetic provider
# ---------------------------------------------------------------------------

# Approximate monthly rainfall climatology (mm/month), Jan..Dec.
_SOUTH_RAIN = [30, 50, 100, 150, 200, 320, 250, 120, 220, 180, 60, 20]  # Lagos-like, two peaks
_NORTH_RAIN = [0, 0, 2, 10, 50, 110, 200, 250, 140, 20, 0, 0]  # Kano-like, one peak
_SOUTH_TMAX = [32, 33, 33, 32, 31, 29, 28, 28, 29, 30, 31, 32]
_NORTH_TMAX = [31, 34, 38, 40, 39, 36, 32, 31, 33, 35, 34, 31]


def _rand(*parts: object) -> float:
    """Deterministic uniform [0, 1) from any parts."""
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64


def _blend(lat: float, south: list[float], north: list[float], month: int) -> float:
    w = min(1.0, max(0.0, (lat - 7.5) / (11.0 - 7.5)))
    return south[month - 1] * (1 - w) + north[month - 1] * w


class SyntheticProvider:
    name = "synthetic"

    def __init__(self, scenario: str = "normal", resolution_deg: float = 0.05):
        if scenario not in {"normal", "wet", "drought"}:
            raise ValueError("scenario must be normal, wet or drought")
        self.scenario = scenario
        self.res = resolution_deg

    def _day(self, lat: float, lon: float, d: date) -> DailyWeather:
        cell = (math.floor(lat / self.res), math.floor(lon / self.res))
        region = (math.floor(lat), math.floor(lon))  # 1-degree regions share a "year type"
        days_in_month = 30.4
        monthly = _blend(lat, _SOUTH_RAIN, _NORTH_RAIN, d.month)
        monthly *= 0.55 + 0.9 * _rand("year", region, d.year)  # good and bad years

        p_wet = min(0.85, monthly / (days_in_month * 12.0)) if monthly > 0 else 0.0
        mean_wet = monthly / (days_in_month * p_wet) if p_wet > 0 else 0.0
        if self.scenario == "drought":
            p_wet *= 0.25  # fewer rainy days, same size storms -> ~75% less rain
        rain = 0.0
        if p_wet > 0 and _rand("wet", cell, d) < p_wet:
            rain = -mean_wet * math.log(1 - _rand("amt", cell, d) * 0.999)
            if self.scenario == "wet":
                rain *= 3.0

        tmax = _blend(lat, _SOUTH_TMAX, _NORTH_TMAX, d.month) + (_rand("t", cell, d) - 0.5) * 3
        if self.scenario == "drought":
            tmax += 2.0
        if rain > 1:
            tmax -= 2.0
        diurnal = 8.0 + 7.0 * min(1.0, max(0.0, (lat - 7.5) / 3.5))
        return DailyWeather(date=d, rain_mm=round(rain, 1), tmax_c=round(tmax, 1), tmin_c=round(tmax - diurnal, 1))

    def daily_history(self, lat: float, lon: float, start: date, end: date) -> list[DailyWeather]:
        out, d = [], start
        while d <= end:
            out.append(self._day(lat, lon, d))
            d += timedelta(days=1)
        return out


# ---------------------------------------------------------------------------
# Open-Meteo provider
# ---------------------------------------------------------------------------


class OpenMeteoProvider:
    """Real data via Open-Meteo. The archive lags ~5 days, so recent days come from the forecast API."""

    name = "open-meteo"

    def __init__(self, api_key: str | None = None, timeout_s: float = 20.0):
        import requests  # lazy import so offline use never needs it

        self._requests = requests
        self.api_key = api_key or os.getenv("CLIMASURE_OPEN_METEO_API_KEY") or None
        self.timeout = timeout_s
        prefix = "customer-" if self.api_key else ""
        self.archive_url = f"https://{prefix}archive-api.open-meteo.com/v1/archive"
        self.forecast_url = f"https://{prefix}api.open-meteo.com/v1/forecast"

    def _get(self, url: str, params: dict) -> dict:
        if self.api_key:
            params = {**params, "apikey": self.api_key}
        resp = self._requests.get(url, params=params, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _parse(payload: dict) -> list[DailyWeather]:
        d = payload.get("daily", {})
        return [
            DailyWeather(date=date.fromisoformat(t), rain_mm=r, tmax_c=hi, tmin_c=lo)
            for t, r, hi, lo in zip(
                d.get("time", []),
                d.get("precipitation_sum", []),
                d.get("temperature_2m_max", []),
                d.get("temperature_2m_min", []),
            )
        ]

    def daily_history(self, lat: float, lon: float, start: date, end: date) -> list[DailyWeather]:
        today = date.today()
        end = min(end, today)
        archive_cutoff = today - timedelta(days=6)
        common = {
            "latitude": lat,
            "longitude": lon,
            "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
            "timezone": "Africa/Lagos",
        }
        out: list[DailyWeather] = []
        if start <= archive_cutoff:
            a_end = min(end, archive_cutoff)
            out += self._parse(self._get(self.archive_url, {**common, "start_date": start.isoformat(), "end_date": a_end.isoformat()}))
        if end > archive_cutoff:
            r_start = max(start, archive_cutoff + timedelta(days=1))
            past_days = min(92, (today - r_start).days + 1)
            payload = self._get(self.forecast_url, {**common, "past_days": past_days, "forecast_days": 1})
            out += [x for x in self._parse(payload) if r_start <= x.date <= end]
        return out


def get_provider(name: str | None = None) -> WeatherProvider:
    name = name or os.getenv("CLIMASURE_WEATHER_PROVIDER", "synthetic")
    if name == "synthetic":
        return SyntheticProvider(scenario=os.getenv("CLIMASURE_SYNTHETIC_SCENARIO", "normal"))
    if name == "open-meteo":
        return OpenMeteoProvider()
    raise ValueError(f"Unknown weather provider: {name}")
