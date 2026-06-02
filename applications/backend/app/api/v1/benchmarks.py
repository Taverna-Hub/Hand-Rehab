from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.schemas.benchmarks import (
    BenchmarkResultIngestResponse,
    BenchmarkResultPayload,
    BenchmarkRunCancel,
    BenchmarkRunCreate,
    BenchmarkRunListResponse,
    BenchmarkRunRead,
    BenchmarkStatusPayload,
    BenchmarkStatusResponse,
)
from app.services.benchmarks import (
    cancel_active_benchmark_run,
    cancel_benchmark_run,
    create_benchmark_run,
    get_benchmark_run,
    ingest_benchmark_result,
    ingest_benchmark_status,
    list_benchmark_runs,
)
from app.services.mqtt import MqttCommandPublisher, get_mqtt_publisher

router = APIRouter(prefix="/benchmarks", tags=["benchmarks"])


@router.post(
    "/runs",
    response_model=BenchmarkRunRead,
    status_code=status.HTTP_201_CREATED,
    summary="Iniciar benchmark de buffers",
    responses={409: {"description": "Ja existe uma sessao de jogo ativa."}},
)
async def start_benchmark_run(
    payload: BenchmarkRunCreate = BenchmarkRunCreate(),
    session: AsyncSession = Depends(get_session),
    publisher: MqttCommandPublisher = Depends(get_mqtt_publisher),
    settings: Settings = Depends(get_settings),
) -> BenchmarkRunRead:
    return await create_benchmark_run(session, payload, publisher, settings.default_device_id)


@router.get("/runs", response_model=list[BenchmarkRunListResponse], summary="Listar benchmarks recentes")
async def get_benchmark_runs(
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[BenchmarkRunListResponse]:
    return await list_benchmark_runs(session, limit=limit)


@router.patch("/runs/active/cancel", response_model=BenchmarkRunRead, summary="Cancelar benchmark ativo")
async def cancel_active_benchmark(
    payload: BenchmarkRunCancel = Body(default_factory=BenchmarkRunCancel),
    session: AsyncSession = Depends(get_session),
) -> BenchmarkRunRead:
    return await cancel_active_benchmark_run(session, payload)


@router.get("/runs/{run_id}", response_model=BenchmarkRunRead, summary="Consultar benchmark")
async def get_one_benchmark_run(run_id: str, session: AsyncSession = Depends(get_session)) -> BenchmarkRunRead:
    return await get_benchmark_run(session, run_id)


@router.patch("/runs/{run_id}/cancel", response_model=BenchmarkRunRead, summary="Cancelar benchmark")
async def cancel_benchmark(
    run_id: str,
    payload: BenchmarkRunCancel = Body(default_factory=BenchmarkRunCancel),
    session: AsyncSession = Depends(get_session),
) -> BenchmarkRunRead:
    return await cancel_benchmark_run(session, run_id, payload)


@router.post("/results", response_model=BenchmarkResultIngestResponse, summary="Receber resultado de benchmark")
async def post_benchmark_result(
    payload: BenchmarkResultPayload,
    session: AsyncSession = Depends(get_session),
) -> BenchmarkResultIngestResponse:
    return await ingest_benchmark_result(session, payload)


@router.post("/status", response_model=BenchmarkStatusResponse, summary="Receber status de benchmark")
async def post_benchmark_status(
    payload: BenchmarkStatusPayload,
    session: AsyncSession = Depends(get_session),
) -> BenchmarkStatusResponse:
    return await ingest_benchmark_status(session, payload)
