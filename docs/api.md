# API do Backend

Base local: `http://localhost:8000`

## Health

- `GET /health`

Resposta:

```json
{"status": "ok"}
```

## Usuarios

- `POST /api/v1/users`
- `GET /api/v1/users`
- `GET /api/v1/users/{user_id}`

Payload de criacao:

```json
{"name": "Paciente Teste", "age": 35, "sex": "not_informed"}
```

## Sessoes de jogo

- `POST /api/v1/game-sessions/start`
- `GET /api/v1/game-sessions`
- `GET /api/v1/game-sessions/active`
- `GET /api/v1/game-sessions/{session_id}`
- `PATCH /api/v1/game-sessions/{session_id}/finish`

Payload de inicio:

```json
{
  "user_id": "uuid-do-usuario",
  "device_id": "esp32-001",
  "hand": "right",
  "mode": "buttons"
}
```

`device_id` e opcional e usa `esp32-001` por padrao. A sessao nasce com `status="running"`, `duration_seconds=null` e `scheduled_finish_at=null`.

Ao iniciar, o backend publica MQTT em `rehab/devices/{device_id}/commands/start_session`.

Como o MVP opera com um dispositivo e uma pessoa por vez, a API aceita somente uma sessao `running` no sistema. Se ja houver sessao ativa, `POST /api/v1/game-sessions/start` e `POST /api/v1/game-sessions` retornam:

```json
{"detail": "active_session_exists"}
```

com status HTTP `409`.

`GET /api/v1/game-sessions/active` retorna apenas sessoes com `status="running"`. Pela regra atual, a lista tera no maximo um item.

Payload de finalizacao:

```json
{}
```

O corpo do `PATCH /api/v1/game-sessions/{session_id}/finish` pode ser omitido. Ao finalizar, o backend calcula `duration_seconds` a partir de `finished_at - started_at`, marca `status="finished"` e publica MQTT em `rehab/devices/{device_id}/commands/end_session`.

Se a sessao ja estiver finalizada ou nao estiver `running`, a API retorna:

```json
{"detail": "session_not_running"}
```

com status HTTP `409` e nao publica outro comando MQTT.

## Ingestao batch

- `POST /api/v1/ingest/batches/buttons`
- `POST /api/v1/ingest/batches/pressure`

Os endpoints validam sessao existente, compatibilidade de `hand` e `mode`, `user_id` quando enviado e persistem apenas dados compativeis com o modo da sessao.

Campos numericos devem ser enviados como numeros JSON, nao como strings. Exemplo valido: `"timestamp_ms": 123456`; exemplo invalido: `"timestamp_ms": "123456"`.

Internamente, batches/metadados de botoes e pressao ficam em tabelas separadas, mantendo `hand` em cada registro.

## Metricas

- `GET /api/v1/metrics/sessions/{session_id}/summary`
- `GET /api/v1/metrics/users/{user_id}/summary`

As metricas retornam contagens de eventos/leitura, batches, drops, latencias de insercao e dados basicos de sessao ou usuario.

## Swagger/OpenAPI

A documentacao interativa fica em `GET /docs`, gerada pelo Swagger UI. O documento OpenAPI bruto fica em `GET /openapi.json`.
