"""Parametric contract terms.

A contract says: "if index X, measured at this location over this window,
crosses level T, pay a share of the sum insured, rising linearly to 100% at
level E." Nobody visits the farm. The weather data alone decides the payout.
"""

from __future__ import annotations

import uuid
from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class Peril(str, Enum):
    DROUGHT = "drought"  # cumulative rainfall in window (mm); LOW is bad
    EXCESS_RAIN = "excess_rain"  # max rolling N-day rainfall (mm); HIGH is bad (flood)
    HEAT = "heat"  # number of days with tmax >= threshold; HIGH is bad
    DRY_SPELL = "dry_spell"  # longest run of consecutive dry days; HIGH is bad


LOWER_IS_WORSE = {Peril.DROUGHT}


class TriggerSpec(BaseModel):
    peril: Peril
    window_start: date
    window_end: date
    trigger: float = Field(description="Index level where payout starts")
    exit: float = Field(description="Index level where payout reaches 100% of this trigger's share")
    share: float = Field(default=1.0, gt=0, le=1, description="Fraction of sum insured this trigger can pay")
    min_payout_pct: float = Field(default=0.0, ge=0, le=100, description="Payout jumps to this % once triggered")
    rolling_days: int = Field(default=1, ge=1, le=30, description="excess_rain: rolling window length")
    heat_threshold_c: float = Field(default=35.0, description="heat: a day counts if tmax >= this")
    dry_day_mm: float = Field(default=1.0, ge=0, description="dry_spell: a day is dry if rain < this")
    label: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "TriggerSpec":
        if self.window_end < self.window_start:
            raise ValueError("window_end must be on or after window_start")
        if (self.window_end - self.window_start).days > 366:
            raise ValueError("risk window cannot exceed one year")
        if self.peril in LOWER_IS_WORSE:
            if not self.exit < self.trigger:
                raise ValueError(f"{self.peril.value}: exit must be below trigger (lower index is worse)")
        elif not self.exit > self.trigger:
            raise ValueError(f"{self.peril.value}: exit must be above trigger (higher index is worse)")
        return self


class ContractIn(BaseModel):
    policy_ref: str = Field(min_length=1, max_length=120, description="Insurer's own policy number")
    insured_ref: str = Field(
        min_length=1,
        max_length=120,
        description="Pseudonymous farmer/group id. Do not send names or phone numbers.",
    )
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    sum_insured: float = Field(gt=0)
    currency: str = Field(default="NGN", min_length=3, max_length=3)
    crop: Optional[str] = None
    triggers: list[TriggerSpec] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _shares(self) -> "ContractIn":
        if sum(t.share for t in self.triggers) > 1.0 + 1e-9:
            raise ValueError("trigger shares must not add up to more than 1.0")
        return self


class Contract(ContractIn):
    id: str = Field(default_factory=lambda: "ctr_" + uuid.uuid4().hex[:16])
    client_id: str
    cell_id: str
    status: str = "active"  # active | expired | cancelled
