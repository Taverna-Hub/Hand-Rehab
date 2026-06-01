from __future__ import annotations

from pydantic import BaseModel


class SessionSummary(BaseModel):
    session_id: str
    user_id: str
    device_id: str
    hand: str
    mode: str
    duration_seconds: int | None
    status: str
    button_event_count: int
    pressure_reading_count: int
    batch_count: int
    dropped_samples: int
    insert_latency_us_avg: float | None
    insert_latency_us_max: int | None
    pressure_raw_avg: float | None = None
    pressure_raw_max: int | None = None
    pressure_kpa_avg: float | None = None
    pressure_kpa_max: float | None = None


class UserSummary(BaseModel):
    user_id: str
    total_sessions: int
    sessions_by_mode: dict[str, int]
    sessions_by_hand: dict[str, int]
    average_duration_seconds: float | None
    total_button_events: int
    total_pressure_readings: int
    pressure_raw_avg: float | None = None
    pressure_raw_max: int | None = None
