from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.services.mqtt import get_mqtt_publisher


class FakeMqttPublisher:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def publish_start_session(self, device_id: str, payload: dict) -> None:
        self.messages.append(
            {
                "topic": f"rehab/devices/{device_id}/commands/start_session",
                "payload": payload,
            }
        )

    async def publish_end_session(self, device_id: str, payload: dict) -> None:
        self.messages.append(
            {
                "topic": f"rehab/devices/{device_id}/commands/end_session",
                "payload": payload,
            }
        )

    async def publish_start_benchmark(self, device_id: str, payload: dict) -> None:
        self.messages.append(
            {
                "topic": f"rehab/devices/{device_id}/commands/start_benchmark",
                "payload": payload,
            }
        )

    async def publish_calibrate_pressure(self, device_id: str, payload: dict) -> None:
        self.messages.append(
            {
                "topic": f"rehab/devices/{device_id}/commands/calibrate",
                "payload": payload,
            }
        )


@pytest.fixture
def mqtt_publisher() -> FakeMqttPublisher:
    return FakeMqttPublisher()


@pytest.fixture
async def client(mqtt_publisher: FakeMqttPublisher) -> AsyncIterator[AsyncClient]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with TestingSessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_mqtt_publisher] = lambda: mqtt_publisher
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()
    await engine.dispose()
