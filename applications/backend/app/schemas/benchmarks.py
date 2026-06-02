from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

BenchmarkStatus = Literal["running", "completed", "failed", "cancelled"]
BenchmarkStrategy = Literal["ring_buffer", "inefficient_shift_buffer"]
BenchmarkOperation = Literal["sliding_insert"]

DEFAULT_SAMPLE_COUNTS = [100, 5000, 20000]
DEFAULT_STRATEGIES: list[BenchmarkStrategy] = ["ring_buffer", "inefficient_shift_buffer"]
DEFAULT_ITERATIONS = 100
DEFAULT_OPERATION: BenchmarkOperation = "sliding_insert"


def _reject_numeric_string(value: Any) -> Any:
    if isinstance(value, str):
        raise ValueError("numeric fields must be sent as JSON numbers")
    return value


class BenchmarkRunCreate(BaseModel):
    device_id: str | None = Field(default=None, min_length=1, max_length=80)
    sample_counts: list[int] = Field(default_factory=lambda: list(DEFAULT_SAMPLE_COUNTS), min_length=1, max_length=6)
    iterations: int = Field(default=DEFAULT_ITERATIONS, ge=1, le=1000, strict=True)

    @field_validator("sample_counts")
    @classmethod
    def validate_sample_counts(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value):
            raise ValueError("sample counts must be positive")
        return sorted(set(value))


class BenchmarkResultPayload(BaseModel):
    run_id: str
    device_id: str = Field(min_length=1)
    strategy: BenchmarkStrategy
    sample_count: int = Field(gt=0, strict=True)
    iterations: int = Field(gt=0, strict=True)
    operation: BenchmarkOperation = DEFAULT_OPERATION
    duration_total_us: int = Field(ge=0, strict=True)
    latency_us_avg: Decimal
    latency_us_max: int = Field(ge=0, strict=True)
    free_heap_before_bytes: int | None = Field(default=None, ge=0, strict=True)
    free_heap_after_bytes: int | None = Field(default=None, ge=0, strict=True)
    min_free_heap_bytes: int | None = Field(default=None, ge=0, strict=True)
    dropped_samples: int = Field(default=0, ge=0, strict=True)
    timestamp_ms: int | None = Field(default=None, ge=0, strict=True)
    source_topic: str | None = None

    _reject_decimal_strings = field_validator("latency_us_avg", mode="before")(_reject_numeric_string)


class BenchmarkStatusPayload(BaseModel):
    run_id: str
    device_id: str = Field(min_length=1)
    status: str = Field(min_length=1, max_length=40)
    timestamp_ms: int | None = Field(default=None, ge=0, strict=True)
    error: str | None = None
    source_topic: str | None = None


class BenchmarkResultRead(BaseModel):
    id: str
    run_id: str
    device_id: str
    strategy: BenchmarkStrategy
    sample_count: int
    iterations: int
    operation: BenchmarkOperation
    duration_total_us: int
    latency_us_avg: float
    latency_us_max: int
    free_heap_before_bytes: int | None
    free_heap_after_bytes: int | None
    min_free_heap_bytes: int | None
    dropped_samples: int
    timestamp_ms: int | None
    source_topic: str | None
    created_at: datetime


class BenchmarkRunRead(BaseModel):
    id: str
    device_id: str
    status: BenchmarkStatus
    sample_counts: list[int]
    strategies: list[BenchmarkStrategy]
    iterations: int
    operation: BenchmarkOperation
    expected_results: int
    started_at: datetime
    finished_at: datetime | None
    last_status: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime
    results: list[BenchmarkResultRead] = Field(default_factory=list)


class BenchmarkResultIngestResponse(BaseModel):
    accepted: bool
    benchmark_result_id: str | None = None
    run_status: BenchmarkStatus
    persisted_results: int


class BenchmarkStatusResponse(BaseModel):
    accepted: bool
    run_status: BenchmarkStatus


class BenchmarkRunCancel(BaseModel):
    reason: str | None = Field(default="cancelled_manually", max_length=255)


class BenchmarkRunListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_id: str
    status: BenchmarkStatus
    sample_counts: list[int]
    strategies: list[BenchmarkStrategy]
    iterations: int
    operation: BenchmarkOperation
    expected_results: int
    started_at: datetime
    finished_at: datetime | None
    last_status: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime
    result_count: int
