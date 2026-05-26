#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <limits.h>

#ifndef WIFI_SSID
#error "WIFI_SSID nao definido. Configure a variavel no arquivo .env."
#endif

#ifndef WIFI_PASSWORD
#error "WIFI_PASSWORD nao definido. Configure a variavel no arquivo .env."
#endif

#ifndef MQTT_BROKER
#error "MQTT_BROKER nao definido. Configure a variavel no arquivo .env."
#endif

#ifndef MQTT_PORT
#error "MQTT_PORT nao definido. Configure a variavel no arquivo .env."
#endif

#ifndef MQTT_CLIENT_ID
#error "MQTT_CLIENT_ID nao definido. Configure a variavel no arquivo .env."
#endif

static const char *APP_WIFI_SSID = WIFI_SSID;
static const char *APP_WIFI_PASSWORD = WIFI_PASSWORD;
static const char *APP_MQTT_BROKER = MQTT_BROKER;
static const uint16_t APP_MQTT_PORT = MQTT_PORT;
static const char *APP_MQTT_CLIENT_ID = MQTT_CLIENT_ID;

static const char *TOPIC_STATUS = "hand-rehab/esp32/status";
static const char *TOPIC_MODE_SET = "hand-rehab/esp32/mode/set";
static const char *TOPIC_MODE_STATE = "hand-rehab/esp32/mode/state";
static const char *TOPIC_BUTTONS = "hand-rehab/esp32/buttons";
static const char *TOPIC_PRESSURE = "hand-rehab/esp32/pressure";

// Modo 1: botoes. Modo 2: sensor de pressao MPS20N0040D com HX710B.
enum OperationMode : uint8_t {
  MODE_BUTTONS = 1,
  MODE_PRESSURE = 2,
};

static volatile OperationMode currentMode = MODE_BUTTONS;

// Pinos sugeridos para ESP32 DevKit. Evite GPIOs de boot ao adaptar o hardware.
static const uint8_t BUTTON_PINS[] = {18, 19, 21, 22};
static const uint8_t BUTTON_COUNT = sizeof(BUTTON_PINS) / sizeof(BUTTON_PINS[0]);
static const uint8_t HX710B_OUT_PIN = 32;
static const uint8_t HX710B_SCK_PIN = 33;

static const uint32_t BUTTON_DEBOUNCE_MS = 50;
static const uint32_t PRESSURE_SAMPLE_INTERVAL_MS = 500;
static const uint32_t MQTT_LOOP_INTERVAL_MS = 10;

static const uint32_t MQTT_TASK_STACK = 4096;
static const uint32_t BUTTON_TASK_STACK = 3072;
static const uint32_t PRESSURE_TASK_STACK = 3072;
static const UBaseType_t MQTT_TASK_PRIORITY = 3;
static const UBaseType_t BUTTON_TASK_PRIORITY = 2;
static const UBaseType_t PRESSURE_TASK_PRIORITY = 1;

// HX710B: 27 pulsos selecionam entrada diferencial em 40 Hz.
static const uint8_t PRESSURE_SAMPLE_COUNT = 3;
static const uint8_t HX710B_TOTAL_CLOCK_PULSES = 27;
static const uint32_t HX710B_READY_TIMEOUT_MS = 250;

// Calibracao inicial. Substitua pelo fator obtido com uma pressao conhecida.
static const float RAW_COUNTS_PER_KPA = 10000.0f;
static const float KPA_TO_MMHG = 7.50062f;

struct ButtonEvent {
  uint8_t index;
  uint8_t pin;
  uint32_t tick;
};

static QueueHandle_t buttonQueue;
static SemaphoreHandle_t mqttMutex;
static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);
static long pressureZeroOffset = 0;
static uint32_t pressureTimeoutCount = 0;

