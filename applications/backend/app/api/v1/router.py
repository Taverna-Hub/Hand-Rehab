from fastapi import APIRouter

from app.api.v1 import benchmarks, devices, game_sessions, ingest, metrics, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(benchmarks.router)
api_router.include_router(devices.router)
api_router.include_router(users.router)
api_router.include_router(game_sessions.router)
api_router.include_router(ingest.router)
api_router.include_router(metrics.router)
