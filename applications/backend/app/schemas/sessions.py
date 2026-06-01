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


class GameSessionFinish(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"notes": "Sessao encerrada sem intercorrencias"}})

    notes: str | None = None


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
