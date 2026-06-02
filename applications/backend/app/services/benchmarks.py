from __future__ import annotations

import json
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utc_now
from app.models import BenchmarkResult, BenchmarkRun, Device, GameSession
from app.schemas.benchmarks import (
    DEFAULT_OPERATION,
    DEFAULT_STRATEGIES,
    BenchmarkResultIngestResponse,
    BenchmarkResultPayload,
    BenchmarkRunCancel,
    BenchmarkResultRead,
    BenchmarkRunCreate,
    BenchmarkRunListResponse,
    BenchmarkRunRead,
    BenchmarkStatusPayload,
    BenchmarkStatusResponse,
)
from app.services.mqtt import MqttCommandPublisher


async def _ensure_device(db: AsyncSession, device_id: str) -> None:
    result = await db.execute(select(Device).where(Device.device_id == device_id))
    if result.scalar_one_or_none() is None:
        db.add(Device(device_id=device_id))
        await db.flush()


async def _active_session_exists(db: AsyncSession) -> bool:
    result = await db.execute(select(GameSession.id).where(GameSession.status == "running").limit(1))
    return result.scalar_one_or_none() is not None


async def _active_benchmark_exists(db: AsyncSession) -> bool:
    result = await db.execute(select(BenchmarkRun.id).where(BenchmarkRun.status == "running").limit(1))
    return result.scalar_one_or_none() is not None


async def _get_benchmark_run_for_update(db: AsyncSession, run_id: str) -> BenchmarkRun | None:
    result = await db.execute(select(BenchmarkRun).where(BenchmarkRun.id == run_id).with_for_update())
    return result.scalar_one_or_none()


def _loads_ints(value: str) -> list[int]:
    return [int(item) for item in json.loads(value)]


def _loads_strings(value: str) -> list[str]:
    return [str(item) for item in json.loads(value)]


def _result_read(result: BenchmarkResult) -> BenchmarkResultRead:
    return BenchmarkResultRead(
        id=result.id,
        run_id=result.run_id,
        device_id=result.device_id,
        strategy=result.strategy,
        sample_count=result.sample_count,
        iterations=result.iterations,
        operation=result.operation,
        duration_total_us=result.duration_total_us,
        latency_us_avg=float(result.latency_us_avg),
        latency_us_max=result.latency_us_max,
        free_heap_before_bytes=result.free_heap_before_bytes,
        free_heap_after_bytes=result.free_heap_after_bytes,
        min_free_heap_bytes=result.min_free_heap_bytes,
        dropped_samples=result.dropped_samples,
        timestamp_ms=result.timestamp_ms,
        source_topic=result.source_topic,
        created_at=result.created_at,
    )


async def _result_count(db: AsyncSession, run_id: str) -> int:
    value = (await db.execute(select(func.count(BenchmarkResult.id)).where(BenchmarkResult.run_id == run_id))).scalar_one()
    return int(value)


async def _results_for_run(db: AsyncSession, run_id: str) -> list[BenchmarkResult]:
    result = await db.execute(
        select(BenchmarkResult)
        .where(BenchmarkResult.run_id == run_id)
        .order_by(BenchmarkResult.sample_count.asc(), BenchmarkResult.strategy.asc())
    )
    return list(result.scalars().all())


async def _complete_run_if_all_results_arrived(db: AsyncSession, run: BenchmarkRun) -> int:
    result_count = await _result_count(db, run.id)
    if run.status == "running" and result_count >= run.expected_results:
        run.status = "completed"
        run.last_status = "completed"
        if run.finished_at is None:
            run.finished_at = utc_now()
        await db.commit()
        await db.refresh(run)
    return result_count


async def _run_read(db: AsyncSession, run: BenchmarkRun, include_results: bool = True) -> BenchmarkRunRead:
    await _complete_run_if_all_results_arrived(db, run)
    results = await _results_for_run(db, run.id) if include_results else []
    return BenchmarkRunRead(
        id=run.id,
        device_id=run.device_id,
        status=run.status,
        sample_counts=_loads_ints(run.sample_counts),
        strategies=_loads_strings(run.strategies),
        iterations=run.iterations,
        operation=run.operation,
        expected_results=run.expected_results,
        started_at=run.started_at,
        finished_at=run.finished_at,
        last_status=run.last_status,
        error=run.error,
        created_at=run.created_at,
        updated_at=run.updated_at,
        results=[_result_read(item) for item in results],
    )


