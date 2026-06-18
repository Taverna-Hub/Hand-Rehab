# Topicos MQTT oficiais

Todas as mensagens publicadas pela ESP32 devem ser JSON valido e conter `device_id`. Mensagens associadas a sessoes tambem devem conter `session_id`, `user_id`, `hand`, `mode` e `timestamp_ms` quando forem eventos individuais.

## Tempo real

- `rehab/devices/{device_id}/realtime/buttons`
- `rehab/devices/{device_id}/realtime/pressure`
- `rehab/devices/{device_id}/realtime/session`

## Batch para persistencia

- `rehab/devices/{device_id}/batch/buttons`
- `rehab/devices/{device_id}/batch/pressure`

## Comandos backend -> ESP32

- `rehab/devices/{device_id}/commands/start_session`
- `rehab/devices/{device_id}/commands/end_session`

O backend publica esses comandos diretamente no broker Aedes do Node-RED (`MQTT_HOST=node-red`, porta `1883`). A ESP32 inicia em idle e so publica realtime/batch depois de receber `start_session`.

Payload de `start_session`:

```json
{
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "buttons"
}
```

Payload esperado de ACK em `rehab/devices/{device_id}/realtime/session`:

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

Ao receber `end_session`, a ESP32 faz flush dos buffers, publica `event_type="session_finished"` em `realtime/session` e volta para idle.

## Comandos auxiliares

- `rehab/devices/{device_id}/commands/calibrate`
- `rehab/devices/{device_id}/commands/tare`
- `rehab/devices/{device_id}/commands/ping`

## Payload realtime de botao

```json
{
  "device_id": "esp32-001",
  "session_id": "00000000-0000-0000-0000-000000000000",
  "user_id": "00000000-0000-0000-0000-000000000000",
  "hand": "right",
  "mode": "buttons",
  "button_id": 1,
  "event_type": "pressed",
  "timestamp_ms": 123456
}
```

## Payload realtime de pressao

`pressure_delta_raw` e `pressure_kpa` so devem ser tratados como input de jogo quando `pressure_calibrated` for `true` ou quando o frontend ja tiver recebido uma baseline por `calibration_completed`.

```json
{
  "device_id": "esp32-001",
  "session_id": "00000000-0000-0000-0000-000000000000",
  "user_id": "00000000-0000-0000-0000-000000000000",
  "hand": "right",
  "mode": "pressure",
  "pressure_raw": 23100,
  "pressure_delta_raw": 900,
  "pressure_baseline_raw": 22200,
  "pressure_calibrated": true,
  "pressure_hit_threshold_raw": 700,
  "pressure_release_threshold_raw": 350,
  "pressure_kpa": 0.09,
  "timestamp_ms": 123456,
  "sequence": 2
}
```

## Payload batch de pressao

```json
{
  "device_id": "esp32-001",
  "session_id": "00000000-0000-0000-0000-000000000000",
  "user_id": "00000000-0000-0000-0000-000000000000",
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
