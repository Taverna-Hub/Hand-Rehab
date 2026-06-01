# PRD Técnico — MVP com Fluxo em Tempo Real e Fluxo Batch para Persistência

## 0. Instrução para o Codex

Este documento deve ser usado para **checar, corrigir e completar uma codebase existente**. O objetivo não é recriar tudo do zero sem necessidade.

Antes de criar novos arquivos ou reescrever módulos, faça uma auditoria do projeto atual:

1. Inspecione a estrutura existente do repositório.
2. Identifique quais módulos já existem: `backend`, `frontend`, `firmware`, `nodered`, `database`, `docker-compose`.
3. Preserve o que já estiver funcional.
4. Corrija inconsistências em relação a este PRD.
5. Complete apenas o que estiver ausente ou incompleto.
6. Evite implementar funcionalidades fora do escopo.
7. Não implemente o jogo completo no frontend.
8. Não implemente dashboard funcional neste ciclo.
9. Implemente apenas o necessário para demonstrar comunicação em tempo real, batch para persistência, backend e banco.
10. O backend deve persistir dados históricos porque a dashboard futura consultará jogos passados e métricas de desempenho.

## 1. Contexto do Projeto

O projeto é um sistema IoT com ESP32 para auxiliar atividades de reabilitação das mãos. A implementação será testada fisicamente com:

- 1 ESP32.
- 1 sensor de pressão HX710B conectado a um sistema fechado de ar.
- 4 botões físicos.

Portanto, o firmware não deve ser tratado apenas como simulação. Ele precisa compilar e estar preparado para execução em uma ESP32 real usando PlatformIO.

O produto final terá:

- Uma tela de jogo, separada da dashboard.
- Uma dashboard para visualização de dados históricos e métricas.

Neste MVP, o foco é criar a base técnica para:

- Coletar dados da ESP32.
- Enviar inputs ao jogo em tempo real.
- Preparar lotes de dados no firmware para persistência.
- Enviar batches via MQTT.
- Receber dados no Node-RED com broker Aedes interno.
- Encaminhar eventos em tempo real ao frontend.
- Encaminhar batches ao backend.
- Persistir dados históricos no Postgres.
- Permitir métricas por sessão e por usuário.

## 2. Integração com o Projeto Auxiliar de Buffer Circular

Este PRD integra o projeto auxiliar de otimização de telemetria com Buffer Circular.

A integração **não quebra os requisitos do projeto auxiliar**, desde que sejam cumpridas estas regras:

1. O batch deve ser preparado no firmware da ESP32.
2. A implementação eficiente deve usar Buffer Circular/Ring Buffer com operações O(1).
3. O código do firmware deve conter também a abordagem ineficiente para comparação acadêmica.
4. O firmware deve medir latência de inserção, tempo de envio e uso de memória/heap.
5. Os batches devem ser enviados via MQTT.
6. O backend deve persistir os batches e os metadados de desempenho necessários para análise posterior.

Remoção importante:

- O batch anterior de métricas técnicas isoladas foi removido.
- O batch agora é o **fluxo oficial de persistência dos dados do jogo**.
- As métricas técnicas necessárias ao projeto auxiliar devem ser anexadas como metadados do próprio batch ou persistidas como metadados associados ao batch.

## 3. Escopo Estrito do MVP

## 3.1 Dentro do escopo

### Infraestrutura

- Monorepo organizado por módulos.
- `docker-compose.yml` funcional.
- Serviço Postgres.
- Serviço Backend FastAPI.
- Serviço Node-RED com Aedes rodando dentro do Node-RED.
- Serviço Frontend React + Tailwind apenas base.
- `.env.example`.
- README com instruções de execução.

### Firmware ESP32

- Projeto PlatformIO obrigatório.
- Arduino Framework obrigatório.
- Uso obrigatório das APIs/métodos/funções do PlatformIO para estruturação, build, upload e monitoramento.
- Uso de FreeRTOS.
- Leitura do HX710B.
- Leitura dos 4 botões.
- Interrupções nos botões.
- Filas FreeRTOS para eventos.
- Semáforos/mutexes/event groups para sincronização.
- Publicação MQTT em tempo real para o jogo.
- Preparação de batches no firmware para persistência.
- Implementação de Ring Buffer para o batch eficiente.
- Implementação comparativa ineficiente para cumprir o projeto auxiliar.
- Medição de latência e memória para comparar as duas estratégias.

### Node-RED

- Arquivo `flows.json` versionado e importável.
- Broker Aedes rodando dentro do Node-RED.
- Entrada MQTT para dados da ESP32.
- Fluxo de tempo real para encaminhar inputs ao frontend.
- Fluxo de batch para encaminhar dados ao backend.
- Transformação/normalização mínima dos payloads.
- Nós de debug para facilitar demonstração.

### Backend

- FastAPI.
- SQLAlchemy.
- Alembic.
- Pydantic.
- Conexão com Postgres.
- Endpoints de healthcheck.
- Endpoints de usuários.
- Endpoints de sessões de jogo.
- Endpoints de ingestão batch vindos do Node-RED.
- Persistência de usuários, sessões, eventos de botão, leituras de pressão e metadados de batch.
- Consultas básicas para métricas por sessão e por usuário.

### Banco

- Schema inicial no Postgres.
- Migrations versionadas.
- Tabelas principais para usuários, dispositivos, sessões, eventos, leituras e batches.
- `game_sessions` deve ter FK para `users`.
- Campo obrigatório para diferenciar mão direita e esquerda.
- Campo obrigatório para diferenciar modo de jogo.
- Campo obrigatório para duração definida do jogo.

### Frontend

- Criar projeto base em React + Tailwind.
- Criar Dockerfile.
- Ter estrutura preparada para futura tela de jogo.
- Ter estrutura preparada para futura conexão em tempo real com Node-RED.
- Não criar dashboard funcional neste ciclo.
- Não implementar tela de jogo completa neste ciclo.

## 3.2 Fora do escopo

Não implementar neste ciclo:

- Gameplay completo.
- Dashboard funcional completa.
- Autenticação.
- Cadastro avançado de pacientes.
- Cadastro de fisioterapeutas.
- Regras clínicas avançadas.
- Deploy em nuvem.
- Aplicativo mobile.
- Relatórios finais.
- Algoritmos de recomendação terapêutica.
- Validação clínica.

## 4. Decisões Técnicas Obrigatórias

| Item | Decisão |
|---|---|
| Backend | FastAPI |
| Frontend | React + Tailwind, base inicial |
| Banco | Postgres |
| Firmware | PlatformIO + Arduino Framework |
| RTOS | FreeRTOS |
| Broker MQTT | Aedes rodando dentro do Node-RED |
| Comunicação ESP32 -> Node-RED | MQTT |
| Comunicação Node-RED -> Frontend | WebSocket ou endpoint realtime do Node-RED |
| Comunicação Node-RED -> Backend | HTTP REST |
| Comunicação Backend -> Banco | SQL/Postgres |
| Controle do jogo | Futuramente no frontend |
| Inputs do jogador | Botões e sensor de pressão da ESP32 |
| Tempo real | Inputs enviados individualmente ao frontend |
| Persistência | Dados enviados em batch ao backend |
| Batch | Preparado no firmware da ESP32 |
| Estratégia eficiente | Ring Buffer/Buffer Circular |
| Estratégia ineficiente | Deslocamento/realloc ou estrutura dinâmica comparativa |
| Seleção da mão | Definida na tela do jogo e registrada na sessão |
| Seleção do modo | Definida na tela do jogo e registrada na sessão |
| Usuário do jogo | Sessão deve referenciar um usuário |
| Mão da sessão | `left` ou `right` |
| Modos da sessão | `buttons` ou `pressure` |
| Duração da sessão | Obrigatória |

