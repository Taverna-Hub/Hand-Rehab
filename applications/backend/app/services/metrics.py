from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ButtonBatch,
    ButtonBatchPerformanceMetadata,
    ButtonEvent,
    GameSession,
    PressureBatch,
    PressureBatchPerformanceMetadata,
    PressureReading,
    User,
)
from app.schemas.metrics import SessionSummary, UserSummary


async def _scalar(db: AsyncSession, statement, default=0):
    value = (await db.execute(statement)).scalar_one_or_none()
    return default if value is None else value


async def _values(db: AsyncSession, statement) -> list:
    result = await db.execute(statement)
    return [value for value in result.scalars().all() if value is not None]


def _to_float(value) -> float | None:
    return None if value is None else float(value)


def _average(values: list) -> float | None:
    if not values:
        return None
    return float(sum(Decimal(str(value)) for value in values) / len(values))


async def get_session_summary(db: AsyncSession, session_id: str) -> SessionSummary:
    game_session = await db.get(GameSession, session_id)
    if game_session is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    button_count = await _scalar(db, select(func.count(ButtonEvent.id)).where(ButtonEvent.session_id == session_id))
    pressure_count = await _scalar(db, select(func.count(PressureReading.id)).where(PressureReading.session_id == session_id))
    button_batch_count = await _scalar(db, select(func.count(ButtonBatch.id)).where(ButtonBatch.session_id == session_id))
    pressure_batch_count = await _scalar(db, select(func.count(PressureBatch.id)).where(PressureBatch.session_id == session_id))
    button_drops = await _scalar(
        db,
        select(func.coalesce(func.sum(ButtonBatchPerformanceMetadata.dropped_samples), 0))
        .join(ButtonBatch, ButtonBatchPerformanceMetadata.batch_id == ButtonBatch.id)
        .where(ButtonBatch.session_id == session_id),
    )
    pressure_drops = await _scalar(
        db,
        select(func.coalesce(func.sum(PressureBatchPerformanceMetadata.dropped_samples), 0))
        .join(PressureBatch, PressureBatchPerformanceMetadata.batch_id == PressureBatch.id)
        .where(PressureBatch.session_id == session_id),
    )
    latency_values = await _values(
        db,
        select(ButtonBatchPerformanceMetadata.insert_latency_us_avg)
        .join(ButtonBatch, ButtonBatchPerformanceMetadata.batch_id == ButtonBatch.id)
        .where(ButtonBatch.session_id == session_id),
    ) + await _values(
        db,
        select(PressureBatchPerformanceMetadata.insert_latency_us_avg)
        .join(PressureBatch, PressureBatchPerformanceMetadata.batch_id == PressureBatch.id)
        .where(PressureBatch.session_id == session_id),
    )
    latency_max_values = await _values(
        db,
        select(ButtonBatchPerformanceMetadata.insert_latency_us_max)
        .join(ButtonBatch, ButtonBatchPerformanceMetadata.batch_id == ButtonBatch.id)
        .where(ButtonBatch.session_id == session_id),
    ) + await _values(
        db,
        select(PressureBatchPerformanceMetadata.insert_latency_us_max)
        .join(PressureBatch, PressureBatchPerformanceMetadata.batch_id == PressureBatch.id)
        .where(PressureBatch.session_id == session_id),
    )

    pressure_raw_avg = pressure_raw_max = pressure_kpa_avg = pressure_kpa_max = None
    if game_session.mode == "pressure":
        pressure_raw_avg = await _scalar(
            db,
            select(func.avg(PressureReading.pressure_raw)).where(PressureReading.session_id == session_id),
            default=None,
        )
        pressure_raw_max = await _scalar(
            db,
            select(func.max(PressureReading.pressure_raw)).where(PressureReading.session_id == session_id),
            default=None,
        )
        pressure_kpa_avg = await _scalar(
            db,
            select(func.avg(PressureReading.pressure_kpa)).where(PressureReading.session_id == session_id),
            default=None,
        )
        pressure_kpa_max = await _scalar(
            db,
            select(func.max(PressureReading.pressure_kpa)).where(PressureReading.session_id == session_id),
            default=None,
        )

    return SessionSummary(
        session_id=game_session.id,
        user_id=game_session.user_id,
        device_id=game_session.device_id,
        hand=game_session.hand,
        mode=game_session.mode,
        duration_seconds=game_session.duration_seconds,
        status=game_session.status,
        button_event_count=button_count,
        pressure_reading_count=pressure_count,
        batch_count=button_batch_count + pressure_batch_count,
        dropped_samples=button_drops + pressure_drops,
        insert_latency_us_avg=_average(latency_values),
        insert_latency_us_max=max(latency_max_values) if latency_max_values else None,
        pressure_raw_avg=_to_float(pressure_raw_avg),
        pressure_raw_max=pressure_raw_max,
        pressure_kpa_avg=_to_float(pressure_kpa_avg),
        pressure_kpa_max=_to_float(pressure_kpa_max),
    )


async def _group_counts(db: AsyncSession, column, user_id: str) -> dict[str, int]:
    result = await db.execute(
        select(column, func.count(GameSession.id)).where(GameSession.user_id == user_id).group_by(column)
    )
    return {key: count for key, count in result.all()}


async def get_user_summary(db: AsyncSession, user_id: str) -> UserSummary:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")

    total_sessions = await _scalar(db, select(func.count(GameSession.id)).where(GameSession.user_id == user_id))
    average_duration = await _scalar(
        db,
        select(func.avg(GameSession.duration_seconds)).where(GameSession.user_id == user_id),
        default=None,
    )
    total_button_events = await _scalar(db, select(func.count(ButtonEvent.id)).where(ButtonEvent.user_id == user_id))
    total_pressure_readings = await _scalar(
        db,
        select(func.count(PressureReading.id)).where(PressureReading.user_id == user_id),
    )
    pressure_raw_avg = await _scalar(
        db,
        select(func.avg(PressureReading.pressure_raw)).where(PressureReading.user_id == user_id),
        default=None,
    )
    pressure_raw_max = await _scalar(
        db,
        select(func.max(PressureReading.pressure_raw)).where(PressureReading.user_id == user_id),
        default=None,
    )

    return UserSummary(
        user_id=user_id,
        total_sessions=total_sessions,
        sessions_by_mode=await _group_counts(db, GameSession.mode, user_id),
        sessions_by_hand=await _group_counts(db, GameSession.hand, user_id),
        average_duration_seconds=_to_float(average_duration),
        total_button_events=total_button_events,
        total_pressure_readings=total_pressure_readings,
        pressure_raw_avg=_to_float(pressure_raw_avg),
        pressure_raw_max=pressure_raw_max,
    )
