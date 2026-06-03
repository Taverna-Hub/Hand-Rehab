# Evidencia de benchmark emulado pelo fluxo MQTT

Data: 2026-06-03

## Objetivo

Validar o fluxo integrado de benchmark sem ESP32 fisica, usando um emulador que publica payloads nos topicos MQTT reais do projeto.

Fluxo exercitado:

```text
esp32_flow_emulator.py -> MQTT Aedes/Node-RED -> Backend -> Postgres
```

## Pre-condicoes

- Backend em `http://localhost:8000`.
- Node-RED em `http://localhost:1880`.
- Broker MQTT em `localhost:1883`.
- Postgres saudavel no Docker.

## Ajuste necessario no ambiente

O backend inicialmente reiniciava por conflito de migrations Alembic:

```text
Multiple head revisions are present
Revision 20260602_0004 is present more than once
```

A migration de `gameplay_metrics` foi renomeada para a revisao `20260602_0006`, com `down_revision = "20260602_0005"`, deixando a cadeia linear.

## Comandos executados

Checagens locais:

```powershell
Invoke-WebRequest http://localhost:8000/health -UseBasicParsing
Invoke-WebRequest http://localhost:1880 -UseBasicParsing
Test-NetConnection -ComputerName localhost -Port 1883
```

Rebuild do backend apos ajuste da migration:

```powershell
docker compose up --build -d backend
```

Execucao do emulador:

```powershell
.\.venv\Scripts\python.exe entregas\perfilamento\esp32_flow_emulator.py --replicates 5
```

## Resultado

- Foram publicadas 90 linhas de benchmark.
- Foram criadas 15 execucoes novas no backend.
- Cada execucao persistiu 6 resultados: 3 escalas de `N` x 2 estrategias.
- Todas as execucoes novas retornaram `status=completed`.

Arquivo gerado:

```text
entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_results.csv
```

Execucoes finais registradas no backend e salvas no CSV:

```text
b0f3aaae-5426-466d-80d8-12ba5bc547be
336c3959-09eb-4ecb-9037-0216e2716252
7a119036-2378-4603-9932-f4599a639dd6
e34ab845-b07e-49ac-8df6-a2b642a4dfa9
52e5f271-f8c1-41cb-bdc3-d73d98f8e57b
7cfc06e5-9b51-43c9-ab24-b9c4fff924dc
34f48666-ca93-43a9-855e-14e4645954c5
a5e309f7-c900-4286-83eb-cbcc4db55915
78ca93de-5ab7-45dd-8d4b-23ba94ffe939
ca5c8cec-f465-460a-819b-c50f4bca0d00
af36addf-3ae1-4cb1-9acf-d9ef1e37bd0c
c8f7767e-b10a-484f-a3bc-f5699525eb56
34fd2236-b5c1-4079-9409-ba1717922eac
04558e24-9d53-49f1-8015-0586d47931f5
67589d08-00e9-467c-8192-9b0e372a2e9b
```

## Limitacao

Os tempos de algoritmo continuam emulados, pois nao houve ESP32 fisica executando `micros()` e `ESP.getFreeHeap()`. A evidencia valida o caminho de publicacao MQTT, roteamento Node-RED, ingestao no backend e persistencia no banco.