## 5. Arquitetura Esperada

## 5.1 Visão geral

```text
                         ┌──────────────────────────────┐
                         │        Frontend / Jogo        │
                         │  recebe inputs em tempo real  │
                         └──────────────▲───────────────┘
                                        │ WebSocket/realtime
                                        │
[ESP32 + HX710B + Botões] ── MQTT ──> [Node-RED + Aedes]
          │                             │
          │                             │ HTTP REST batch
          │                             ▼
          │                       [FastAPI Backend]
          │                             │
          │                             │ SQL
          │                             ▼
          │                         [Postgres]
          │
          └── prepara batches no firmware para persistência
```

## 5.2 Fluxo 1 — Tempo real para o jogo

Objetivo: entregar inputs ao frontend com baixa latência.

```text
Botão/Pressão na ESP32
    -> evento individual MQTT
    -> Node-RED/Aedes
    -> WebSocket ou mecanismo realtime do Node-RED
    -> Frontend/Jogo
```

Regras:

- Não enviar input de gameplay em batch neste fluxo.
- Eventos de botão devem ser enviados individualmente.
- Leituras de pressão usadas no gameplay devem ser enviadas individualmente.
- O backend não deve estar no caminho crítico do input do jogador.
- O banco não deve estar no caminho crítico do input do jogador.
- Esse fluxo prioriza baixa latência, não persistência.

## 5.3 Fluxo 2 — Batch para persistência histórica

Objetivo: salvar dados históricos para dashboard e métricas.

```text
Botão/Pressão na ESP32
    -> cópia local do dado no firmware
    -> Buffer Circular/Ring Buffer
    -> batch MQTT
    -> Node-RED/Aedes
    -> HTTP POST Backend
    -> Postgres
```

Regras:

- O batch deve ser montado no firmware.
- O batch deve usar Ring Buffer na estratégia eficiente.
- O batch deve ser enviado ao backend de forma assíncrona.
- Esse fluxo não deve bloquear o fluxo de tempo real.
- O backend persiste dados históricos para consulta futura da dashboard.
- Ao fim de uma sessão de tempo definido, o firmware deve fazer flush do batch restante.

## 6. Estrutura Esperada do Monorepo

A estrutura pode ser adaptada ao que já existir, mas o resultado final deve manter separação clara por módulo.

Deve existir uma pasta `dev-docs/` para armazenar os documentos de requisitos do projeto e este PRD. Essa pasta deve conter os PDFs fornecidos como referência e pode conter este PRD em Markdown.

```text
.
├── README.md
├── docker-compose.yml
├── .env.example
├── .env                    # ignorado pelo Git
├── dev-docs/
│   ├── Projeto-Embarcados_CesarSchool-v2.pdf
│   ├── Requisitos - AA.pdf
│   └── PRD.md
├── docs/
│   ├── architecture.md
│   ├── mqtt-topics.md
│   ├── api.md
│   └── buffering-analysis.md
├── firmware/
│   └── esp32-rhythm-rehab/
│       ├── platformio.ini
│       ├── include/
│       │   ├── secrets.example.h
│       │   └── secrets.h       # ignorado pelo Git
│       ├── lib/
│       ├── src/
│       │   ├── main.cpp
│       │   ├── config/
│       │   │   └── pins.h
│       │   ├── drivers/
│       │   │   ├── hx710b_driver.cpp
│       │   │   ├── hx710b_driver.h
│       │   │   ├── button_driver.cpp
│       │   │   └── button_driver.h
│       │   ├── buffering/
│       │   │   ├── ring_buffer.h
│       │   │   ├── ring_buffer.cpp
│       │   │   ├── inefficient_buffer.h
│       │   │   └── inefficient_buffer.cpp
│       │   ├── tasks/
│       │   │   ├── wifi_task.cpp
│       │   │   ├── mqtt_task.cpp
│       │   │   ├── pressure_task.cpp
│       │   │   ├── button_task.cpp
│       │   │   ├── realtime_publish_task.cpp
│       │   │   └── batch_publish_task.cpp
│       │   └── models/
│       │       ├── events.h
│       │       ├── batch.h
│       │       └── messages.h
│       └── test/
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   └── app/
│       ├── main.py
│       ├── core/
│       │   ├── config.py
│       │   └── logging.py
│       ├── db/
│       │   ├── base.py
│       │   └── session.py
│       ├── models/
│       ├── schemas/
│       ├── repositories/
│       ├── services/
│       └── api/
│           └── v1/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
├── nodered/
│   ├── flows.json
│   ├── package.json
│   └── settings.js
├── database/
│   ├── init.sql
│   └── README.md
└── schematics/
    └── README.md
```

## 7. Configuração de Variáveis de Ambiente

O projeto deve separar claramente as variáveis usadas pelos containers das variáveis usadas pela ESP32.

A ESP32 roda fora da rede Docker, portanto não deve depender dos hostnames internos dos containers, como `nodered`, `backend` ou `postgres`. Já os containers devem se comunicar entre si usando os nomes dos serviços definidos no `docker-compose.yml`.

## 7.1 Configuração do firmware ESP32

O firmware deve usar arquivos de configuração próprios dentro do projeto PlatformIO.

Estrutura esperada:

```text
firmware/esp32-rhythm-rehab/
├── include/
│   ├── secrets.example.h
│   └── secrets.h
```

O arquivo `secrets.example.h` deve ser versionado e servir como modelo:

```cpp
#pragma once

#define WIFI_SSID "NOME_DA_REDE"
#define WIFI_PASSWORD "SENHA_DA_REDE"

#define MQTT_HOST "192.168.0.100"
#define MQTT_PORT 1883

#define DEVICE_ID "esp32-001"
```

O arquivo `secrets.h` deve conter os valores reais usados localmente e deve ser ignorado pelo Git.

Adicionar ao `.gitignore`:

```gitignore
firmware/esp32-rhythm-rehab/include/secrets.h
```

Regras:

- `WIFI_SSID` deve conter o nome da rede Wi-Fi usada pela ESP32.
- `WIFI_PASSWORD` deve conter a senha da rede Wi-Fi usada pela ESP32.
- `MQTT_HOST` deve ser o IP LAN do computador onde o Docker está rodando.
- `MQTT_HOST` não deve ser `nodered`, porque esse hostname só funciona dentro da rede Docker.
- `MQTT_PORT` deve ser `1883`, salvo mudança explícita no `docker-compose.yml`.
- `DEVICE_ID` deve identificar unicamente a ESP32.
- Nenhuma senha real deve ser versionada.

