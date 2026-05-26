# Estrutura do Repositório

├── README.md # Descrição do projeto, requisitos, instruções.
├── /docs # Relatório em PDF (MNR - ABNT2) + imagens.
├── /applications # Códigos Backend + Frontend + Outros.
├── /esp32-esp8266 # Firmware dos módulos (FreeRTOS).
└── /schematics # Diagramas eletrônicos (Tinkercad, Fritzing, Wokwi,
KiCad ou outra ferramenta de prototipação).

## Firmware ESP32

O firmware principal está em `esp32-esp8266/hand-rehab`. Ele usa PlatformIO com
Arduino ESP32, FreeRTOS, interrupções nos botões, MQTT para comunicação com o
Node-RED e HX710B para leitura do sensor de pressão MPS20N0040D.

### Funções

- **Modo 1:** lê quatro botões por interrupção e publica os eventos no MQTT.
- **Modo 2:** lê o sensor de pressão barométrico MPS20N0040D pelo HX710B e publica
  amostras periódicas no MQTT.

### Pinos configurados

- Botão 1: GPIO 18
- Botão 2: GPIO 19
- Botão 3: GPIO 21
- Botão 4: GPIO 22
- HX710B OUT: GPIO 32
- HX710B SCK: GPIO 33

Os botões foram configurados com `INPUT_PULLUP`, então devem fechar contato com
GND quando pressionados. Ajuste os pinos em `src/main.cpp` se o circuito usar
outra pinagem.

### Tópicos MQTT

- `hand-rehab/esp32/status`: estado online/offline do ESP32.
- `hand-rehab/esp32/mode/set`: tópico de comando para alternar o modo.
- `hand-rehab/esp32/mode/state`: modo atual publicado com retain.
- `hand-rehab/esp32/buttons`: eventos dos quatro botões no modo 1.
- `hand-rehab/esp32/pressure`: leitura do sensor de pressão no modo 2.

Para trocar de modo pelo Node-RED, publique `1` ou `buttons` no tópico
`hand-rehab/esp32/mode/set` para o modo de botões, e `2` ou `pressure` para o
modo de pressão.

Antes de gravar no ESP32, configure o arquivo `.env` na raiz do repositório.
Existe um `.env.example` com o formato esperado:

```env
WIFI_SSID=SUA_REDE_WIFI
WIFI_PASSWORD=SUA_SENHA_WIFI
MQTT_BROKER=192.168.0.10
MQTT_PORT=1883
MQTT_CLIENT_ID=esp32-hand-rehab
NODE_RED_MQTT_BROKER=127.0.0.1
NODE_RED_CLIENT_ID=node-red-hand-rehab
```

O PlatformIO carrega esse arquivo por meio de
`esp32-esp8266/hand-rehab/scripts/load_env.py` e passa os valores para o firmware
como macros de compilação. Assim, SSID, senha e IP do broker não ficam fixos no
`main.cpp`.

### Estrutura FreeRTOS no firmware

O `setup()` apenas inicializa o hardware e cria os recursos do FreeRTOS. Depois
disso, o processamento fica dividido em tarefas:

- `taskMqtt`: mantém Wi-Fi/MQTT conectado, assina comandos do Node-RED e roda
  `mqttClient.loop()`.
- `taskButtons`: recebe eventos vindos das interrupções dos botões por uma fila
  FreeRTOS e publica no MQTT quando o modo 1 está ativo.
- `taskPressure`: lê o MPS20N0040D pelo HX710B em intervalo fixo e publica no MQTT
  quando o modo 2 está ativo.

As interrupções dos botões não publicam MQTT diretamente. Elas apenas colocam um
`ButtonEvent` na fila `buttonQueue` usando `xQueueSendFromISR()`, que é o jeito
seguro de conversar entre ISR e tarefa no FreeRTOS.

### Como conectar com o Node-RED

1. Instale ou abra um broker MQTT. O mais comum é Mosquitto, usando porta `1883`.
2. Descubra o IP da máquina onde o broker está rodando. Esse IP deve ser colocado
   em `MQTT_BROKER` no `.env`.
3. No Node-RED, importe o fluxo em
   `applications/node-red/hand-rehab-flow.json`.
4. O nó chamado `Broker MQTT Local` usa variáveis de ambiente:
   - servidor: `${NODE_RED_MQTT_BROKER}`;
   - porta: `${MQTT_PORT}`;
   - client id: `${NODE_RED_CLIENT_ID}`.
5. Clique em **Deploy** no Node-RED.
6. Grave o ESP32 com o mesmo `.env` configurado.

Para iniciar o Node-RED carregando o `.env`, rode no terminal a partir da raiz do
repositório:

```bash
set -a
source .env
set +a
node-red
```

Se o Node-RED já estiver rodando como serviço, configure essas mesmas variáveis
no ambiente do serviço antes de iniciar o Node-RED.

Se você estiver usando o broker Aedes dentro do próprio Node-RED, deixe
`NODE_RED_MQTT_BROKER=127.0.0.1`. Já o `MQTT_BROKER` usado pelo ESP32 deve ser o
IP da máquina na rede Wi-Fi, por exemplo `192.168.0.10`.

Quando o ESP32 conectar, o Node-RED deve receber:

- `online` em `hand-rehab/esp32/status`;
- `1` ou `2` em `hand-rehab/esp32/mode/state`;
- JSON dos botões em `hand-rehab/esp32/buttons`, por exemplo
  `{"button":1,"pin":18,"pressed":1,"mode":1}`;
- JSON da pressão em `hand-rehab/esp32/pressure`, por exemplo
  `{"pressure":0.123,"pressure_kpa":0.123,"pressure_mmhg":0.92,"raw":12345,"net":1234,"timeouts":0,"mode":2}`.

No fluxo importado, a mensagem de pressão passa pelo nó
**Normalizar pressao HX710B** e sai separada nos debugs:

- **debug pressao completa**: objeto normalizado completo.
- **debug pressao kPa**: valor numérico em kPa.
- **debug pressao mmHg**: valor numérico em mmHg.
- **debug raw net timeouts**: valores brutos para calibração e diagnóstico.

No fluxo importado, use os nós de injeção:

- **Ativar modo 1 botoes**: envia `1` para o ESP32.
- **Ativar modo 2 pressao**: envia `2` para o ESP32.