static void setupHardware();
static void setupFreeRtos();
static void setupPressureSensor();
static bool waitForHx710b(uint32_t timeoutMs);
static void resetHx710b();
static long readHx710bRaw();
static long readHx710bAverage(uint8_t sampleCount);
static bool tarePressureSensor();
static void connectWiFi();
static void connectMqtt();
static void publishMode();
static void publishButtonState(const ButtonEvent &event);
static void publishPressure(long raw, long netRaw, float pressureKpa, float pressureMmhg);
static void publishPressureTimeout();
static void mqttCallback(char *topic, byte *payload, unsigned int length);
static void taskMqtt(void *parameter);
static void taskButtons(void *parameter);
static void taskPressure(void *parameter);

void IRAM_ATTR button0Isr();
void IRAM_ATTR button1Isr();
void IRAM_ATTR button2Isr();
void IRAM_ATTR button3Isr();

static void IRAM_ATTR enqueueButtonFromIsr(uint8_t index) {
  if (buttonQueue == nullptr) {
    return;
  }

  ButtonEvent event = {
      index,
      BUTTON_PINS[index],
      xTaskGetTickCountFromISR(),
  };

  BaseType_t higherPriorityTaskWoken = pdFALSE;
  xQueueSendFromISR(buttonQueue, &event, &higherPriorityTaskWoken);
  if (higherPriorityTaskWoken == pdTRUE) {
    portYIELD_FROM_ISR();
  }
}

void IRAM_ATTR button0Isr() { enqueueButtonFromIsr(0); }
void IRAM_ATTR button1Isr() { enqueueButtonFromIsr(1); }
void IRAM_ATTR button2Isr() { enqueueButtonFromIsr(2); }
void IRAM_ATTR button3Isr() { enqueueButtonFromIsr(3); }

void setup() {
  Serial.begin(115200);

  setupHardware();
  setupFreeRtos();
}

void loop() {
  vTaskDelete(nullptr);
}

static void setupHardware() {
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }

  setupPressureSensor();
}

static void setupPressureSensor() {
  pinMode(HX710B_SCK_PIN, OUTPUT);
  digitalWrite(HX710B_SCK_PIN, LOW);
  pinMode(HX710B_OUT_PIN, INPUT);

  Serial.printf("HX710B OUT: GPIO %u | SCK: GPIO %u\n", HX710B_OUT_PIN, HX710B_SCK_PIN);
  resetHx710b();

  if (!waitForHx710b(5000)) {
    Serial.println("HX710B nao ficou pronto no boot. Leituras tentarao recuperar no loop.");
    return;
  }

  tarePressureSensor();
}

static bool waitForHx710b(uint32_t timeoutMs) {
  const uint32_t startedAt = millis();

  while (digitalRead(HX710B_OUT_PIN) == HIGH) {
    if (millis() - startedAt >= timeoutMs) {
      return false;
    }
    delay(1);
  }

  return true;
}

static void resetHx710b() {
  digitalWrite(HX710B_SCK_PIN, HIGH);
  delayMicroseconds(80);
  digitalWrite(HX710B_SCK_PIN, LOW);
  delay(120);
}

static long readHx710bRaw() {
  uint32_t value = 0;

  if (!waitForHx710b(HX710B_READY_TIMEOUT_MS)) {
    return LONG_MIN;
  }

  noInterrupts();
  for (uint8_t i = 0; i < 24; i++) {
    digitalWrite(HX710B_SCK_PIN, HIGH);
    delayMicroseconds(1);
    value = (value << 1) | digitalRead(HX710B_OUT_PIN);
    digitalWrite(HX710B_SCK_PIN, LOW);
    delayMicroseconds(1);
  }

  for (uint8_t i = 24; i < HX710B_TOTAL_CLOCK_PULSES; i++) {
    digitalWrite(HX710B_SCK_PIN, HIGH);
    delayMicroseconds(1);
    digitalWrite(HX710B_SCK_PIN, LOW);
    delayMicroseconds(1);
  }
  interrupts();

  if (value & 0x800000UL) {
    value |= 0xFF000000UL;
  }

  return static_cast<int32_t>(value);
}