Exemplo correto para ESP32:

```cpp
#define MQTT_HOST "192.168.0.100"
```

Exemplo incorreto para ESP32:

```cpp
#define MQTT_HOST "nodered"
```

## 7.2 Configuração dos containers

Na raiz do monorepo, deve existir:

```text
.env.example
.env
```

O arquivo `.env.example` deve ser versionado. O arquivo `.env` real deve ser ignorado pelo Git.

Adicionar ao `.gitignore`:

```gitignore
.env
```

Exemplo mínimo de `.env.example`:

```env
POSTGRES_DB=rehab_game
POSTGRES_USER=rehab_user
POSTGRES_PASSWORD=rehab_password
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

DATABASE_URL=postgresql+asyncpg://rehab_user:rehab_password@postgres:5432/rehab_game

BACKEND_HOST=backend
BACKEND_PORT=8000

NODE_RED_PORT=1880
MQTT_PORT=1883
MQTT_HOST=nodered

FRONTEND_PORT=5173
```

Regras:

- O backend deve ler `DATABASE_URL` pelo ambiente.
- O Postgres deve ler `POSTGRES_DB`, `POSTGRES_USER` e `POSTGRES_PASSWORD` pelo ambiente.
- O Node-RED deve receber a URL interna do backend pelo ambiente.
- O frontend pode receber variáveis públicas apenas quando necessário, mas não deve integrar com backend neste ciclo.
- Containers devem se comunicar usando hostnames Docker, como `backend`, `postgres` e `nodered`.

Dentro da rede Docker, estas URLs são válidas:

```text
Node-RED -> http://backend:8000
Backend -> postgres:5432
```

Fora da rede Docker, estas URLs são usadas para acesso local:

```text
Navegador -> http://localhost:5173
Node-RED UI -> http://localhost:1880
Backend -> http://localhost:8000
ESP32 MQTT -> IP_LOCAL_DO_COMPUTADOR:1883
```

## 7.3 Configuração do Node-RED

O Node-RED deve receber pelo Docker as variáveis necessárias para chamar o backend.

Variável recomendada:

```env
BACKEND_URL=http://backend:8000
```

Os fluxos do Node-RED devem evitar URLs hardcoded quando possível.

Quando o nó HTTP não permitir interpolação direta, usar um Function node antes da requisição HTTP:

```js
msg.url = env.get("BACKEND_URL") + "/api/v1/ingest/batches/buttons";
return msg;
```

Para batches de pressão:

```js
msg.url = env.get("BACKEND_URL") + "/api/v1/ingest/batches/pressure";
return msg;
```

Regras:

- O `flows.json` deve ser portável entre máquinas.
- A URL do backend não deve ficar fixa como `localhost` dentro dos fluxos.
- Dentro do container Node-RED, `localhost` aponta para o próprio Node-RED, não para o backend.
- Usar `http://backend:8000` dentro da rede Docker.

## 7.4 Resumo das configurações

| Contexto | Arquivo | Versionado? | Observação |
|---|---|---|---|
| Firmware modelo | `firmware/esp32-rhythm-rehab/include/secrets.example.h` | Sim | Template sem segredos reais. |
| Firmware real | `firmware/esp32-rhythm-rehab/include/secrets.h` | Não | Contém Wi-Fi, IP MQTT e device id. |
| Docker modelo | `.env.example` | Sim | Template dos containers. |
| Docker real | `.env` | Não | Contém credenciais locais. |
| Node-RED | `nodered/flows.json` + env Docker | Sim | Deve usar `BACKEND_URL` sempre que possível. |

## 8. Docker Compose

## 8.1 Serviços obrigatórios

O `docker-compose.yml` deve conter:

1. `postgres`
2. `backend`
3. `nodered`
4. `frontend`

## 8.2 Portas esperadas

| Serviço | Porta interna | Porta externa sugerida |
|---|---:|---:|
| Postgres | 5432 | 5432 |
| Backend | 8000 | 8000 |
| Node-RED UI | 1880 | 1880 |
| MQTT Aedes | 1883 | 1883 |
| Frontend base | 5173 | 5173 |
| Realtime/WebSocket Node-RED | 1880 ou rota ws | 1880 ou rota ws |

## 8.3 Requisitos do Compose

- O backend deve depender do Postgres.
- O Node-RED deve conseguir chamar o backend pelo hostname Docker `backend`.
- O Postgres deve usar volume persistente.
- O Node-RED deve ter volume ou bind mount para manter `flows.json`.
- O frontend deve subir, mas não precisa consumir o backend neste ciclo.
- Todos os serviços devem estar na mesma network Docker.

## 8.4 Uso das variáveis no Compose

O `docker-compose.yml` deve carregar variáveis do `.env` e seguir o template definido no `.env.example`.

Exemplo esperado de uso:

```yaml
services:
  backend:
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      - postgres

  nodered:
    environment:
      BACKEND_URL: http://backend:8000
    ports:
      - "1880:1880"
      - "1883:1883"

  postgres:
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

O Codex deve corrigir qualquer uso incorreto de `localhost` entre containers.

## 9. Contrato MQTT

## 9.1 Regras gerais

- Todas as mensagens publicadas pela ESP32 devem ser JSON válido.
- Todas as mensagens devem conter `device_id`.
- Mensagens associadas a uma sessão devem conter `session_id`.
- Mensagens associadas a uma sessão devem conter `hand`.
- Mensagens associadas a uma sessão devem conter `mode`.
- `hand` deve aceitar somente `left` ou `right`.
- `mode` deve aceitar somente `buttons` ou `pressure`.
- `timestamp_ms` deve representar tempo relativo do dispositivo em milissegundos.
- O backend também deve salvar `received_at` com timestamp do servidor.
- Inputs usados pelo jogo em tempo real devem ser enviados individualmente.
- Batches devem ser usados apenas no fluxo de persistência.
- O backend deve persistir apenas os dados compatíveis com o `mode` cadastrado na sessão.
- Sessões com `mode = buttons` devem persistir dados de botões.
- Sessões com `mode = pressure` devem persistir dados de pressão.

## 9.2 Tópicos de tempo real para o frontend

```text
rehab/devices/{device_id}/realtime/buttons
rehab/devices/{device_id}/realtime/pressure
rehab/devices/{device_id}/realtime/session
```

Esses tópicos devem ser recebidos pelo Node-RED e encaminhados ao frontend por WebSocket ou mecanismo realtime equivalente.

## 9.3 Tópicos batch para backend

```text
rehab/devices/{device_id}/batch/buttons
rehab/devices/{device_id}/batch/pressure
```

Esses tópicos devem ser recebidos pelo Node-RED e encaminhados ao backend por HTTP REST.

## 9.4 Tópicos opcionais de comando

```text
rehab/devices/{device_id}/commands/start_session
rehab/devices/{device_id}/commands/end_session
rehab/devices/{device_id}/commands/calibrate
rehab/devices/{device_id}/commands/tare
rehab/devices/{device_id}/commands/ping
```

## 9.5 Payload realtime — Botão

Tópico:

```text
rehab/devices/{device_id}/realtime/buttons
```

Payload:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "left",
  "mode": "buttons",
  "button_id": 1,
  "event_type": "pressed",
  "timestamp_ms": 123456
}
```

