from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.metrics import SessionSummary, UserSummary
from app.services.metrics import get_session_summary, get_user_summary

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/sessions/{session_id}/summary", response_model=SessionSummary)
async def session_summary(session_id: str, session: AsyncSession = Depends(get_session)) -> SessionSummary:
    return await get_session_summary(session, session_id)


@router.get("/users/{user_id}/summary", response_model=UserSummary)
async def user_summary(user_id: str, session: AsyncSession = Depends(get_session)) -> UserSummary:
    return await get_user_summary(session, user_id)
