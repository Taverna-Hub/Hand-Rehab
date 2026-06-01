from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Sex


class UserCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"example": {"name": "Paciente Teste", "age": 35, "sex": "not_informed"}}
    )

    name: str = Field(min_length=1, max_length=120)
    age: int = Field(ge=0, strict=True)
    sex: Sex


class UserRead(BaseModel):
    id: str
    name: str
    age: int
    sex: Sex
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