Regras:

- Envio individual.
- Usado pelo jogo em tempo real.
- Não esperar resposta do backend para atualizar o jogo.

## 9.6 Payload realtime — Pressão

Tópico:

```text
rehab/devices/{device_id}/realtime/pressure
```

Payload:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "pressure",
  "pressure_raw": 84532,
  "pressure_kpa": null,
  "timestamp_ms": 123456
}
```

Regras:

- Envio individual.
- Usado pelo jogo em tempo real.
- `pressure_kpa` é opcional.

## 9.7 Payload batch — Botões

Tópico:

```text
rehab/devices/{device_id}/batch/buttons
```

Payload:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "left",
  "mode": "buttons",
  "batch_id": "buttons-batch-001",
  "strategy": "ring_buffer",
  "sequence_start": 1,
  "sequence_end": 20,
  "created_at_ms": 123900,
  "performance": {
    "insert_latency_us_avg": 8,
    "insert_latency_us_max": 15,
    "mqtt_publish_latency_us": 1200,
    "free_heap_bytes": 185320,
    "min_free_heap_bytes": 184900,
    "buffer_capacity": 64,
    "buffer_used": 20,
    "dropped_samples": 0
  },
  "events": [
    {
      "button_id": 1,
      "event_type": "pressed",
      "timestamp_ms": 123456,
      "sequence": 1
    },
    {
      "button_id": 2,
      "event_type": "pressed",
      "timestamp_ms": 123700,
      "sequence": 2
    }
  ]
}
```

## 9.8 Payload batch — Pressão

Tópico:

```text
rehab/devices/{device_id}/batch/pressure
```

Payload:

```json
{
  "device_id": "esp32-001",
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "right",
  "mode": "pressure",
  "batch_id": "pressure-batch-001",
  "strategy": "ring_buffer",
  "sequence_start": 1,
  "sequence_end": 20,
  "created_at_ms": 123900,
  "performance": {
    "insert_latency_us_avg": 7,
    "insert_latency_us_max": 13,
    "mqtt_publish_latency_us": 1500,
    "free_heap_bytes": 185100,
    "min_free_heap_bytes": 184700,
    "buffer_capacity": 64,
    "buffer_used": 20,
    "dropped_samples": 0
  },
  "samples": [
    {
      "pressure_raw": 84532,
      "pressure_kpa": null,
      "timestamp_ms": 123456,
      "sequence": 1
    },
    {
      "pressure_raw": 84610,
      "pressure_kpa": null,
      "timestamp_ms": 123500,
      "sequence": 2
    }
  ]
}
```

## 10. Node-RED

## 11.1 Objetivo

O Node-RED deve atuar como camada de integração entre:

1. MQTT e frontend em tempo real.
2. MQTT e backend para persistência batch.

Ele deve:

- Rodar o broker Aedes internamente.
- Receber mensagens MQTT da ESP32.
- Encaminhar mensagens realtime ao frontend.
- Encaminhar batches ao backend.
- Manter `flows.json` versionado.

## 10.2 Dependência obrigatória

O Node-RED deve usar Aedes dentro do próprio Node-RED.

Adicionar a dependência necessária em `nodered/package.json`, por exemplo:

```json
{
  "dependencies": {
    "node-red-contrib-aedes": "latest"
  }
}
```

## 10.3 Fluxos mínimos esperados

### Fluxo 1 — Realtime buttons

```text
Aedes Broker
  -> MQTT In: rehab/devices/+/realtime/buttons
  -> JSON parser
  -> Function: normalize_realtime_button
  -> WebSocket Out ou endpoint realtime para frontend
  -> Debug
```

### Fluxo 2 — Realtime pressure

```text
Aedes Broker
  -> MQTT In: rehab/devices/+/realtime/pressure
  -> JSON parser
  -> Function: normalize_realtime_pressure
  -> WebSocket Out ou endpoint realtime para frontend
  -> Debug
```

### Fluxo 3 — Batch buttons

```text
Aedes Broker
  -> MQTT In: rehab/devices/+/batch/buttons
  -> JSON parser
  -> Function: normalize_button_batch
  -> HTTP POST: http://backend:8000/api/v1/ingest/batches/buttons
  -> Debug
```

### Fluxo 4 — Batch pressure

```text
Aedes Broker
  -> MQTT In: rehab/devices/+/batch/pressure
  -> JSON parser
  -> Function: normalize_pressure_batch
  -> HTTP POST: http://backend:8000/api/v1/ingest/batches/pressure
  -> Debug
```

## 10.4 Regras de normalização no Node-RED

Cada função de normalização deve:

- Garantir que `msg.payload` seja objeto JSON.
- Preservar `device_id`.
- Preservar `session_id`.
- Preservar `user_id`, quando presente.
- Preservar `hand`.
- Preservar `mode`.
- Adicionar `source_topic` com o tópico MQTT original.
- Encaminhar payload inválido para debug de erro, sem derrubar o fluxo.

## 11. Backend FastAPI

## 10.1 Objetivo

O backend deve ser uma API de ingestão batch e consulta histórica. Ele não controla o jogo em tempo real.

Responsabilidades:

- Receber batches do Node-RED.
- Validar payloads.
- Persistir dados no Postgres.
- Criar e consultar usuários.
- Criar e consultar sessões.
- Relacionar cada sessão a um usuário.
- Permitir diferenciação entre mão direita e mão esquerda.
- Permitir diferenciação entre modo de botões e modo de pressão.
- Persistir somente os dados compatíveis com o modo da sessão.
- Persistir metadados de batch e desempenho do buffer.
- Disponibilizar métricas básicas por sessão e por usuário.

Não implementar:

- Gameplay.
- WebSocket do jogo.
- Comunicação realtime com frontend.
- Autenticação.
- Regras clínicas avançadas.

## 11.2 Endpoints obrigatórios

### Healthcheck

```http
GET /health
```

Resposta:

```json
{
  "status": "ok"
}
```

### Usuários

```http
POST /api/v1/users
GET /api/v1/users
GET /api/v1/users/{user_id}
```

Payload para criar usuário:

```json
{
  "name": "Maria Silva",
  "age": 32,
  "sex": "female"
}
```

Regras:

- `name` é obrigatório.
- `age` é obrigatório por agora.
- `sex` é obrigatório por agora.
- Valores sugeridos para `sex`: `female`, `male`, `other`, `not_informed`.

### Sessões de jogo

```http
POST /api/v1/game-sessions
GET /api/v1/game-sessions
GET /api/v1/game-sessions/{session_id}
PATCH /api/v1/game-sessions/{session_id}/finish
```

Payload para criar sessão:

```json
{
  "user_id": "uuid-do-usuario",
  "device_id": "esp32-001",
  "hand": "right",
  "mode": "buttons",
  "duration_seconds": 60,
  "notes": "Sessão de teste"
}
```

Resposta esperada:

