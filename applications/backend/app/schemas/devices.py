from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class PressureCalibrationResponse(BaseModel):
    device_id: str
    status: Literal["queued"]
    timestamp_ms: int
