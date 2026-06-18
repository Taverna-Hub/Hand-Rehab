from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utc_now
from app.db.session import get_session
from app.core.config import Settings, get_settings
from app.models import Device, GameSession, GameplayMetrics, User
from app.schemas.sessions import GameSessionCreate, GameSessionFinish, GameSessionRead, GameplayMetricsPayload
from app.services.mqtt import MqttCommandPublisher, get_mqtt_publisher
from app.services.notifications import (
    SessionFinishNotifier,
    get_session_finish_notifier,
    notify_session_finished_best_effort,
)

router = APIRouter(prefix="/game-sessions", tags=["game-sessions"])

ACTIVE_SESSION_CONFLICT_RESPONSE = {
    409: {
        "description": "Ja existe uma sessao ativa no sistema.",
        "content": {
            "application/json": {
                "examples": {
                    "active_session_exists": {"value": {"detail": "active_session_exists"}},
                }
            }
        },
    }
}

SESSION_NOT_RUNNING_CONFLICT_RESPONSE = {
    409: {
        "description": "A sessao nao esta em execucao.",
        "content": {
            "application/json": {
                "examples": {
                    "session_not_running": {"value": {"detail": "session_not_running"}},
                }
            }
        },
    }
}


async def get_or_create_device(session: AsyncSession, device_id: str) -> Device:
    result = await session.execute(select(Device).where(Device.device_id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        device = Device(device_id=device_id)
        session.add(device)
        await session.flush()
    return device


def _elapsed_seconds(started_at: datetime, finished_at: datetime) -> int:
    if started_at.tzinfo is None and finished_at.tzinfo is not None:
        finished_at = finished_at.replace(tzinfo=None)
    return max(0, int((finished_at - started_at).total_seconds()))


def _decimal_or_none(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(round(value, 4)))


def _gameplay_metrics_model(game_session: GameSession, payload: GameplayMetricsPayload) -> GameplayMetrics:
    return GameplayMetrics(
        session_id=game_session.id,
        user_id=game_session.user_id,
        hand=game_session.hand,
        mode=game_session.mode,
        total_stimuli=payload.total_stimuli,
        hits=payload.hits,
        errors=payload.errors,
        missed_stimuli=payload.missed_stimuli,
        score=payload.score,
        max_combo=payload.max_combo,
        avg_reaction_ms=_decimal_or_none(payload.avg_reaction_ms),
        best_reaction_ms=payload.best_reaction_ms,
        worst_reaction_ms=payload.worst_reaction_ms,
        accuracy_rate=_decimal_or_none(payload.accuracy_rate),
        error_rate=_decimal_or_none(payload.error_rate),
        missed_rate=_decimal_or_none(payload.missed_rate),
        precision_by_lane=payload.precision_by_lane,
    )


async def _active_session_exists(session: AsyncSession) -> bool:
    result = await session.execute(select(GameSession.id).where(GameSession.status == "running").limit(1))
    return result.scalar_one_or_none() is not None


async def _create_running_session(
    payload: GameSessionCreate,
    session: AsyncSession,
    publisher: MqttCommandPublisher,
    settings: Settings,
) -> GameSession:
    user = await session.get(User, payload.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    if await _active_session_exists(session):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_session_exists")

    device_id = payload.device_id or settings.default_device_id
    await get_or_create_device(session, device_id)
    started_at = payload.started_at or utc_now()
    scheduled_finish_at = started_at + timedelta(seconds=payload.duration_seconds) if payload.duration_seconds else None
    game_session = GameSession(
        user_id=payload.user_id,
        device_id=device_id,
        hand=payload.hand,
        mode=payload.mode,
        duration_seconds=payload.duration_seconds,
        status="running",
        started_at=started_at,
        scheduled_finish_at=scheduled_finish_at,
        notes=payload.notes,
    )
    session.add(game_session)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_session_exists") from exc
    await session.refresh(game_session)
    await publisher.publish_start_session(
        device_id,
        {
            "session_id": game_session.id,
            "user_id": game_session.user_id,
            "hand": game_session.hand,
            "mode": game_session.mode,
            "duration_seconds": game_session.duration_seconds,
        },
    )
    return game_session


@router.post(
    "/start",
    response_model=GameSessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Iniciar sessao de jogo",
    description=(
        "Cria uma sessao em execucao e publica o comando MQTT start_session para a ESP32. "
        "Como o MVP usa um dispositivo e uma pessoa por vez, a API rejeita a criacao se ja existir "
        "qualquer sessao com status running."
    ),
    responses={404: {"description": "Usuario nao encontrado."}, **ACTIVE_SESSION_CONFLICT_RESPONSE},
)
async def start_game_session(
    payload: GameSessionCreate,
    session: AsyncSession = Depends(get_session),
    publisher: MqttCommandPublisher = Depends(get_mqtt_publisher),
    settings: Settings = Depends(get_settings),
) -> GameSession:
    return await _create_running_session(payload, session, publisher, settings)


@router.post(
    "",
    response_model=GameSessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Criar sessao de jogo",
    description="Alias de criacao para iniciar uma sessao running, com as mesmas regras de exclusividade global.",
    responses={404: {"description": "Usuario nao encontrado."}, **ACTIVE_SESSION_CONFLICT_RESPONSE},
)
async def create_game_session(
    payload: GameSessionCreate,
    session: AsyncSession = Depends(get_session),
    publisher: MqttCommandPublisher = Depends(get_mqtt_publisher),
    settings: Settings = Depends(get_settings),
) -> GameSession:
    return await _create_running_session(payload, session, publisher, settings)


@router.get(
    "",
    response_model=list[GameSessionRead],
    summary="Listar sessoes de jogo",
    description="Retorna todas as sessoes de jogo, ordenadas da mais recente para a mais antiga.",
)
async def list_game_sessions(session: AsyncSession = Depends(get_session)) -> list[GameSession]:
    result = await session.execute(select(GameSession).order_by(GameSession.created_at.desc()))
    return list(result.scalars().all())


@router.get(
    "/active",
    response_model=list[GameSessionRead],
    summary="Listar sessoes ativas",
    description="Retorna sessoes com status running. Pela regra atual do sistema, a lista tera no maximo uma sessao.",
)
async def list_active_game_sessions(session: AsyncSession = Depends(get_session)) -> list[GameSession]:
    result = await session.execute(
        select(GameSession).where(GameSession.status == "running").order_by(GameSession.created_at.desc())
    )
    return list(result.scalars().all())


@router.get(
    "/{session_id}",
    response_model=GameSessionRead,
    summary="Consultar sessao de jogo",
    description="Retorna os dados cadastrais e o ciclo de vida de uma sessao especifica.",
    responses={404: {"description": "Sessao nao encontrada."}},
)
async def get_game_session(session_id: str, session: AsyncSession = Depends(get_session)) -> GameSession:
    game_session = await session.get(GameSession, session_id)
    if game_session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return game_session


@router.patch(
    "/{session_id}/finish",
    response_model=GameSessionRead,
    summary="Finalizar sessao de jogo",
    description=(
        "Finaliza uma sessao running, calcula duration_seconds e publica o comando MQTT end_session. "
        "Sessoes que ja foram encerradas retornam conflito e nao geram novo comando MQTT."
    ),
    responses={404: {"description": "Sessao nao encontrada."}, **SESSION_NOT_RUNNING_CONFLICT_RESPONSE},
)
async def finish_game_session(
    session_id: str,
    payload: GameSessionFinish = Body(default_factory=GameSessionFinish),
    session: AsyncSession = Depends(get_session),
    publisher: MqttCommandPublisher = Depends(get_mqtt_publisher),
    notifier: SessionFinishNotifier = Depends(get_session_finish_notifier),
) -> GameSession:
    game_session = await session.get(GameSession, session_id)
    if game_session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    if game_session.status != "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="session_not_running")

    finished_at = utc_now()
    game_session.status = "finished"
    game_session.finished_at = finished_at
    game_session.duration_seconds = _elapsed_seconds(game_session.started_at, finished_at)
    if payload.notes is not None:
        game_session.notes = payload.notes
    if payload.gameplay_metrics is not None:
        session.add(_gameplay_metrics_model(game_session, payload.gameplay_metrics))

    await session.commit()
    await session.refresh(game_session)
    user = await session.get(User, game_session.user_id)
    metrics_result = await session.execute(select(GameplayMetrics).where(GameplayMetrics.session_id == game_session.id))
    metrics = metrics_result.scalar_one_or_none()
    await publisher.publish_end_session(
        game_session.device_id,
        {
            "device_id": game_session.device_id,
            "session_id": game_session.id,
            "user_id": game_session.user_id,
            "hand": game_session.hand,
            "mode": game_session.mode,
        },
    )
    if user is not None:
        await notify_session_finished_best_effort(notifier, game_session, user, metrics)
    return game_session