```json
{
  "id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "device_id": "esp32-001",
  "hand": "right",
  "mode": "buttons",
  "duration_seconds": 60,
  "status": "created",
  "started_at": "2026-05-28T12:00:00Z",
  "scheduled_finish_at": "2026-05-28T12:01:00Z",
  "finished_at": null
}
```

Regras:

- `user_id` é obrigatório.
- `user_id` deve referenciar um usuário existente.
- `hand` é obrigatório.
- `hand` aceita somente `left` ou `right`.
- `mode` é obrigatório.
- `mode` aceita somente `buttons` ou `pressure` neste MVP.
- Toda sessão de jogo deve ter tempo definido.
- `duration_seconds` é obrigatório e deve ser maior que zero.
- A sessão define quais dados podem ser persistidos.
- Sessões `buttons` persistem apenas batches de botões.
- Sessões `pressure` persistem apenas batches de pressão.

### Ingestão batch — Botões

```http
POST /api/v1/ingest/batches/buttons
```

Comportamento:

- Validar JSON.
- Validar `session_id`.
- Validar `user_id`, se enviado.
- Validar `device_id`.
- Validar `hand`.
- Validar se a sessão possui `mode = buttons`.
- Persistir registro do batch.
- Persistir eventos do batch em `button_events`.
- Persistir metadados de desempenho do batch.
- Se a sessão for `mode = pressure`, não persistir os eventos e retornar resposta controlada.

Resposta sugerida para sucesso:

```json
{
  "persisted": true,
  "batch_id": "buttons-batch-001",
  "events_count": 20
}
```

Resposta sugerida para modo incompatível:

```json
{
  "persisted": false,
  "reason": "session_mode_does_not_accept_button_batches"
}
```

### Ingestão batch — Pressão

```http
POST /api/v1/ingest/batches/pressure
```

Comportamento:

- Validar JSON.
- Validar `session_id`.
- Validar `user_id`, se enviado.
- Validar `device_id`.
- Validar `hand`.
- Validar se a sessão possui `mode = pressure`.
- Persistir registro do batch.
- Persistir leituras do batch em `pressure_readings`.
- Persistir metadados de desempenho do batch.
- Se a sessão for `mode = buttons`, não persistir as leituras e retornar resposta controlada.

Resposta sugerida para sucesso:

```json
{
  "persisted": true,
  "batch_id": "pressure-batch-001",
  "samples_count": 20
}
```

Resposta sugerida para modo incompatível:

```json
{
  "persisted": false,
  "reason": "session_mode_does_not_accept_pressure_batches"
}
```

### Métricas por sessão

```http
GET /api/v1/metrics/sessions/{session_id}/summary
```

Resposta mínima esperada para sessão de botões:

```json
{
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "device_id": "esp32-001",
  "hand": "right",
  "mode": "buttons",
  "duration_seconds": 60,
  "status": "finished",
  "button_events_count": 120,
  "pressure_readings_count": 0,
  "batches_count": 6,
  "dropped_samples": 0,
  "avg_insert_latency_us": 8.2,
  "max_insert_latency_us": 15,
  "started_at": "2026-05-28T12:00:00Z",
  "finished_at": "2026-05-28T12:01:00Z"
}
```

Resposta mínima esperada para sessão de pressão:

```json
{
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "device_id": "esp32-001",
  "hand": "left",
  "mode": "pressure",
  "duration_seconds": 60,
  "status": "finished",
  "button_events_count": 0,
  "pressure_readings_count": 300,
  "avg_pressure_raw": 84200.5,
  "max_pressure_raw": 89120,
  "avg_pressure_kpa": null,
  "max_pressure_kpa": null,
  "batches_count": 15,
  "dropped_samples": 0,
  "avg_insert_latency_us": 7.4,
  "max_insert_latency_us": 13,
  "started_at": "2026-05-28T12:00:00Z",
  "finished_at": "2026-05-28T12:01:00Z"
}
```

### Métricas por usuário

```http
GET /api/v1/metrics/users/{user_id}/summary
```

Resposta mínima esperada:

```json
{
  "user_id": "uuid-do-usuario",
  "name": "Maria Silva",
  "sessions_count": 8,
  "buttons_sessions_count": 5,
  "pressure_sessions_count": 3,
  "right_hand_sessions_count": 4,
  "left_hand_sessions_count": 4,
  "avg_session_duration_seconds": 60,
  "total_button_events": 600,
  "total_pressure_readings": 900,
  "avg_pressure_raw": 84120.3,
  "max_pressure_raw": 90200
}
```

## 12. Banco de Dados

## 12.1 Requisitos gerais

- Usar Postgres.
- Usar migrations com Alembic.
- Usar UUID como chave primária preferencial.
- Usar timestamps de criação.
- Salvar `received_at` em batches vindos do Node-RED.
- Não depender apenas do timestamp da ESP32.
- Cada sessão de jogo deve estar vinculada a um usuário.

## 12.2 Tabelas obrigatórias

### `users`

Dados pessoais mínimos do usuário/paciente.

Campos mínimos:

```text
id UUID PK
name VARCHAR NOT NULL
age INTEGER NOT NULL
sex ENUM('female', 'male', 'other', 'not_informed') NOT NULL
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
```

### `devices`

Representa uma ESP32 cadastrada ou detectada.

Campos mínimos:

```text
id UUID PK
device_id VARCHAR UNIQUE NOT NULL
firmware_version VARCHAR NULL
last_status VARCHAR NULL
wifi_rssi INTEGER NULL
last_seen_at TIMESTAMP NULL
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
```

### `game_sessions`

Representa uma execução do jogo.

Campos mínimos:

```text
id UUID PK
user_id UUID FK users(id) NOT NULL
device_id VARCHAR/FK devices(device_id) NOT NULL
hand ENUM('left', 'right') NOT NULL
mode ENUM('buttons', 'pressure') NOT NULL
duration_seconds INTEGER NOT NULL
status ENUM('created', 'running', 'finished', 'cancelled', 'error') NOT NULL
started_at TIMESTAMP NOT NULL
scheduled_finish_at TIMESTAMP NULL
finished_at TIMESTAMP NULL
notes TEXT NULL
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
```

### `telemetry_batches`

Representa cada batch recebido para persistência.

Campos mínimos:

```text
id UUID PK
batch_id VARCHAR NOT NULL
session_id UUID FK game_sessions(id) NOT NULL
user_id UUID FK users(id) NOT NULL
device_id VARCHAR/FK devices(device_id) NOT NULL
hand ENUM('left', 'right') NOT NULL
mode ENUM('buttons', 'pressure') NOT NULL
strategy VARCHAR NOT NULL
sequence_start BIGINT NULL
sequence_end BIGINT NULL
created_at_ms BIGINT NULL
source_topic VARCHAR NULL
received_at TIMESTAMP NOT NULL
created_at TIMESTAMP NOT NULL
```

### `batch_performance_metadata`

Metadados necessários para cumprir a análise de eficiência do projeto auxiliar.

Campos mínimos:

