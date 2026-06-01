from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import Depends
from paho.mqtt import publish

from app.core.config import Settings, get_settings


class MqttCommandPublisher:
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port

    async def publish_start_session(self, device_id: str, payload: dict[str, Any]) -> None:
        await self._publish(f"rehab/devices/{device_id}/commands/start_session", payload)

    async def publish_end_session(self, device_id: str, payload: dict[str, Any]) -> None:
        await self._publish(f"rehab/devices/{device_id}/commands/end_session", payload)

    async def _publish(self, topic: str, payload: dict[str, Any]) -> None:
        message = json.dumps(payload, separators=(",", ":"))
        await asyncio.to_thread(
            publish.single,
            topic,
            payload=message,
            qos=1,
            retain=False,
            hostname=self.host,
            port=self.port,
        )


def get_mqtt_publisher(settings: Settings = Depends(get_settings)) -> MqttCommandPublisher:
    return MqttCommandPublisher(settings.mqtt_host, settings.mqtt_port)