static long readHx710bAverage(uint8_t sampleCount) {
  int64_t sum = 0;

  for (uint8_t i = 0; i < sampleCount; i++) {
    const long raw = readHx710bRaw();
    if (raw == LONG_MIN) {
      return LONG_MIN;
    }
    sum += raw;
  }

  return static_cast<long>(sum / sampleCount);
}

static bool tarePressureSensor() {
  Serial.println("Fazendo tara do HX710B. Deixe o sensor sem pressao aplicada.");

  const long offset = readHx710bAverage(20);
  if (offset == LONG_MIN) {
    Serial.println("Falha na tara do HX710B. Usando offset zero.");
    pressureZeroOffset = 0;
    return false;
  }

  pressureZeroOffset = offset;
  Serial.print("Offset zero HX710B: ");
  Serial.println(pressureZeroOffset);
  return true;
}

static void setupFreeRtos() {
  buttonQueue = xQueueCreate(16, sizeof(ButtonEvent));
  mqttMutex = xSemaphoreCreateRecursiveMutex();

  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[0]), button0Isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[1]), button1Isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[2]), button2Isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[3]), button3Isr, CHANGE);

  connectWiFi();
  mqttClient.setServer(APP_MQTT_BROKER, APP_MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  xTaskCreatePinnedToCore(taskMqtt, "mqtt", MQTT_TASK_STACK, nullptr, MQTT_TASK_PRIORITY, nullptr, 0);
  xTaskCreatePinnedToCore(taskButtons, "buttons", BUTTON_TASK_STACK, nullptr, BUTTON_TASK_PRIORITY, nullptr, 1);
  xTaskCreatePinnedToCore(taskPressure, "pressure", PRESSURE_TASK_STACK, nullptr, PRESSURE_TASK_PRIORITY, nullptr, 1);
}

static void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(APP_WIFI_SSID, APP_WIFI_PASSWORD);

  Serial.print("Conectando ao Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }

  Serial.print("\nWi-Fi conectado. IP: ");
  Serial.println(WiFi.localIP());
}

static void connectMqtt() {
  while (!mqttClient.connected()) {
    Serial.print("Conectando ao MQTT...");
    if (mqttClient.connect(APP_MQTT_CLIENT_ID, TOPIC_STATUS, 1, true, "offline")) {
      Serial.println("conectado");
      mqttClient.publish(TOPIC_STATUS, "online", true);
      mqttClient.subscribe(TOPIC_MODE_SET);
      publishMode();
    } else {
      Serial.print("falhou, rc=");
      Serial.println(mqttClient.state());
      vTaskDelay(pdMS_TO_TICKS(2000));
    }
  }
}

static void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String message;
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    message += static_cast<char>(payload[i]);
  }
  message.trim();

  if (strcmp(topic, TOPIC_MODE_SET) != 0) {
    return;
  }

  if (message == "1" || message.equalsIgnoreCase("buttons")) {
    currentMode = MODE_BUTTONS;
    publishMode();
  } else if (message == "2" || message.equalsIgnoreCase("pressure")) {
    currentMode = MODE_PRESSURE;
    publishMode();
  }
}

static void publishMode() {
  const char *mode = currentMode == MODE_BUTTONS ? "1" : "2";
  if (xSemaphoreTakeRecursive(mqttMutex, pdMS_TO_TICKS(250)) == pdTRUE) {
    mqttClient.publish(TOPIC_MODE_STATE, mode, true);
    xSemaphoreGiveRecursive(mqttMutex);
  }
}

