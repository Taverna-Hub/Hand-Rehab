from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.models import GameSession, GameplayMetrics, User

logger = logging.getLogger(__name__)


class SessionFinishNotifier(Protocol):
    async def notify_session_finished(
        self,
        game_session: GameSession,
        user: User,
        metrics: GameplayMetrics | None,
    ) -> None:
        ...


class NoopSessionFinishNotifier:
    async def notify_session_finished(
        self,
        game_session: GameSession,
        user: User,
        metrics: GameplayMetrics | None,
    ) -> None:
        return None


@dataclass(frozen=True)
class TelegramSessionFinishNotifier:
    bot_token: str
    chat_id: str
    api_base_url: str = "https://api.telegram.org"
    timeout_seconds: int = 5

    async def notify_session_finished(
        self,
        game_session: GameSession,
        user: User,
        metrics: GameplayMetrics | None,
    ) -> None:
        await self.send_text(build_session_finished_message(game_session, user, metrics))

    async def send_text(self, text: str) -> None:
        payload = json.dumps({"chat_id": self.chat_id, "text": text}, ensure_ascii=False).encode("utf-8")
        url = f"{self.api_base_url.rstrip('/')}/bot{self.bot_token}/sendMessage"

        def post_message() -> None:
            request = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                response.read()

        try:
            await asyncio.to_thread(post_message)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"telegram_send_failed status={exc.code} body={body}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"telegram_send_failed reason={exc.reason}") from exc


def _duration_text(seconds: int | None) -> str:
    if seconds is None:
        return "-"
    hours, remainder = divmod(max(0, seconds), 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _metric_text(value: Decimal | int | float | None, suffix: str = "") -> str:
    if value is None:
        return "-"
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        return f"{value:.1f}{suffix}"
    return f"{value}{suffix}"


def build_session_finished_message(
    game_session: GameSession,
    user: User,
    metrics: GameplayMetrics | None,
) -> str:
    hand = {"left": "esquerda", "right": "direita"}.get(game_session.hand, game_session.hand)
    mode = {"buttons": "4 botoes", "pressure": "pressao"}.get(game_session.mode, game_session.mode)
    lines = [
        "Sessao finalizada - Hand Rehab",
        "",
        f"Paciente: {user.name}",
        f"Sessao: {game_session.id}",
        f"Dispositivo: {game_session.device_id}",
        f"Modo: {mode}",
        f"Mao: {hand}",
        f"Duracao: {_duration_text(game_session.duration_seconds)}",
    ]

    if metrics is None:
        lines.extend(["", "Desempenho: metricas nao enviadas."])
        return "\n".join(lines)

    lines.extend(
        [
            "",
            "Desempenho:",
            f"Pontuacao: {metrics.score}",
            f"Acertos: {metrics.hits}/{metrics.total_stimuli}",
            f"Erros: {metrics.errors}",
            f"Estimulos perdidos: {metrics.missed_stimuli}",
            f"Precisao: {_metric_text(metrics.accuracy_rate, '%')}",
            f"Maior combo: {metrics.max_combo}",
            f"Reacao media: {_metric_text(metrics.avg_reaction_ms, ' ms')}",
            f"Melhor reacao: {_metric_text(metrics.best_reaction_ms, ' ms')}",
        ]
    )
    return "\n".join(lines)


def get_session_finish_notifier(settings: Settings = Depends(get_settings)) -> SessionFinishNotifier:
    token = settings.telegram_bot_token.strip() if settings.telegram_bot_token else ""
    chat_id = settings.telegram_chat_id.strip() if settings.telegram_chat_id else ""
    if not token or not chat_id:
        return NoopSessionFinishNotifier()
    return TelegramSessionFinishNotifier(token, chat_id, settings.telegram_api_base_url)


async def notify_session_finished_best_effort(
    notifier: SessionFinishNotifier,
    game_session: GameSession,
    user: User,
    metrics: GameplayMetrics | None,
) -> None:
    try:
        await notifier.notify_session_finished(game_session, user, metrics)
    except Exception:
        logger.exception("Falha ao enviar notificacao de sessao finalizada.")
