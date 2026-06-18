from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://rehab_user:rehab_password@postgres:5432/rehab_game"
    sql_echo: bool = False
    cors_origins: list[str] = ["http://localhost:5173"]
    mqtt_host: str = "node-red"
    mqtt_port: int = 1883
    default_device_id: str = "esp32-001"
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    telegram_api_base_url: str = "https://api.telegram.org"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
