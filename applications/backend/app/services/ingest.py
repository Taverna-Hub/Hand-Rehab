from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ButtonBatch,
    ButtonBatchPerformanceMetadata,
    ButtonEvent,
    Device,
    GameSession,
    PressureBatch,
    PressureBatchPerformanceMetadata,
    PressureReading,
)
from app.schemas.ingest import ButtonBatchPayload, IngestResponse, PerformancePayload, PressureBatchPayload


async def _get_session_or_404(db: AsyncSession, session_id: str) -> GameSession:
    game_session = await db.get(GameSession, session_id)
    if game_session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return game_session


async def _ensure_device(db: AsyncSession, device_id: str) -> None:
    result = await db.execute(select(Device).where(Device.device_id == device_id))
    if result.scalar_one_or_none() is None:
        db.add(Device(device_id=device_id))
        await db.flush()


def _validate_common(game_session: GameSession, user_id: str | None, hand: str, mode: str) -> IngestResponse | None:
    if user_id is not None and user_id != game_session.user_id:
        raise HTTPException(status_code=422, detail="user_id_does_not_match_session")
    if hand != game_session.hand:
        raise HTTPException(status_code=422, detail="hand_does_not_match_session")
    if mode != game_session.mode:
        return IngestResponse(accepted=False, reason="session_mode_mismatch")
    return None


def _performance_data(payload: PerformancePayload | None) -> dict:
    data = payload.model_dump() if payload else {}
    return data


def _button_batch_model(payload: ButtonBatchPayload, game_session: GameSession) -> ButtonBatch:
    return ButtonBatch(
        batch_id=payload.batch_id,
        session_id=game_session.id,
        user_id=game_session.user_id,
        device_id=payload.device_id,
        hand=payload.hand,
        strategy=payload.strategy,
        sequence_start=payload.sequence_start,
        sequence_end=payload.sequence_end,
        created_at_ms=payload.created_at_ms,
        source_topic=payload.source_topic,
    )


def _pressure_batch_model(payload: PressureBatchPayload, game_session: GameSession) -> PressureBatch:
    return PressureBatch(
        batch_id=payload.batch_id,
        session_id=game_session.id,
        user_id=game_session.user_id,
        device_id=payload.device_id,
        hand=payload.hand,
        strategy=payload.strategy,
        sequence_start=payload.sequence_start,
        sequence_end=payload.sequence_end,
        created_at_ms=payload.created_at_ms,
        source_topic=payload.source_topic,
    )


async def _find_button_batch(db: AsyncSession, payload: ButtonBatchPayload) -> ButtonBatch | None:
    result = await db.execute(
        select(ButtonBatch).where(
            ButtonBatch.device_id == payload.device_id,
            ButtonBatch.session_id == payload.session_id,
            ButtonBatch.batch_id == payload.batch_id,
        )
    )
    return result.scalar_one_or_none()


async def _find_pressure_batch(db: AsyncSession, payload: PressureBatchPayload) -> PressureBatch | None:
    result = await db.execute(
        select(PressureBatch).where(
            PressureBatch.device_id == payload.device_id,
            PressureBatch.session_id == payload.session_id,
            PressureBatch.batch_id == payload.batch_id,
        )
    )
    return result.scalar_one_or_none()


async def ingest_button_batch(db: AsyncSession, payload: ButtonBatchPayload) -> IngestResponse:
    game_session = await _get_session_or_404(db, payload.session_id)
    mismatch = _validate_common(game_session, payload.user_id, payload.hand, payload.mode)
    if mismatch is not None:
        return mismatch

    existing_batch = await _find_button_batch(db, payload)
    if existing_batch is not None:
        return IngestResponse(accepted=True, telemetry_batch_id=existing_batch.id)

    await _ensure_device(db, payload.device_id)
    batch = _button_batch_model(payload, game_session)
    db.add(batch)
    await db.flush()
    db.add(ButtonBatchPerformanceMetadata(batch_id=batch.id, **_performance_data(payload.performance)))

    for event in payload.events:
        db.add(
            ButtonEvent(
                batch_id=batch.id,
                session_id=game_session.id,
                user_id=game_session.user_id,
                device_id=payload.device_id,
                hand=payload.hand,
                button_id=event.button_id,
                event_type=event.event_type,
                timestamp_ms=event.timestamp_ms,
                sequence=event.sequence,
            )
        )

    await db.commit()
    return IngestResponse(accepted=True, telemetry_batch_id=batch.id, persisted_events=len(payload.events))


async def ingest_pressure_batch(db: AsyncSession, payload: PressureBatchPayload) -> IngestResponse:
    game_session = await _get_session_or_404(db, payload.session_id)
    mismatch = _validate_common(game_session, payload.user_id, payload.hand, payload.mode)
    if mismatch is not None:
        return mismatch

    existing_batch = await _find_pressure_batch(db, payload)
    if existing_batch is not None:
        return IngestResponse(accepted=True, telemetry_batch_id=existing_batch.id)

    await _ensure_device(db, payload.device_id)
    batch = _pressure_batch_model(payload, game_session)
    db.add(batch)
    await db.flush()
    db.add(PressureBatchPerformanceMetadata(batch_id=batch.id, **_performance_data(payload.performance)))

    for sample in payload.samples:
        db.add(
            PressureReading(
                batch_id=batch.id,
                session_id=game_session.id,
                user_id=game_session.user_id,
                device_id=payload.device_id,
                hand=payload.hand,
                pressure_raw=sample.pressure_raw,
                pressure_kpa=sample.pressure_kpa,
                timestamp_ms=sample.timestamp_ms,
                sequence=sample.sequence,
            )
        )

    await db.commit()
    return IngestResponse(accepted=True, telemetry_batch_id=batch.id, persisted_readings=len(payload.samples))
