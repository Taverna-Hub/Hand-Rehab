from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utc_now
from app.db.session import get_session
from app.models import GameSession
from app.schemas.devices import PressureCalibrationResponse
from app.services.mqtt import MqttCommandPublisher, get_mqtt_publisher

router = APIRouter(prefix="/devices", tags=["devices"])


async def _active_session_exists(session: AsyncSession) -> bool:
    result = await session.execute(select(GameSession.id).where(GameSession.status == "running").limit(1))
    return result.scalar_one_or_none() is not None


@router.post(
    "/{device_id}/calibrate-pressure",
    response_model=PressureCalibrationResponse,
    summary="Calibrar sensor de pressao",
    responses={
        409: {
            "description": "Ja existe uma sessao ativa no sistema.",
            "content": {"application/json": {"examples": {"active_session_exists": {"value": {"detail": "active_session_exists"}}}}},
        }
    },
)
async def calibrate_pressure_sensor(
    device_id: str,
    session: AsyncSession = Depends(get_session),
    publisher: MqttCommandPublisher = Depends(get_mqtt_publisher),
) -> PressureCalibrationResponse:
    if await _active_session_exists(session):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_session_exists")

    requested_at_ms = int(utc_now().timestamp() * 1000)
    await publisher.publish_calibrate_pressure(
        device_id,
        {
            "device_id": device_id,
            "requested_at_ms": requested_at_ms,
        },
    )
    return PressureCalibrationResponse(device_id=device_id, status="queued", timestamp_ms=requested_at_ms)
