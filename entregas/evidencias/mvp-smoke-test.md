# Evidencias do smoke test integrado sem ESP32

Data: 2026-05-30

## Comandos principais

- `docker compose config`
- `docker compose up --build -d`
- `Invoke-WebRequest http://localhost:8000/health`
- `Invoke-WebRequest http://localhost:1880`
- `Invoke-WebRequest http://localhost:5173`
- `Test-NetConnection -ComputerName localhost -Port 1883`
- Publicacao MQTT com cliente Python `paho-mqtt`.
- Recebimento realtime via `ws://localhost:1880/ws/realtime`.
- `docker exec handrehab-postgres psql -U rehab_user -d rehab_game -c "\dt"`
- `pio run`

## Resultado

- Backend respondeu `{"status":"ok"}`.
- Node-RED respondeu HTTP 200.
- Frontend respondeu HTTP 200.
- MQTT Aedes aceitou conexao na porta 1883.
- WebSocket recebeu realtime de botoes e pressao com `source_topic`.
- Batch de botoes persistiu 2 eventos.
- Batch de pressao persistiu 2 leituras.
- Batches incompativeis nao persistiram dados no modo errado.
- Postgres contem as tabelas `users`, `devices`, `game_sessions`, `telemetry_batches`, `batch_performance_metadata`, `button_events` e `pressure_readings`.

## IDs do teste integrado

- Usuario: `4c8ba28f-a069-46df-8be7-2a7a8ced49d1`
- Sessao botoes: `003a97fa-0aca-45a2-9593-e29dd6c158d3`
- Sessao pressao: `1a928138-e914-4fa5-8bc2-dea545e595cf`
