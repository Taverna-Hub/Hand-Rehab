from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Hand, Mode, SessionStatus


class GameSessionCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "user_id": "00000000-0000-0000-0000-000000000000",
                "device_id": "esp32-001",
                "hand": "right",
                "mode": "buttons",
                "notes": "Sessao de validacao",
            }
        }
    )

    user_id: str
    device_id: str | None = Field(default=None, min_length=1, max_length=80)
    hand: Hand
    mode: Mode
    started_at: datetime | None = None
    notes: str | None = None


class GameplayMetricsPayload(BaseModel):
    total_stimuli: int = Field(ge=0, strict=True)
    hits: int = Field(ge=0, strict=True)
    errors: int = Field(ge=0, strict=True)
    missed_stimuli: int = Field(ge=0, strict=True)
    score: int = Field(ge=0, strict=True)
    max_combo: int = Field(ge=0, strict=True)
    avg_reaction_ms: float | None = Field(default=None, ge=0)
    best_reaction_ms: int | None = Field(default=None, ge=0, strict=True)
    worst_reaction_ms: int | None = Field(default=None, ge=0, strict=True)
    accuracy_rate: float | None = Field(default=None, ge=0, le=100)
    error_rate: float | None = Field(default=None, ge=0, le=100)
    missed_rate: float | None = Field(default=None, ge=0, le=100)
    precision_by_lane: dict[str, float] = Field(default_factory=dict)


class GameSessionFinish(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "notes": "Sessao encerrada sem intercorrencias",
                "gameplay_metrics": {
                    "total_stimuli": 24,
                    "hits": 19,
                    "errors": 2,
                    "missed_stimuli": 5,
                    "score": 2430,
                    "max_combo": 8,
                    "avg_reaction_ms": 142.5,
                    "best_reaction_ms": 68,
                    "worst_reaction_ms": 247,
                    "accuracy_rate": 79.17,
                    "error_rate": 9.52,
                    "missed_rate": 20.83,
                    "precision_by_lane": {"1": 83.33, "2": 75.0, "3": 80.0, "4": 66.67},
                },
            }
        }
    )

    notes: str | None = None
    gameplay_metrics: GameplayMetricsPayload | None = None


class GameSessionRead(BaseModel):
    id: str
    user_id: str
    device_id: str
    hand: Hand
    mode: Mode
    duration_seconds: int | None
    status: SessionStatus
    started_at: datetime
    scheduled_finish_at: datetime | None
    finished_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
