"""Grid cells.

All weather data and indices are computed per grid cell, so two farms in the
same cell always get the same index value. That keeps payouts consistent and
auditable, and lets one data pull serve every policy in the cell.
"""

from __future__ import annotations

import math


def cell_id(lat: float, lon: float, resolution_deg: float = 0.05) -> str:
    i = math.floor(lat / resolution_deg)
    j = math.floor(lon / resolution_deg)
    return f"r{resolution_deg:g}_{i}_{j}"


def cell_center(lat: float, lon: float, resolution_deg: float = 0.05) -> tuple[float, float]:
    i = math.floor(lat / resolution_deg)
    j = math.floor(lon / resolution_deg)
    return (round((i + 0.5) * resolution_deg, 6), round((j + 0.5) * resolution_deg, 6))
