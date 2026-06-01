from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.ingest import ButtonBatchPayload, IngestResponse, PressureBatchPayload
from app.services.ingest import ingest_button_batch, ingest_pressure_batch

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/batches/buttons", response_model=IngestResponse)
async def post_button_batch(
    payload: ButtonBatchPayload,
    session: AsyncSession = Depends(get_session),
) -> IngestResponse:
    return await ingest_button_batch(session, payload)


@router.post("/batches/pressure", response_model=IngestResponse)
async def post_pressure_batch(
    payload: PressureBatchPayload,
    session: AsyncSession = Depends(get_session),
) -> IngestResponse:
    return await ingest_pressure_batch(session, payload)
