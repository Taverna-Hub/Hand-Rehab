# Hand Rehab MVP

Sistema IoT para apoiar atividades de reabilitacao das maos com ESP32, quatro botoes fisicos, sensor de pressao HX710B, Node-RED, backend FastAPI e Postgres.

Este MVP entrega a base tecnica de comunicacao em tempo real e persistencia historica em batch. Gameplay completo, dashboard funcional, autenticacao e regras clinicas avancadas ficam fora deste ciclo.

## Layout do repositorio

O PRD sugere pastas como `backend/`, `frontend/`, `nodered/` e `firmware/`. Este repositorio preserva o layout inicial:

- Backend: `applications/backend/`
- Frontend: `applications/frontend/`
- Node-RED: `applications/node-red/`
- Firmware: `esp32-esp8266/hand-rehab/`
- PRD e referencias: `dev-docs/`

## Arquitetura

Fluxo de tempo real:

```text
ESP32 -> MQTT -> Node-RED/Aedes -> WebSocket Node-RED -> Frontend
```

Fluxo de persistencia:

```text
ESP32 -> batch MQTT -> Node-RED -> FastAPI Backend -> Postgres
```

Controle de sessao:

```text
Postman/frontend futuro -> Backend -> MQTT start/end -> ESP32
ESP32 -> MQTT ACK de sessao -> Node-RED -> WebSocket
```

O backend e o banco nao ficam no caminho critico dos inputs do jogador. A ESP32 inicia em idle e so publica realtime/batch depois de receber `start_session` do backend.

## Tecnologias

- Firmware: PlatformIO, Arduino Framework, FreeRTOS, PubSubClient, ArduinoJson.
- MQTT/Broker: Aedes dentro do Node-RED.
- Backend: FastAPI, SQLAlchemy async, Alembic, Pydantic.
- Banco: Postgres.
- Frontend: React, Vite, Tailwind.
- Orquestracao: Docker Compose.

## Ambiente Docker

Use `.env.example` como referencia para criar `.env` local. Valores minimos:

```env
POSTGRES_DB=rehab_game
POSTGRES_USER=rehab_user
POSTGRES_PASSWORD=rehab_password
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
DATABASE_URL=postgresql+asyncpg://rehab_user:rehab_password@postgres:5432/rehab_game
BACKEND_URL=http://backend:8000
NODE_RED_PORT=1880
MQTT_PORT=1883
MQTT_HOST=node-red
DEFAULT_DEVICE_ID=esp32-001
FRONTEND_PORT=5173
```

Suba a stack:

```bash
docker compose up --build
```

URLs locais:

- Backend health: `http://localhost:8000/health`
- Node-RED: `http://localhost:1880`
- MQTT Aedes: `localhost:1883`
- Frontend: `http://localhost:5173`

Validar a configuracao do Compose:

```bash
docker compose config
```

## Node-RED

O fluxo oficial versionado fica em:

```text
applications/node-red/flows.json
```

O container monta esse arquivo em `/data/flows.json`. Ele cria o broker Aedes na porta `1883`, recebe os topicos MQTT oficiais, encaminha realtime para `ws://localhost:1880/ws/realtime` e envia batches para o backend usando `BACKEND_URL`.

## Firmware ESP32

O projeto PlatformIO fica em:

```text
esp32-esp8266/hand-rehab/
```

Crie `include/secrets.h` com base em `include/secrets.example.h`:

```cpp
#pragma once

#define WIFI_SSID "NOME_DA_REDE"
#define WIFI_PASSWORD "SENHA_DA_REDE"
#define MQTT_HOST "192.168.0.100"
#define MQTT_PORT 1883
#define DEVICE_ID "esp32-001"
```

`MQTT_HOST` deve ser o IP LAN do computador que roda Docker, nunca `nodered`. No Windows, use `ipconfig` e procure o IPv4 da interface Wi-Fi ou Ethernet. No Linux/macOS, use `ip addr` ou `ifconfig`.

Comandos PlatformIO:

```bash
pio run
pio run --target upload
pio device monitor
```

Pinos centralizados em `src/config/pins.h`:

- Botao 1: D13 / GPIO 13
- Botao 2: D12 / GPIO 12
- Botao 3: D14 / GPIO 14
- Botao 4: D27 / GPIO 27
- HX710B DOUT/OUT: D15 / GPIO 15
- HX710B SCK/CLK: D2 / GPIO 2
- LED status: D23 / GPIO 23