```text
id UUID PK
batch_id UUID FK telemetry_batches(id) NOT NULL
insert_latency_us_avg NUMERIC NULL
insert_latency_us_max INTEGER NULL
mqtt_publish_latency_us INTEGER NULL
free_heap_bytes INTEGER NULL
min_free_heap_bytes INTEGER NULL
buffer_capacity INTEGER NULL
buffer_used INTEGER NULL
dropped_samples INTEGER NULL
created_at TIMESTAMP NOT NULL
```

### `button_events`

Representa eventos dos quatro botões, persistidos a partir de batches.

Campos mínimos:

```text
id UUID PK
batch_id UUID FK telemetry_batches(id) NOT NULL
session_id UUID FK game_sessions(id) NOT NULL
user_id UUID FK users(id) NOT NULL
device_id VARCHAR/FK devices(device_id) NOT NULL
hand ENUM('left', 'right') NOT NULL
button_id INTEGER NOT NULL
event_type ENUM('pressed', 'released') NOT NULL
timestamp_ms BIGINT NOT NULL
sequence BIGINT NULL
created_at TIMESTAMP NOT NULL
```

### `pressure_readings`

Representa leituras do HX710B, persistidas a partir de batches.

Campos mínimos:

```text
id UUID PK
batch_id UUID FK telemetry_batches(id) NOT NULL
session_id UUID FK game_sessions(id) NOT NULL
user_id UUID FK users(id) NOT NULL
device_id VARCHAR/FK devices(device_id) NOT NULL
hand ENUM('left', 'right') NOT NULL
pressure_raw INTEGER NOT NULL
pressure_kpa NUMERIC NULL
timestamp_ms BIGINT NOT NULL
sequence BIGINT NULL
created_at TIMESTAMP NOT NULL
```

## 12.3 Regras de integridade

- `game_sessions.user_id` deve referenciar `users.id`.
- Toda sessão deve ter usuário.
- Toda sessão deve ter mão.
- Toda sessão deve ter modo.
- Toda sessão deve ter duração definida.
- `hand` do batch deve bater com `hand` da sessão.
- `mode` do batch deve bater com `mode` da sessão.
- Se `mode = buttons`, persistir apenas batches de botões e eventos em `button_events`.
- Se `mode = pressure`, persistir apenas batches de pressão e leituras em `pressure_readings`.
- Não persistir dados incompatíveis com o modo da sessão.
- `button_id` deve estar entre 1 e 4.
- `session_id` deve existir para qualquer batch persistido.
- `device_id` deve existir ou ser criado automaticamente no status do dispositivo.
- Pressão em kPa é opcional.
- Pressão bruta é obrigatória.

## 13. Firmware ESP32

## 13.1 Tecnologia obrigatória

- PlatformIO.
- Arduino Framework.
- FreeRTOS.
- MQTT.
- Wi-Fi.
- HX710B.

## 13.2 Obrigatoriedade de PlatformIO

O firmware deve ser um projeto PlatformIO válido.

Obrigatório:

- `platformio.ini` configurado.
- Código em estrutura compatível com PlatformIO.
- Uso dos comandos/métodos do PlatformIO para build, upload e monitor:

```bash
pio run
pio run --target upload
pio device monitor
```

O projeto deve compilar usando PlatformIO. Não entregar apenas sketch `.ino` solto.

## 13.3 Requisitos de FreeRTOS

O firmware deve usar explicitamente:

- Tasks.
- Queues.
- Interrupções.
- Semáforo, mutex ou event group.

## 13.4 Tasks recomendadas

| Task | Responsabilidade |
|---|---|
| `wifi_task` | Conectar e reconectar ao Wi-Fi. |
| `mqtt_task` | Conectar ao broker, publicar mensagens e processar comandos. |
| `pressure_task` | Ler o HX710B periodicamente. |
| `button_task` | Consumir eventos de botão vindos das interrupções. |
| `realtime_publish_task` | Publicar eventos individuais para o frontend. |
| `batch_publish_task` | Consumir Ring Buffer e publicar batches para persistência. |
| `profiling_task` | Medir latência, heap e estatísticas de buffer. |

## 13.5 Filas e buffers

| Estrutura | Produtor | Consumidor | Uso |
|---|---|---|---|
| `button_event_queue` | ISR dos botões | `button_task` | Entrada rápida de botões. |
| `pressure_queue` | `pressure_task` | `realtime_publish_task` | Entrada rápida de pressão. |
| `mqtt_publish_queue` | tasks internas | `mqtt_task` | Publicação MQTT. |
| `button_ring_buffer` | `button_task` | `batch_publish_task` | Batch de botões para persistência. |
| `pressure_ring_buffer` | `pressure_task` | `batch_publish_task` | Batch de pressão para persistência. |

## 13.6 Fluxo interno do firmware

Para cada input do jogador, o firmware deve fazer duas coisas:

1. Enviar evento individual ao fluxo realtime.
2. Copiar o dado para o buffer de batch correspondente.

Exemplo para botão:

```text
ISR botão
  -> button_event_queue
  -> button_task
      -> mqtt_publish_queue realtime
      -> button_ring_buffer batch
```

Exemplo para pressão:

```text
pressure_task
  -> pressure_queue
  -> realtime_publish_task
      -> mqtt_publish_queue realtime
  -> pressure_ring_buffer batch
```

## 13.7 Interrupções dos botões

Cada botão deve:

- Ter pino configurado.
- Usar `attachInterrupt`.
- Gerar evento mínimo com:
  - `button_id`.
  - `event_type`.
  - `timestamp_ms`.
- Enviar evento para `button_event_queue` usando função segura para ISR.
- Ter debounce por software.

## 13.8 Sensor HX710B

O firmware deve:

- Ler valor bruto do HX710B.
- Publicar `pressure_raw`.
- Publicar `pressure_kpa` apenas se houver calibração implementada.
- Permitir função de tara/calibração básica, mesmo que simples.
- Não bloquear indefinidamente a execução se o sensor falhar.

## 13.9 Buffer Circular e comparação acadêmica

Para cumprir o projeto auxiliar, o firmware deve conter:

### Estratégia eficiente

- Classe ou estrutura de Ring Buffer.
- Índices `head` e `tail`.
- Inserção O(1).
- Remoção O(1).
- Capacidade fixa.
- Contador de drops quando o buffer estiver cheio.

### Estratégia ineficiente

- Implementação comparativa usando deslocamento de elementos, realocação ou estrutura dinâmica que represente o anti-padrão.
- Essa estratégia deve existir para teste/comparação, mas não precisa ser usada como padrão em produção.

### Instrumentação

Medir, no firmware:

- Latência de inserção no buffer.
- Latência de envio MQTT do batch.
- Heap livre.
- Menor heap livre observado.
- Uso do buffer.
- Quantidade de drops.

Esses dados devem ser enviados como `performance` dentro do payload de batch.

## 13.10 Sessão, usuário, mão, modo e duração

A seleção do usuário, da mão, do modo de jogo e da duração da partida será feita futuramente na tela do jogo. Essa tela enviará ao backend:

- `user_id`.
- `hand`: `left` ou `right`.
- `mode`: `buttons` ou `pressure`.
- `duration_seconds`: duração definida da sessão.

Como a integração completa do jogo ainda não será implementada, o firmware pode trabalhar de duas formas no MVP:

