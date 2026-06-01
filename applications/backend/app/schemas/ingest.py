from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import ButtonEventType, Hand


def _reject_numeric_string(value: Any) -> Any:
    if isinstance(value, str):
        raise ValueError("numeric fields must be sent as JSON numbers")
    return value


class PerformancePayload(BaseModel):
    insert_latency_us_avg: Decimal | None = None
    insert_latency_us_max: int | None = Field(default=None, strict=True)
    mqtt_publish_latency_us: int | None = Field(default=None, strict=True)
    free_heap_bytes: int | None = Field(default=None, strict=True)
    min_free_heap_bytes: int | None = Field(default=None, strict=True)
    buffer_capacity: int | None = Field(default=None, strict=True)
    buffer_used: int | None = Field(default=None, strict=True)
    dropped_samples: int | None = Field(default=None, strict=True)

    _reject_decimal_strings = field_validator("insert_latency_us_avg", mode="before")(_reject_numeric_string)


class ButtonEventPayload(BaseModel):
    button_id: int = Field(ge=1, le=4, strict=True)
    event_type: ButtonEventType
    timestamp_ms: int = Field(ge=0, strict=True)
    sequence: int | None = Field(default=None, strict=True)


class PressureSamplePayload(BaseModel):
    pressure_raw: int = Field(strict=True)
    pressure_kpa: Decimal | None = None
    timestamp_ms: int = Field(ge=0, strict=True)
    sequence: int | None = Field(default=None, strict=True)

    _reject_decimal_strings = field_validator("pressure_kpa", mode="before")(_reject_numeric_string)


class ButtonBatchPayload(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "device_id": "esp32-001",
                "session_id": "00000000-0000-0000-0000-000000000000",
                "user_id": "00000000-0000-0000-0000-000000000000",
                "hand": "right",
                "mode": "buttons",
                "batch_id": "esp32-001-buttons-123900",
                "strategy": "ring_buffer",
                "sequence_start": 1,
                "sequence_end": 2,
                "created_at_ms": 123900,
                "performance": {"insert_latency_us_avg": 8, "insert_latency_us_max": 15},
                "events": [
                    {"button_id": 1, "event_type": "pressed", "timestamp_ms": 123456, "sequence": 1}
                ],
            }
        }
    )

    device_id: str = Field(min_length=1)
    session_id: str
    user_id: str | None = None
    hand: Hand
    mode: Literal["buttons"]
    batch_id: str = Field(min_length=1)
    strategy: str = Field(min_length=1)
    sequence_start: int | None = Field(default=None, strict=True)
    sequence_end: int | None = Field(default=None, strict=True)
    created_at_ms: int | None = Field(default=None, strict=True)
    source_topic: str | None = None
    performance: PerformancePayload | None = None
    events: list[ButtonEventPayload] = Field(default_factory=list)


class PressureBatchPayload(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "device_id": "esp32-001",
                "session_id": "00000000-0000-0000-0000-000000000000",
                "user_id": "00000000-0000-0000-0000-000000000000",
                "hand": "left",
                "mode": "pressure",
                "batch_id": "esp32-001-pressure-123900",
                "strategy": "ring_buffer",
                "sequence_start": 1,
                "sequence_end": 2,
                "created_at_ms": 123900,
                "performance": {"insert_latency_us_avg": 7, "insert_latency_us_max": 13},
                "samples": [{"pressure_raw": 84532, "pressure_kpa": 1.2, "timestamp_ms": 123456, "sequence": 1}],
            }
        }
    )

    device_id: str = Field(min_length=1)
    session_id: str
    user_id: str | None = None
    hand: Hand
    mode: Literal["pressure"]
    batch_id: str = Field(min_length=1)
    strategy: str = Field(min_length=1)
    sequence_start: int | None = Field(default=None, strict=True)
    sequence_end: int | None = Field(default=None, strict=True)
    created_at_ms: int | None = Field(default=None, strict=True)
    source_topic: str | None = None
    performance: PerformancePayload | None = None
    samples: list[PressureSamplePayload] = Field(default_factory=list)


class IngestResponse(BaseModel):
    accepted: bool
    reason: str | None = None
    telemetry_batch_id: str | None = None
    persisted_events: int = 0
    persisted_readings: int = 0
