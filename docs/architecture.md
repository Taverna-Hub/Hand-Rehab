# Arquitetura do MVP

O MVP usa o layout existente do repositorio:

- Backend: `applications/backend/`
- Frontend: `applications/frontend/`
- Node-RED: `applications/node-red/`
- Firmware: `esp32-esp8266/hand-rehab/`

Esse layout corresponde aos modulos sugeridos no PRD, apenas mantendo os nomes ja presentes no repositorio.

## Fluxo em tempo real

```text
ESP32 -> MQTT -> Node-RED -> WebSocket do Node-RED -> frontend
```

Eventos individuais de botao e pressao seguem por esse caminho para reduzir latencia. O backend e o banco nao participam do caminho critico de gameplay.

## Fluxo batch para persistencia

```text
ESP32 -> batch MQTT -> Node-RED -> FastAPI backend -> Postgres
```

O firmware monta os batches, anexa metadados de desempenho e publica em topicos MQTT dedicados. O Node-RED normaliza o payload, adiciona `source_topic` e envia ao backend por HTTP REST.

## Fluxo de controle de sessao

```text
Postman/frontend futuro -> FastAPI backend -> MQTT start_session/end_session -> ESP32
ESP32 -> MQTT realtime/session -> Node-RED -> WebSocket -> frontend
```

O backend cria a sessao com `status=running`, `duration_seconds=null` e `scheduled_finish_at=null`, publica o comando no Aedes dentro do Node-RED e responde sem aguardar ACK. A ESP32 inicia em idle, so processa inputs com sessao ativa e volta para idle depois de `end_session`.

## Servicos

- `postgres`: banco historico.
- `backend`: FastAPI, SQLAlchemy, Alembic e endpoints REST.
- `node-red`: broker Aedes interno, fluxos MQTT e WebSocket.
- `frontend`: base React + Tailwind para a futura tela de jogo.
