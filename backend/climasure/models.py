"""Weather data records."""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class DailyWeather(BaseModel):
    date: date
    rain_mm: Optional[float] = Field(default=None, ge=0)
    tmax_c: Optional[float] = None
    tmin_c: Optional[float] = None