## Topicos MQTT

Realtime:

- `rehab/devices/{device_id}/realtime/buttons`
- `rehab/devices/{device_id}/realtime/pressure`
- `rehab/devices/{device_id}/realtime/session`

Batch:

- `rehab/devices/{device_id}/batch/buttons`
- `rehab/devices/{device_id}/batch/pressure`

Comandos opcionais:

- `rehab/devices/{device_id}/commands/start_session`
- `rehab/devices/{device_id}/commands/end_session`
- `rehab/devices/{device_id}/commands/calibrate`
- `rehab/devices/{device_id}/commands/tare`
- `rehab/devices/{device_id}/commands/ping`

## Exemplos de payload

Comando de inicio publicado pelo backend:

```json
{
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "buttons"
}
```

ACK de inicio publicado pela ESP32 em `realtime/session`:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "buttons",
  "event_type": "session_started",
  "timestamp_ms": 1234
}
```

Realtime de botao:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "buttons",
  "button_id": 1,
  "event_type": "pressed",
  "timestamp_ms": 123456
}
```

Realtime de pressao:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "left",
  "mode": "pressure",
  "pressure_raw": 84532,
  "pressure_kpa": null,
  "timestamp_ms": 123456
}
```

Batch de botoes:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "buttons",
  "batch_id": "buttons-batch-001",
  "strategy": "ring_buffer",
  "sequence_start": 1,
  "sequence_end": 2,
  "created_at_ms": 123900,
  "performance": {
    "insert_latency_us_avg": 8,
    "insert_latency_us_max": 15,
    "mqtt_publish_latency_us": 1200,
    "free_heap_bytes": 185320,
    "min_free_heap_bytes": 184900,
    "buffer_capacity": 64,
    "buffer_used": 2,
    "dropped_samples": 0
  },
  "events": [
    {"button_id": 1, "event_type": "pressed", "timestamp_ms": 123456, "sequence": 1}
  ]
}
```

Batch de pressao:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "left",
  "mode": "pressure",
  "batch_id": "pressure-batch-001",
  "strategy": "ring_buffer",
  "sequence_start": 1,
  "sequence_end": 2,
  "created_at_ms": 123900,
  "performance": {
    "insert_latency_us_avg": 7,
    "insert_latency_us_max": 13,
    "mqtt_publish_latency_us": 1500,
    "free_heap_bytes": 185100,
    "min_free_heap_bytes": 184700,
    "buffer_capacity": 64,
    "buffer_used": 2,
    "dropped_samples": 0
  },
  "samples": [
    {"pressure_raw": 84532, "pressure_kpa": null, "timestamp_ms": 123456, "sequence": 1}
  ]
}
```

## Endpoints principais

- `GET /health`
- `POST /api/v1/users`
- `GET /api/v1/users`
- `GET /api/v1/users/{user_id}`
- `POST /api/v1/game-sessions/start`
- `GET /api/v1/game-sessions`
- `GET /api/v1/game-sessions/{session_id}`
- `PATCH /api/v1/game-sessions/{session_id}/finish`
- `POST /api/v1/ingest/batches/buttons`
- `POST /api/v1/ingest/batches/pressure`
- `GET /api/v1/metrics/sessions/{session_id}/summary`
- `GET /api/v1/metrics/users/{user_id}/summary`

## Buffer Circular

A estrategia eficiente do firmware usa Ring Buffer com capacidade fixa, indices `head` e `tail`, insercao/remocao O(1) e contador de drops. A estrategia comparativa ineficiente usa deslocamento de elementos em vetor, com remocao O(n), apenas para analise academica.

Cada batch inclui `performance` com latencia de insercao, latencia de envio MQTT, heap livre, menor heap observado, uso do buffer e drops acumulados.

## Limitacoes do MVP

- Sem gameplay completo.
- Sem dashboard historica funcional.
- Sem autenticacao.
- Sem regras clinicas avancadas.
- Sem sessao fixa no firmware: a ESP32 inicia idle e aguarda `start_session`.
- Frontend permanece minimo; inicio/fim de sessao podem ser testados via Postman.
- Teste fisico depende de ESP32, botoes e HX710B conectados.
