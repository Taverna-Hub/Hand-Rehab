# Perfilamento

Use esta pasta para dados brutos e resumos de performance.

Exemplos:

- CSVs ou logs com latencia de insercao em microssegundos.
- Medicoes de tempo de envio MQTT.
- `free_heap_bytes` e `min_free_heap_bytes`.
- `buffer_capacity`, `buffer_used` e `dropped_samples`.
- Resultados comparando Ring Buffer O(1) com abordagem ineficiente O(n).
- Testes sob gargalo ou instabilidade de rede.

## Analise de Algoritmos

Como a ESP32 fisica nao estava disponivel, a analise usa uma campanha emulada que passa pelo fluxo MQTT real do MVP.

Com os containers do MVP em execucao, rode a partir da raiz do repositorio:

```powershell
.\.venv\Scripts\python.exe entregas\perfilamento\esp32_flow_emulator.py --replicates 5
```

Saidas esperadas:

- `raw/mqtt_flow_emulated_benchmark_results.csv`

Depois gere resumo, manifesto e graficos:

```powershell
.\.venv\Scripts\python.exe entregas\perfilamento\build_emulated_report_assets.py
```

Saidas esperadas:

- `raw/mqtt_flow_emulated_benchmark_summary.csv`
- `raw/mqtt_flow_emulated_benchmark_manifest.json`
- `../graficos/aa-*.png`
- `../graficos/aa-*.svg`

## Emulacao do fluxo MQTT

O emulador cria execucoes de benchmark pela API do backend e publica resultados nos topicos MQTT reais:

- `rehab/devices/{device_id}/benchmark/status`
- `rehab/devices/{device_id}/benchmark/results`

Esse CSV continua sendo uma emulacao sem ESP32 fisica, mas os payloads passam pelo broker MQTT, pelo Node-RED e pelo backend antes de serem persistidos. Portanto ele e a evidencia principal do fluxo integrado para a entrega de AA.

Para validar sem publicar no broker:

```powershell
.\.venv\Scripts\python.exe entregas\perfilamento\esp32_flow_emulator.py --dry-run
```
