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
from app.services.notifications import get_session_finish_notifier


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


class FakeSessionFinishNotifier:
    def __init__(self) -> None:
        self.notifications: list[dict] = []

    async def notify_session_finished(self, game_session, user, metrics) -> None:
        self.notifications.append(
            {
                "session_id": game_session.id,
                "user_name": user.name,
                "duration_seconds": game_session.duration_seconds,
                "score": None if metrics is None else metrics.score,
                "hits": None if metrics is None else metrics.hits,
                "total_stimuli": None if metrics is None else metrics.total_stimuli,
            }
        )


@pytest.fixture
def mqtt_publisher() -> FakeMqttPublisher:
    return FakeMqttPublisher()


@pytest.fixture
def session_finish_notifier() -> FakeSessionFinishNotifier:
    return FakeSessionFinishNotifier()


@pytest.fixture
async def client(
    mqtt_publisher: FakeMqttPublisher,
    session_finish_notifier: FakeSessionFinishNotifier,
) -> AsyncIterator[AsyncClient]:
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
    app.dependency_overrides[get_session_finish_notifier] = lambda: session_finish_notifier
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()
    await engine.dispose()
