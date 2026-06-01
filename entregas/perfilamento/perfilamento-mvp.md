# Perfilamento MVP

## Campos coletados no firmware

Cada batch produzido pelo firmware inclui:

- `insert_latency_us_avg`
- `insert_latency_us_max`
- `mqtt_publish_latency_us`
- `free_heap_bytes`
- `min_free_heap_bytes`
- `buffer_capacity`
- `buffer_used`
- `dropped_samples`

## Smoke test sem ESP32

Os payloads MQTT manuais validaram a persistencia dos metadados:

- Batch de botoes: `insert_latency_us_avg=8`, `insert_latency_us_max=15`, `dropped_samples=0`.
- Batch de pressao: `insert_latency_us_avg=7`, `insert_latency_us_max=13`, `dropped_samples=1`.

## Pendente

Medicoes reais de heap, latencia e comportamento sob instabilidade de rede dependem da ESP32 fisica executando o firmware.