async def create_benchmark_run(
    db: AsyncSession,
    payload: BenchmarkRunCreate,
    publisher: MqttCommandPublisher,
    default_device_id: str,
) -> BenchmarkRunRead:
    if await _active_session_exists(db):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_session_exists")
    if await _active_benchmark_exists(db):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_benchmark_exists")

    device_id = payload.device_id or default_device_id
    await _ensure_device(db, device_id)
    strategies = list(DEFAULT_STRATEGIES)
    expected_results = len(payload.sample_counts) * len(strategies)
    run = BenchmarkRun(
        device_id=device_id,
        status="running",
        sample_counts=json.dumps(payload.sample_counts, separators=(",", ":")),
        strategies=json.dumps(strategies, separators=(",", ":")),
        iterations=payload.iterations,
        operation=DEFAULT_OPERATION,
        expected_results=expected_results,
        started_at=utc_now(),
        last_status="created",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    await publisher.publish_start_benchmark(
        device_id,
        {
            "run_id": run.id,
            "sample_counts": payload.sample_counts,
            "iterations": payload.iterations,
            "strategies": strategies,
            "operation": DEFAULT_OPERATION,
        },
    )

    run.last_status = "command_published"
    await db.commit()
    await db.refresh(run)
    return await _run_read(db, run, include_results=True)


async def list_benchmark_runs(db: AsyncSession, limit: int = 20) -> list[BenchmarkRunListResponse]:
    result = await db.execute(select(BenchmarkRun).order_by(BenchmarkRun.created_at.desc()).limit(limit))
    runs = list(result.scalars().all())
    responses: list[BenchmarkRunListResponse] = []
    for run in runs:
        result_count = await _complete_run_if_all_results_arrived(db, run)
        responses.append(
            BenchmarkRunListResponse(
                id=run.id,
                device_id=run.device_id,
                status=run.status,
                sample_counts=_loads_ints(run.sample_counts),
                strategies=_loads_strings(run.strategies),
                iterations=run.iterations,
                operation=run.operation,
                expected_results=run.expected_results,
                started_at=run.started_at,
                finished_at=run.finished_at,
                last_status=run.last_status,
                error=run.error,
                created_at=run.created_at,
                updated_at=run.updated_at,
                result_count=result_count,
            )
        )
    return responses


async def get_benchmark_run(db: AsyncSession, run_id: str) -> BenchmarkRunRead:
    run = await db.get(BenchmarkRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="benchmark_run_not_found")
    return await _run_read(db, run, include_results=True)


async def cancel_benchmark_run(db: AsyncSession, run_id: str, payload: BenchmarkRunCancel) -> BenchmarkRunRead:
    run = await _get_benchmark_run_for_update(db, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="benchmark_run_not_found")
    await _complete_run_if_all_results_arrived(db, run)
    if run.status != "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="benchmark_not_running")

    run.status = "cancelled"
    run.last_status = "cancelled"
    run.error = payload.reason or "cancelled_manually"
    run.finished_at = utc_now()
    await db.commit()
    await db.refresh(run)
    return await _run_read(db, run, include_results=True)


async def cancel_active_benchmark_run(db: AsyncSession, payload: BenchmarkRunCancel) -> BenchmarkRunRead:
    result = await db.execute(
        select(BenchmarkRun).where(BenchmarkRun.status == "running").order_by(BenchmarkRun.created_at.desc()).limit(1)
    )
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="active_benchmark_not_found")
    return await cancel_benchmark_run(db, run.id, payload)


async def ingest_benchmark_result(db: AsyncSession, payload: BenchmarkResultPayload) -> BenchmarkResultIngestResponse:
    run = await _get_benchmark_run_for_update(db, payload.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="benchmark_run_not_found")
    if run.status in {"cancelled", "failed"}:
        return BenchmarkResultIngestResponse(
            accepted=False,
            benchmark_result_id=None,
            run_status=run.status,
            persisted_results=await _result_count(db, run.id),
        )
    if payload.device_id != run.device_id:
        raise HTTPException(status_code=422, detail="device_id_does_not_match_run")
    if payload.iterations != run.iterations:
        raise HTTPException(status_code=422, detail="iterations_do_not_match_run")
    if payload.operation != run.operation:
        raise HTTPException(status_code=422, detail="operation_does_not_match_run")

    existing = await db.execute(
        select(BenchmarkResult).where(
            BenchmarkResult.run_id == payload.run_id,
            BenchmarkResult.strategy == payload.strategy,
            BenchmarkResult.sample_count == payload.sample_count,
            BenchmarkResult.operation == payload.operation,
        )
    )
    existing_result = existing.scalar_one_or_none()
    if existing_result is not None:
        return BenchmarkResultIngestResponse(
            accepted=True,
            benchmark_result_id=existing_result.id,
            run_status=run.status,
            persisted_results=await _result_count(db, run.id),
        )

    result = BenchmarkResult(
        run_id=payload.run_id,
        device_id=payload.device_id,
        strategy=payload.strategy,
        sample_count=payload.sample_count,
        iterations=payload.iterations,
        operation=payload.operation,
        duration_total_us=payload.duration_total_us,
        latency_us_avg=payload.latency_us_avg,
        latency_us_max=payload.latency_us_max,
        free_heap_before_bytes=payload.free_heap_before_bytes,
        free_heap_after_bytes=payload.free_heap_after_bytes,
        min_free_heap_bytes=payload.min_free_heap_bytes,
        dropped_samples=payload.dropped_samples,
        timestamp_ms=payload.timestamp_ms,
        source_topic=payload.source_topic,
    )
    db.add(result)
    await db.flush()

    result_count = await _result_count(db, run.id)
    run.last_status = "result_received"
    if result_count >= run.expected_results and run.status not in {"failed", "cancelled"}:
        run.status = "completed"
        run.last_status = "completed"
        run.finished_at = utc_now()

    await db.commit()
    return BenchmarkResultIngestResponse(
        accepted=True,
        benchmark_result_id=result.id,
        run_status=run.status,
        persisted_results=result_count,
    )


async def ingest_benchmark_status(db: AsyncSession, payload: BenchmarkStatusPayload) -> BenchmarkStatusResponse:
    run = await _get_benchmark_run_for_update(db, payload.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="benchmark_run_not_found")
    if payload.device_id != run.device_id:
        raise HTTPException(status_code=422, detail="device_id_does_not_match_run")

    run.last_status = payload.status
    if payload.error:
        run.error = payload.error
    if run.status == "cancelled":
        await db.commit()
        return BenchmarkStatusResponse(accepted=True, run_status=run.status)
    if payload.status in {"failed", "error", "busy", "benchmark_rejected"}:
        run.status = "failed"
        run.finished_at = utc_now()
    elif payload.status in {"started", "running"} and run.status != "failed":
        run.status = "running"
    elif payload.status == "completed" and run.status != "failed":
        if await _result_count(db, run.id) >= run.expected_results:
            run.status = "completed"
            run.finished_at = utc_now()

    await db.commit()
    return BenchmarkStatusResponse(accepted=True, run_status=run.status)