static void publishButtonState(const ButtonEvent &event) {
  const uint8_t pressed = digitalRead(event.pin) == LOW ? 1 : 0;

  char payload[96];
  snprintf(payload, sizeof(payload),
           "{\"button\":%u,\"pin\":%u,\"pressed\":%u,\"mode\":1}",
           event.index + 1,
           event.pin,
           pressed);

  if (xSemaphoreTakeRecursive(mqttMutex, pdMS_TO_TICKS(250)) == pdTRUE) {
    mqttClient.publish(TOPIC_BUTTONS, payload);
    xSemaphoreGiveRecursive(mqttMutex);
  }
}

static void publishPressure(long raw, long netRaw, float pressureKpa, float pressureMmhg) {
  char payload[192];
  snprintf(payload, sizeof(payload),
           "{\"pressure\":%.3f,\"pressure_kpa\":%.3f,\"pressure_mmhg\":%.2f,"
           "\"raw\":%ld,\"net\":%ld,\"timeouts\":%lu,\"mode\":2}",
           pressureKpa,
           pressureKpa,
           pressureMmhg,
           raw,
           netRaw,
           static_cast<unsigned long>(pressureTimeoutCount));

  if (xSemaphoreTakeRecursive(mqttMutex, pdMS_TO_TICKS(250)) == pdTRUE) {
    mqttClient.publish(TOPIC_PRESSURE, payload);
    xSemaphoreGiveRecursive(mqttMutex);
  }
}

static void publishPressureTimeout() {
  char payload[96];
  snprintf(payload, sizeof(payload),
           "{\"error\":\"hx710b_timeout\",\"timeouts\":%lu,\"mode\":2}",
           static_cast<unsigned long>(pressureTimeoutCount));

  if (xSemaphoreTakeRecursive(mqttMutex, pdMS_TO_TICKS(250)) == pdTRUE) {
    mqttClient.publish(TOPIC_PRESSURE, payload);
    xSemaphoreGiveRecursive(mqttMutex);
  }
}

static void taskMqtt(void *parameter) {
  (void)parameter;

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();
    }

    if (xSemaphoreTakeRecursive(mqttMutex, portMAX_DELAY) == pdTRUE) {
      if (!mqttClient.connected()) {
        connectMqtt();
      } else {
        mqttClient.loop();
      }
      xSemaphoreGiveRecursive(mqttMutex);
    }

    vTaskDelay(pdMS_TO_TICKS(MQTT_LOOP_INTERVAL_MS));
  }
}

static void taskButtons(void *parameter) {
  (void)parameter;

  ButtonEvent event;
  uint32_t lastEventTicks[BUTTON_COUNT] = {0};

  for (;;) {
    if (xQueueReceive(buttonQueue, &event, portMAX_DELAY) != pdTRUE) {
      continue;
    }

    const uint32_t now = xTaskGetTickCount();
    const uint32_t elapsedMs = pdTICKS_TO_MS(now - lastEventTicks[event.index]);
    if (elapsedMs < BUTTON_DEBOUNCE_MS) {
      continue;
    }
    lastEventTicks[event.index] = now;

    if (currentMode == MODE_BUTTONS) {
      publishButtonState(event);
    }
  }
}

static void taskPressure(void *parameter) {
  (void)parameter;

  for (;;) {
    if (currentMode == MODE_PRESSURE) {
      const long raw = readHx710bAverage(PRESSURE_SAMPLE_COUNT);

      if (raw == LONG_MIN) {
        pressureTimeoutCount++;
        Serial.print("HX710B timeout. OUT=");
        Serial.print(digitalRead(HX710B_OUT_PIN));
        Serial.print(" timeouts=");
        Serial.println(pressureTimeoutCount);
        resetHx710b();
        publishPressureTimeout();
      } else {
        pressureTimeoutCount = 0;
        const long netRaw = raw - pressureZeroOffset;
        const float pressureKpa = netRaw / RAW_COUNTS_PER_KPA;
        const float pressureMmhg = pressureKpa * KPA_TO_MMHG;
        publishPressure(raw, netRaw, pressureKpa, pressureMmhg);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(PRESSURE_SAMPLE_INTERVAL_MS));
  }
}