### Opção A — Configuração fixa para testes

Definir em arquivo de configuração:

```cpp
const char* CURRENT_SESSION_ID = "00000000-0000-0000-0000-000000000000";
const char* CURRENT_USER_ID = "00000000-0000-0000-0000-000000000000";
const char* CURRENT_HAND = "right";
const char* CURRENT_MODE = "buttons";
const int CURRENT_DURATION_SECONDS = 60;
```

### Opção B — Receber comando MQTT

Receber comando em:

```text
rehab/devices/{device_id}/commands/start_session
```

Com payload:

```json
{
  "session_id": "uuid-da-sessao",
  "user_id": "uuid-do-usuario",
  "hand": "left",
  "mode": "buttons",
  "duration_seconds": 60
}
```

Para o MVP, a opção A é aceitável se estiver documentada. A opção B é melhor, mas não deve atrasar a entrega.

## 13.11 Regras de publicação no firmware

O firmware deve publicar:

1. Status do dispositivo.
2. Inputs individuais em tempo real.
3. Batches de persistência.
4. Evento de início/fim de sessão ou heartbeat.

Regras:

- Eventos de gameplay para o frontend são individuais.
- Dados para persistência histórica são enviados em batch.
- O batch deve ser produzido no firmware.
- Ao fim do tempo definido da sessão, o firmware deve tentar enviar o batch restante.

## 13.12 Pinos

Centralizar os pinos em `pins.h` ou arquivo equivalente.

Exemplo inicial, ajustar conforme circuito real:

```cpp
#define HX710B_DOUT_PIN  32
#define HX710B_SCK_PIN   33
#define BUTTON_1_PIN     25
#define BUTTON_2_PIN     26
#define BUTTON_3_PIN     27
#define BUTTON_4_PIN     14
#define STATUS_LED_PIN    2
```

## 14. Frontend Base

## 14.1 Objetivo

Criar apenas o esqueleto do frontend, preparado para futura tela de jogo e dashboard.

## 14.2 Requisitos

- React.
- Tailwind.
- Vite, se adequado.
- Dockerfile.
- Serviço no `docker-compose`.
- Página inicial simples informando que o frontend ainda está em desenvolvimento.
- Estrutura preparada para futura conexão realtime com Node-RED.

## 14.3 Proibido neste ciclo

- Não criar jogo completo.
- Não criar dashboard completa.
- Não consumir métricas históricas ainda.
- Não criar autenticação.

## 15. README

O README deve conter:

1. Descrição curta do projeto.
2. Arquitetura resumida com os dois fluxos.
3. Tecnologias usadas.
4. Como configurar `.env` a partir de `.env.example`.
5. Como configurar `secrets.h` a partir de `secrets.example.h`.
6. Como descobrir o IP LAN do computador para usar como `MQTT_HOST` na ESP32.
7. Como rodar com Docker Compose.
8. Como acessar:
   - Backend: `http://localhost:8000/health`
   - Node-RED: `http://localhost:1880`
   - MQTT: `localhost:1883`
   - Frontend: `http://localhost:5173`
9. Como importar ou validar o `flows.json`.
10. Como compilar o firmware com PlatformIO.
11. Como usar comandos PlatformIO:
   - `pio run`
   - `pio run --target upload`
   - `pio device monitor`
12. Exemplo de payload MQTT realtime.
13. Exemplo de payload MQTT batch.
14. Endpoints principais do backend.
15. Limitações do MVP.
16. Explicação da integração com Buffer Circular.

## 16. Critérios de aceite finais

O MVP será aceito se todos os itens abaixo forem verdadeiros.

### Infraestrutura

- `docker compose up --build` sobe Postgres, backend, Node-RED e frontend base.
- Backend responde `GET /health`.
- Node-RED abre em `http://localhost:1880`.
- Aedes aceita conexão MQTT em `localhost:1883`.
- Frontend base abre em `http://localhost:5173`.

### Node-RED

- `nodered/flows.json` existe.
- O fluxo é importável.
- Aedes roda dentro do Node-RED.
- O fluxo recebe mensagens MQTT realtime.
- O fluxo encaminha mensagens realtime ao frontend.
- O fluxo recebe mensagens MQTT batch.
- O fluxo encaminha batches ao backend.
- O fluxo possui nós de debug.

### Backend

- FastAPI inicia sem erro.
- Conecta ao Postgres.
- Migrations funcionam.
- Cria usuário.
- Consulta usuário.
- Cria sessão vinculada a usuário.
- Cria sessão com `hand = left`.
- Cria sessão com `hand = right`.
- Cria sessão com `mode = buttons`.
- Cria sessão com `mode = pressure`.
- Toda sessão possui `duration_seconds`.
- Recebe batch de botões.
- Recebe batch de pressão.
- Persiste batch compatível com o modo da sessão.
- Não persiste batch incompatível com o modo da sessão.
- Retorna resumo de métricas por sessão.
- Retorna resumo de métricas por usuário.

### Banco

- Tabela `users` existe.
- Tabela `game_sessions` possui FK para `users`.
- Tabelas de batches existem.
- Tabelas de eventos/leitura possuem FK para sessão e usuário.
- Sessões diferenciam mão direita e esquerda.
- Sessões diferenciam modo de botões e modo de pressão.
- Sessões possuem duração definida.

### Firmware

- Projeto PlatformIO compila.
- Usa Arduino Framework.
- Usa comandos e estrutura do PlatformIO.
- Está preparado para teste físico em ESP32 real.
- Usa FreeRTOS.
- Usa filas.
- Usa interrupções para botões.
- Usa semáforo, mutex ou event group.
- Lê os 4 botões físicos.
- Lê HX710B real.
- Publica eventos realtime via MQTT.
- Prepara batches no firmware.
- Publica batches via MQTT.
- Implementa Ring Buffer.
- Implementa estratégia ineficiente comparativa.
- Mede latência e heap.
- Envia metadados de desempenho no batch.
- Faz flush do batch restante ao fim da sessão.

### Frontend

- Projeto React + Tailwind existe.
- Dockerfile existe.
- Serviço sobe pelo Compose.
- Estrutura preparada para conexão realtime futura.
- Não há implementação desnecessária de dashboard completa neste ciclo.

## 17. Checklist de correção para codebase existente

Ao analisar o projeto atual, verificar:

### Estrutura

- [ ] Existe monorepo organizado por módulos?
- [ ] Existe `docker-compose.yml` na raiz?
- [ ] Existe `.env.example`?
- [ ] Existe README com instruções claras?
- [ ] Existe `.env.example` versionado?
- [ ] `.env` está no `.gitignore`?
- [ ] Existe pasta `dev-docs/`?
- [ ] Os PDFs de requisitos estão em `dev-docs/`?
- [ ] Este PRD está salvo em `dev-docs/PRD.md` ou arquivo equivalente?

### Backend

