from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models import User
from app.schemas.users import UserCreate, UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.post(
    "",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Criar usuario",
    description="Cadastra um paciente/usuario que podera executar sessoes de jogo de reabilitacao.",
)
async def create_user(payload: UserCreate, session: AsyncSession = Depends(get_session)) -> User:
    user = User(**payload.model_dump())
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@router.get(
    "",
    response_model=list[UserRead],
    summary="Listar usuarios",
    description="Retorna todos os usuarios cadastrados, ordenados do mais recente para o mais antigo.",
)
async def list_users(session: AsyncSession = Depends(get_session)) -> list[User]:
    result = await session.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


@router.get(
    "/{user_id}",
    response_model=UserRead,
    summary="Consultar usuario",
    description="Retorna os dados cadastrais de um usuario especifico.",
    responses={404: {"description": "Usuario nao encontrado."}},
)
async def get_user(user_id: str, session: AsyncSession = Depends(get_session)) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    return user