- [ ] Backend usa FastAPI?
- [ ] Existe endpoint `/health`?
- [ ] Existe conexão com Postgres?
- [ ] Existem migrations?
- [ ] Existe tabela/modelo de usuários?
- [ ] `game_sessions` possui `user_id` como FK?
- [ ] Existe validação de `hand`?
- [ ] Existe validação de `mode`?
- [ ] Toda sessão possui duração definida?
- [ ] Existem endpoints de ingestão batch?
- [ ] O backend persiste apenas dados compatíveis com o modo da sessão?
- [ ] Existem métricas por sessão?
- [ ] Existem métricas por usuário?

### Node-RED

- [ ] Existe pasta `nodered/`?
- [ ] Existe `flows.json`?
- [ ] Aedes está configurado dentro do Node-RED?
- [ ] Node-RED recebe `BACKEND_URL` por variável de ambiente?
- [ ] Os fluxos evitam `localhost` para chamar o backend?
- [ ] Os tópicos MQTT batem com este PRD?
- [ ] Existe fluxo realtime para frontend?
- [ ] Existe fluxo batch para backend?
- [ ] O fluxo batch encaminha para `http://backend:8000`?

### Firmware

- [ ] Existe projeto PlatformIO?
- [ ] Existe `platformio.ini`?
- [ ] Existe `include/secrets.example.h`?
- [ ] `include/secrets.h` está no `.gitignore`?
- [ ] `MQTT_HOST` do firmware é documentado como IP LAN do computador?
- [ ] Usa Arduino Framework?
- [ ] Usa comandos/estrutura PlatformIO?
- [ ] Está preparado para upload e teste em ESP32 real?
- [ ] Usa FreeRTOS?
- [ ] Usa filas?
- [ ] Usa interrupções?
- [ ] Usa mutex/semaphore/event group?
- [ ] Lê os 4 botões físicos?
- [ ] Lê HX710B real?
- [ ] Publica MQTT realtime?
- [ ] Prepara batch no firmware?
- [ ] Implementa Ring Buffer?
- [ ] Implementa estratégia ineficiente comparativa?
- [ ] Mede latência e heap?
- [ ] Os payloads batem com este PRD?

### Frontend

- [ ] Existe projeto React?
- [ ] Tailwind está configurado?
- [ ] Existe Dockerfile?
- [ ] Existe estrutura preparada para realtime futuro?
- [ ] Não há implementação desnecessária de dashboard/jogo completo neste ciclo?

## 18. Ordem recomendada de implementação pelo Codex

1. Auditar estrutura existente.
2. Corrigir `docker-compose.yml` e `.env.example`.
3. Garantir Postgres funcional.
4. Corrigir/criar backend FastAPI.
5. Criar modelos e migrations.
6. Criar tabela de usuários.
7. Adicionar FK de usuário em sessões.
8. Criar endpoints de usuários.
9. Criar endpoints de sessão.
10. Criar endpoints de ingestão batch.
11. Criar métricas por sessão.
12. Criar métricas por usuário.
13. Configurar Node-RED com Aedes.
14. Criar/corrigir fluxos realtime.
15. Criar/corrigir fluxos batch.
16. Garantir projeto frontend base.
17. Corrigir/criar firmware PlatformIO.
18. Garantir FreeRTOS, filas, interrupções e MQTT.
19. Implementar Ring Buffer.
20. Implementar estratégia ineficiente comparativa.
21. Adicionar instrumentação de latência e heap.
22. Documentar execução no README.
23. Testar fluxo realtime com payload MQTT manual.
24. Testar fluxo batch com payload MQTT manual.
25. Testar, se possível, com ESP32 real.

## 19. Testes manuais recomendados sem ESP32

O projeto deve permitir testar Node-RED e backend sem a ESP32 usando um cliente MQTT.

### Realtime button

```bash
mosquitto_pub -h localhost -p 1883 \
  -t "rehab/devices/esp32-001/realtime/buttons" \
  -m '{"device_id":"esp32-001","session_id":"uuid-da-sessao","user_id":"uuid-do-usuario","hand":"right","mode":"buttons","button_id":1,"event_type":"pressed","timestamp_ms":123456}'
```

### Realtime pressure

```bash
mosquitto_pub -h localhost -p 1883 \
  -t "rehab/devices/esp32-001/realtime/pressure" \
  -m '{"device_id":"esp32-001","session_id":"uuid-da-sessao","user_id":"uuid-do-usuario","hand":"left","mode":"pressure","pressure_raw":84532,"pressure_kpa":null,"timestamp_ms":123456}'
```

### Batch buttons

```bash
mosquitto_pub -h localhost -p 1883 \
  -t "rehab/devices/esp32-001/batch/buttons" \
  -m '{"device_id":"esp32-001","session_id":"uuid-da-sessao","user_id":"uuid-do-usuario","hand":"right","mode":"buttons","batch_id":"buttons-batch-001","strategy":"ring_buffer","sequence_start":1,"sequence_end":2,"created_at_ms":123900,"performance":{"insert_latency_us_avg":8,"insert_latency_us_max":15,"mqtt_publish_latency_us":1200,"free_heap_bytes":185320,"min_free_heap_bytes":184900,"buffer_capacity":64,"buffer_used":2,"dropped_samples":0},"events":[{"button_id":1,"event_type":"pressed","timestamp_ms":123456,"sequence":1},{"button_id":2,"event_type":"pressed","timestamp_ms":123700,"sequence":2}]}'
```

### Batch pressure

```bash
mosquitto_pub -h localhost -p 1883 \
  -t "rehab/devices/esp32-001/batch/pressure" \
  -m '{"device_id":"esp32-001","session_id":"uuid-da-sessao","user_id":"uuid-do-usuario","hand":"left","mode":"pressure","batch_id":"pressure-batch-001","strategy":"ring_buffer","sequence_start":1,"sequence_end":2,"created_at_ms":123900,"performance":{"insert_latency_us_avg":7,"insert_latency_us_max":13,"mqtt_publish_latency_us":1500,"free_heap_bytes":185100,"min_free_heap_bytes":184700,"buffer_capacity":64,"buffer_used":2,"dropped_samples":0},"samples":[{"pressure_raw":84532,"pressure_kpa":null,"timestamp_ms":123456,"sequence":1},{"pressure_raw":84610,"pressure_kpa":null,"timestamp_ms":123500,"sequence":2}]}'
```

## 20. Observações finais

- A implementação será validada com ESP32 real, 4 botões físicos e sensor HX710B.
- A pasta `dev-docs/` deve concentrar os PDFs de requisitos e este PRD para facilitar consulta pelo Codex e pela equipe.
- O jogo será implementado futuramente no frontend.
- O frontend futuramente definirá usuário, modo de jogo, mão utilizada e duração da sessão.
- O frontend futuramente enviará `user_id`, `mode`, `hand` e `duration_seconds` ao backend na criação da sessão.
- O frontend receberá inputs em tempo real por Node-RED/WebSocket ou mecanismo equivalente.
- O backend não deve ficar no caminho crítico do input do jogador.
- O backend deve persistir dados históricos recebidos em batch.
- A dashboard futura consultará o backend para métricas históricas.
- O batch deve ser produzido no firmware, não no backend.
- O Ring Buffer deve ser a estratégia eficiente oficial.
- A estratégia ineficiente deve existir para comparação acadêmica.
- Não adicionar complexidade clínica ou gameplay completo neste momento.

