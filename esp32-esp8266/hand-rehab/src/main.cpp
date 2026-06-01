#ifndef MQTT_MAX_PACKET_SIZE
#define MQTT_MAX_PACKET_SIZE 4096
#endif

#include <Arduino.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <limits.h>
#include <stdarg.h>
#include <string.h>

#include "buffering/inefficient_buffer.h"
#include "buffering/ring_buffer.h"
#include "config/pins.h"
#include "models/events.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef MQTT_HOST
#ifdef MQTT_BROKER
#define MQTT_HOST MQTT_BROKER
#else
#define MQTT_HOST "192.168.0.100"
#endif
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

#ifndef DEVICE_ID
#ifdef MQTT_CLIENT_ID
#define DEVICE_ID MQTT_CLIENT_ID
#else
#define DEVICE_ID "esp32-001"
#endif
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "CONFIGURE_WIFI_SSID"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "CONFIGURE_WIFI_PASSWORD"
#endif

#ifndef RAW_COUNTS_PER_KPA
#define RAW_COUNTS_PER_KPA 10000.0f
#endif

#ifndef PRESSURE_ZERO_OFFSET_RAW
#define PRESSURE_ZERO_OFFSET_RAW 0L
#endif

static const char *APP_WIFI_SSID = WIFI_SSID;
static const char *APP_WIFI_PASSWORD = WIFI_PASSWORD;
static const char *APP_MQTT_HOST = MQTT_HOST;
static const uint16_t APP_MQTT_PORT = MQTT_PORT;
static const char *APP_DEVICE_ID = DEVICE_ID;
static const uint16_t MQTT_BUFFER_SIZE_BYTES = MQTT_MAX_PACKET_SIZE;

static const uint32_t BUTTON_DEBOUNCE_MS = 50;
static const uint32_t BUTTON_SCAN_INTERVAL_MS = 10;
static const uint32_t PRESSURE_SAMPLE_INTERVAL_MS = 1000;
static const uint32_t MQTT_LOOP_INTERVAL_MS = 10;
static const uint16_t MQTT_SOCKET_TIMEOUT_SECONDS = 10;
static const uint16_t MQTT_KEEP_ALIVE_SECONDS = 15;
static const uint32_t MQTT_RECONNECT_INTERVAL_MS = 2000;
static const uint32_t BATCH_PUBLISH_INTERVAL_MS = 5000;
static const uint32_t STATUS_LED_BLINK_INTERVAL_MS = 500;
static const uint32_t STATUS_LED_IDLE_POLL_INTERVAL_MS = 100;
static const uint8_t PRESSURE_SAMPLE_COUNT = 3;
static const uint8_t HX710B_TOTAL_CLOCK_PULSES = 27;
static const uint32_t HX710B_READY_TIMEOUT_MS = 250;

static const size_t BATCH_BUFFER_CAPACITY = 64;
static const size_t BATCH_MAX_ITEMS = 6;
static const size_t MAX_BATCH_FLUSH_ATTEMPTS = (BATCH_BUFFER_CAPACITY / BATCH_MAX_ITEMS + 2) * 2;
static const size_t MQTT_QUEUED_PAYLOAD_SIZE = 512;

static const uint32_t MQTT_TASK_STACK = 8192;
static const uint32_t BUTTON_TASK_STACK = 4096;
static const uint32_t PRESSURE_TASK_STACK = 4096;
static const uint32_t REALTIME_TASK_STACK = 4096;
static const uint32_t BATCH_TASK_STACK = 6144;
static const uint32_t STATUS_LED_TASK_STACK = 2048;

static const EventBits_t WIFI_CONNECTED_BIT = BIT0;
static const EventBits_t MQTT_CONNECTED_BIT = BIT1;

enum class SessionLifecycle : uint8_t {
  Idle,
  Running,
  Finishing,
};

struct SessionState {
  char session_id[40];
  char user_id[40];
  char hand[8];
  RehabMode mode;
  uint32_t started_at_ms;
  SessionLifecycle lifecycle;
};

struct MqttMessage {
  char topic[128];
  char payload[MQTT_QUEUED_PAYLOAD_SIZE];
  bool retained;
};

struct MqttPublishResult {
  bool success;
  uint32_t latency_us;
};

struct PressureRealtimeMessage {
  PressureSample sample;
  SessionState session;
};

struct BatchBufferSnapshot {
  size_t buffer_used;
  uint32_t dropped;
  uint32_t insert_latency_avg_us;
  uint32_t insert_latency_max_us;
};

struct JsonWriter {
  char *buffer;
  size_t capacity;
  size_t used;

  bool append(const char *format, ...) {
    if (used >= capacity) {
      return false;
    }

    va_list args;
    va_start(args, format);
    const int written = vsnprintf(buffer + used, capacity - used, format, args);
    va_end(args);

    if (written < 0 || static_cast<size_t>(written) >= capacity - used) {
      used = capacity;
      return false;
    }

    used += static_cast<size_t>(written);
    return true;
  }
};

static QueueHandle_t buttonEventQueue;
static QueueHandle_t pressureQueue;
static QueueHandle_t mqttPublishQueue;
static QueueHandle_t mqttCriticalPublishQueue;
static SemaphoreHandle_t mqttMutex;
static SemaphoreHandle_t bufferMutex;
static SemaphoreHandle_t sessionMutex;
static EventGroupHandle_t systemEvents;

static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);

static RingBuffer<ButtonSample, BATCH_BUFFER_CAPACITY> buttonRingBuffer;
static RingBuffer<PressureSample, BATCH_BUFFER_CAPACITY> pressureRingBuffer;
static BufferPerformanceStats buttonBufferStats;
static BufferPerformanceStats pressureBufferStats;
static InefficientShiftBuffer<ButtonSample, BATCH_BUFFER_CAPACITY> academicButtonBuffer;
static InefficientShiftBuffer<PressureSample, BATCH_BUFFER_CAPACITY> academicPressureBuffer;

static SessionState currentSession = {
    "",
    "",
    "",
    RehabMode::Buttons,
    0,
    SessionLifecycle::Idle,
};

static uint32_t pressureTimeoutCount = 0;
static uint32_t buttonSequence = 0;
static uint32_t pressureSequence = 0;
static uint32_t lastButtonBatchPublishLatencyUs = 0;
static uint32_t lastPressureBatchPublishLatencyUs = 0;
static uint32_t lastMqttConnectAttemptMs = 0;
static uint32_t buttonRawChangedAtMs[BUTTON_COUNT] = {0};
static bool buttonLastRawPressed[BUTTON_COUNT] = {false};
static bool buttonStablePressed[BUTTON_COUNT] = {false};
static bool buttonDownInSession[BUTTON_COUNT] = {false};

static void copyText(char *destination, size_t destination_size, const char *source) {
  if (destination_size == 0) {
    return;
  }
  snprintf(destination, destination_size, "%s", source == nullptr ? "" : source);
}

static const char *modeToString(RehabMode mode) {
  return mode == RehabMode::Buttons ? "buttons" : "pressure";
}

static RehabMode modeFromString(const char *value, RehabMode fallback) {
  if (value == nullptr) {
    return fallback;
  }
  if (strcmp(value, "pressure") == 0) {
    return RehabMode::Pressure;
  }
  if (strcmp(value, "buttons") == 0) {
    return RehabMode::Buttons;
  }
  return fallback;
}

static const char *eventTypeToString(ButtonEventType type) {
  return type == ButtonEventType::Pressed ? "pressed" : "released";
}

static bool isValidHand(const char *value) {
  return value != nullptr && (strcmp(value, "left") == 0 || strcmp(value, "right") == 0);
}

static bool isValidMode(const char *value) {
  return value != nullptr && (strcmp(value, "buttons") == 0 || strcmp(value, "pressure") == 0);
}

static bool readButtonPressed(uint8_t index) {
  if (index >= BUTTON_COUNT) {
    return false;
  }
  return digitalRead(BUTTON_PINS[index]) == LOW;
}

static void resetButtonDebounceState() {
  const uint32_t now = millis();
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    const bool pressed = readButtonPressed(i);
    buttonLastRawPressed[i] = pressed;
    buttonStablePressed[i] = pressed;
    buttonRawChangedAtMs[i] = now;
  }
}

static bool getSessionSnapshot(SessionState &snapshot) {
  if (xSemaphoreTake(sessionMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    snapshot = currentSession;
    xSemaphoreGive(sessionMutex);
    return true;
  }
  return false;
}

static bool isSessionRunning(const SessionState &session) {
  return session.lifecycle == SessionLifecycle::Running;
}

static bool isSessionFinishing(const SessionState &session) {
  return session.lifecycle == SessionLifecycle::Finishing;
}

static bool isSameSession(const SessionState &left, const SessionState &right) {
  return strcmp(left.session_id, right.session_id) == 0 &&
         strcmp(left.user_id, right.user_id) == 0 &&
         strcmp(left.hand, right.hand) == 0 &&
         left.mode == right.mode;
}

static void buildTopic(char *topic, size_t topic_size, const char *suffix) {
  snprintf(topic, topic_size, "rehab/devices/%s/%s", APP_DEVICE_ID, suffix);
}

static bool enqueueMqttToQueue(QueueHandle_t queue, const char *topic, const char *payload, bool retained, TickType_t timeout) {
  if (queue == nullptr) {
    return false;
  }

  MqttMessage message = {};
  copyText(message.topic, sizeof(message.topic), topic);
  copyText(message.payload, sizeof(message.payload), payload);
  message.retained = retained;

  return xQueueSend(queue, &message, timeout) == pdTRUE;
}

static bool enqueueMqtt(const char *topic, const char *payload, bool retained = false) {
  return enqueueMqttToQueue(mqttPublishQueue, topic, payload, retained, pdMS_TO_TICKS(50));
}

static MqttPublishResult publishMqttNow(const char *topic, const char *payload, bool retained = false) {
  const uint32_t startedAt = micros();
  bool success = false;
  if (xSemaphoreTakeRecursive(mqttMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    if (mqttClient.connected()) {
      success = mqttClient.publish(topic, payload, retained);
    }
    xSemaphoreGiveRecursive(mqttMutex);
  }
  return {success, micros() - startedAt};
}

static bool publishCriticalMqtt(const char *topic, const char *payload, bool retained = false) {
  if (enqueueMqttToQueue(mqttCriticalPublishQueue, topic, payload, retained, pdMS_TO_TICKS(50))) {
    return true;
  }

  const MqttPublishResult result = publishMqttNow(topic, payload, retained);
  return result.success;
}

static void enqueueStatus(const char *status) {
  char topic[128];
  char payload[256];
  buildTopic(topic, sizeof(topic), "realtime/session");
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"%s\",\"status\":\"%s\",\"wifi_rssi\":%d,\"timestamp_ms\":%lu}",
           APP_DEVICE_ID,
           status,
           WiFi.RSSI(),
           static_cast<unsigned long>(millis()));
  enqueueMqtt(topic, payload, true);
}

static bool enqueueSessionEvent(const char *eventName, const SessionState &session) {
  char topic[128];
  char payload[384];
  buildTopic(topic, sizeof(topic), "realtime/session");
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\","
           "\"mode\":\"%s\",\"event_type\":\"%s\",\"timestamp_ms\":%lu}",
           APP_DEVICE_ID,
           session.session_id,
           session.user_id,
           session.hand,
           modeToString(session.mode),
           eventName,
           static_cast<unsigned long>(millis()));
  return publishCriticalMqtt(topic, payload, false);
}

static bool waitForHx710b(uint32_t timeoutMs) {
  const uint32_t startedAt = millis();

  while (digitalRead(HX710B_DOUT_PIN) == HIGH) {
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
    value = (value << 1) | digitalRead(HX710B_DOUT_PIN);
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

static void setupPressureSensor() {
  pinMode(HX710B_SCK_PIN, OUTPUT);
  digitalWrite(HX710B_SCK_PIN, LOW);
  pinMode(HX710B_DOUT_PIN, INPUT);

  Serial.printf("HX710B DOUT: GPIO %u | SCK: GPIO %u\n", HX710B_DOUT_PIN, HX710B_SCK_PIN);
  resetHx710b();

  if (!waitForHx710b(5000)) {
    Serial.println("HX710B nao ficou pronto no boot. Leituras tentarao recuperar no loop.");
    return;
  }
}

static void IRAM_ATTR enqueueButtonFromIsr(uint8_t index) {
  if (buttonEventQueue == nullptr || index >= BUTTON_COUNT) {
    return;
  }

  ButtonIsrEvent event = {
      static_cast<uint8_t>(index + 1),
      BUTTON_PINS[index],
      millis(),
      digitalRead(BUTTON_PINS[index]) == LOW,
  };

  BaseType_t higherPriorityTaskWoken = pdFALSE;
  xQueueSendFromISR(buttonEventQueue, &event, &higherPriorityTaskWoken);
  if (higherPriorityTaskWoken == pdTRUE) {
    portYIELD_FROM_ISR();
  }
}

void IRAM_ATTR button0Isr() { enqueueButtonFromIsr(0); }
void IRAM_ATTR button1Isr() { enqueueButtonFromIsr(1); }
void IRAM_ATTR button2Isr() { enqueueButtonFromIsr(2); }
void IRAM_ATTR button3Isr() { enqueueButtonFromIsr(3); }

static void publishRealtimeButton(const ButtonSample &sample, const SessionState &session) {
  char topic[128];
  char payload[384];
  buildTopic(topic, sizeof(topic), "realtime/buttons");
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\","
           "\"mode\":\"buttons\",\"button_id\":%u,\"event_type\":\"%s\",\"timestamp_ms\":%lu,"
           "\"sequence\":%lu}",
           APP_DEVICE_ID,
           session.session_id,
           session.user_id,
           session.hand,
           sample.button_id,
           eventTypeToString(sample.event_type),
           static_cast<unsigned long>(sample.timestamp_ms),
           static_cast<unsigned long>(sample.sequence));
  enqueueMqtt(topic, payload);
}

static void publishRealtimePressure(const PressureSample &sample, const SessionState &session) {
  char topic[128];
  char payload[384];
  buildTopic(topic, sizeof(topic), "realtime/pressure");
  if (sample.has_pressure_kpa) {
    snprintf(payload, sizeof(payload),
             "{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\","
             "\"mode\":\"pressure\",\"pressure_raw\":%ld,\"pressure_kpa\":%.3f,"
             "\"timestamp_ms\":%lu,\"sequence\":%lu}",
             APP_DEVICE_ID,
             session.session_id,
             session.user_id,
             session.hand,
             sample.pressure_raw,
             sample.pressure_kpa,
             static_cast<unsigned long>(sample.timestamp_ms),
             static_cast<unsigned long>(sample.sequence));
  } else {
    snprintf(payload, sizeof(payload),
             "{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\","
             "\"mode\":\"pressure\",\"pressure_raw\":%ld,\"pressure_kpa\":null,"
             "\"timestamp_ms\":%lu,\"sequence\":%lu}",
             APP_DEVICE_ID,
             session.session_id,
             session.user_id,
             session.hand,
             sample.pressure_raw,
             static_cast<unsigned long>(sample.timestamp_ms),
             static_cast<unsigned long>(sample.sequence));
  }
  enqueueMqtt(topic, payload);
}

static void publishPressureTimeout(const SessionState &session) {
  char topic[128];
  char payload[384];
  buildTopic(topic, sizeof(topic), "realtime/pressure");
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\","
           "\"mode\":\"pressure\",\"error\":\"hx710b_timeout\",\"timeouts\":%lu,\"timestamp_ms\":%lu}",
           APP_DEVICE_ID,
           session.session_id,
           session.user_id,
           session.hand,
           static_cast<unsigned long>(pressureTimeoutCount),
           static_cast<unsigned long>(millis()));
  enqueueMqtt(topic, payload);
}

static void recordButtonForBatch(const ButtonSample &sample) {
  const uint32_t startedAt = micros();
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
    buttonRingBuffer.push(sample);
    buttonBufferStats.record(micros() - startedAt);
    xSemaphoreGive(bufferMutex);
  }
}

static void recordPressureForBatch(const PressureSample &sample) {
  const uint32_t startedAt = micros();
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
    pressureRingBuffer.push(sample);
    pressureBufferStats.record(micros() - startedAt);
    xSemaphoreGive(bufferMutex);
  }
}

static size_t copyButtonSamples(ButtonSample *samples, size_t maxItems, BatchBufferSnapshot &snapshot) {
  size_t count = 0;
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    const size_t available = buttonRingBuffer.size();
    while (count < maxItems && buttonRingBuffer.peek(count, samples[count])) {
      count++;
    }
    snapshot.buffer_used = available > count ? available - count : 0;
    snapshot.dropped = buttonRingBuffer.dropped_samples();
    snapshot.insert_latency_avg_us = buttonBufferStats.average_us();
    snapshot.insert_latency_max_us = buttonBufferStats.insert_latency_max_us;
    xSemaphoreGive(bufferMutex);
  }
  return count;
}

static size_t copyPressureSamples(PressureSample *samples, size_t maxItems, BatchBufferSnapshot &snapshot) {
  size_t count = 0;
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    const size_t available = pressureRingBuffer.size();
    while (count < maxItems && pressureRingBuffer.peek(count, samples[count])) {
      count++;
    }
    snapshot.buffer_used = available > count ? available - count : 0;
    snapshot.dropped = pressureRingBuffer.dropped_samples();
    snapshot.insert_latency_avg_us = pressureBufferStats.average_us();
    snapshot.insert_latency_max_us = pressureBufferStats.insert_latency_max_us;
    xSemaphoreGive(bufferMutex);
  }
  return count;
}

static void discardButtonSamples(size_t count) {
  if (count == 0) {
    return;
  }
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    buttonRingBuffer.discard(count);
    xSemaphoreGive(bufferMutex);
  }
}

static void discardPressureSamples(size_t count) {
  if (count == 0) {
    return;
  }
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    pressureRingBuffer.discard(count);
    xSemaphoreGive(bufferMutex);
  }
}

static bool buildButtonBatchPayload(
    const ButtonSample *samples,
    size_t count,
    const BatchBufferSnapshot &bufferSnapshot,
    char *payload,
    size_t payloadSize) {
  if (count == 0) {
    return false;
  }

  SessionState session = {};
  getSessionSnapshot(session);

  JsonWriter writer = {payload, payloadSize, 0};
  const uint32_t nowMs = millis();

  writer.append("{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\",",
                APP_DEVICE_ID,
                session.session_id,
                session.user_id,
                session.hand);
  writer.append("\"mode\":\"buttons\",\"batch_id\":\"%s-buttons-%lu\",\"strategy\":\"ring_buffer\",",
                APP_DEVICE_ID,
                static_cast<unsigned long>(nowMs));
  writer.append("\"sequence_start\":%lu,\"sequence_end\":%lu,\"created_at_ms\":%lu,",
                static_cast<unsigned long>(samples[0].sequence),
                static_cast<unsigned long>(samples[count - 1].sequence),
                static_cast<unsigned long>(nowMs));
  writer.append("\"performance\":{\"insert_latency_us_avg\":%lu,\"insert_latency_us_max\":%lu,",
                static_cast<unsigned long>(bufferSnapshot.insert_latency_avg_us),
                static_cast<unsigned long>(bufferSnapshot.insert_latency_max_us));
  writer.append("\"mqtt_publish_latency_us\":%lu,\"free_heap_bytes\":%lu,\"min_free_heap_bytes\":%lu,",
                static_cast<unsigned long>(lastButtonBatchPublishLatencyUs),
                static_cast<unsigned long>(ESP.getFreeHeap()),
                static_cast<unsigned long>(ESP.getMinFreeHeap()));
  writer.append("\"buffer_capacity\":%u,\"buffer_used\":%u,\"dropped_samples\":%lu},\"events\":[",
                static_cast<unsigned>(BATCH_BUFFER_CAPACITY),
                static_cast<unsigned>(bufferSnapshot.buffer_used),
                static_cast<unsigned long>(bufferSnapshot.dropped));

  for (size_t i = 0; i < count; i++) {
    if (i > 0) {
      writer.append(",");
    }
    writer.append("{\"button_id\":%u,\"event_type\":\"%s\",\"timestamp_ms\":%lu,\"sequence\":%lu}",
                  samples[i].button_id,
                  eventTypeToString(samples[i].event_type),
                  static_cast<unsigned long>(samples[i].timestamp_ms),
                  static_cast<unsigned long>(samples[i].sequence));
  }

  writer.append("]}");
  return writer.used < payloadSize;
}

static bool buildPressureBatchPayload(
    const PressureSample *samples,
    size_t count,
    const BatchBufferSnapshot &bufferSnapshot,
    char *payload,
    size_t payloadSize) {
  if (count == 0) {
    return false;
  }

  SessionState session = {};
  getSessionSnapshot(session);

  JsonWriter writer = {payload, payloadSize, 0};
  const uint32_t nowMs = millis();

  writer.append("{\"device_id\":\"%s\",\"session_id\":\"%s\",\"user_id\":\"%s\",\"hand\":\"%s\",",
                APP_DEVICE_ID,
                session.session_id,
                session.user_id,
                session.hand);
  writer.append("\"mode\":\"pressure\",\"batch_id\":\"%s-pressure-%lu\",\"strategy\":\"ring_buffer\",",
                APP_DEVICE_ID,
                static_cast<unsigned long>(nowMs));
  writer.append("\"sequence_start\":%lu,\"sequence_end\":%lu,\"created_at_ms\":%lu,",
                static_cast<unsigned long>(samples[0].sequence),
                static_cast<unsigned long>(samples[count - 1].sequence),
                static_cast<unsigned long>(nowMs));
  writer.append("\"performance\":{\"insert_latency_us_avg\":%lu,\"insert_latency_us_max\":%lu,",
                static_cast<unsigned long>(bufferSnapshot.insert_latency_avg_us),
                static_cast<unsigned long>(bufferSnapshot.insert_latency_max_us));
  writer.append("\"mqtt_publish_latency_us\":%lu,\"free_heap_bytes\":%lu,\"min_free_heap_bytes\":%lu,",
                static_cast<unsigned long>(lastPressureBatchPublishLatencyUs),
                static_cast<unsigned long>(ESP.getFreeHeap()),
                static_cast<unsigned long>(ESP.getMinFreeHeap()));
  writer.append("\"buffer_capacity\":%u,\"buffer_used\":%u,\"dropped_samples\":%lu},\"samples\":[",
                static_cast<unsigned>(BATCH_BUFFER_CAPACITY),
                static_cast<unsigned>(bufferSnapshot.buffer_used),
                static_cast<unsigned long>(bufferSnapshot.dropped));

  for (size_t i = 0; i < count; i++) {
    if (i > 0) {
      writer.append(",");
    }
    if (samples[i].has_pressure_kpa) {
      writer.append("{\"pressure_raw\":%ld,\"pressure_kpa\":%.3f,\"timestamp_ms\":%lu,\"sequence\":%lu}",
                    samples[i].pressure_raw,
                    samples[i].pressure_kpa,
                    static_cast<unsigned long>(samples[i].timestamp_ms),
                    static_cast<unsigned long>(samples[i].sequence));
    } else {
      writer.append("{\"pressure_raw\":%ld,\"pressure_kpa\":null,\"timestamp_ms\":%lu,\"sequence\":%lu}",
                    samples[i].pressure_raw,
                    static_cast<unsigned long>(samples[i].timestamp_ms),
                    static_cast<unsigned long>(samples[i].sequence));
    }
  }

  writer.append("]}");
  return writer.used < payloadSize;
}

enum class BatchPublishStatus : uint8_t {
  NoData,
  Published,
  Failed,
};

static BatchPublishStatus publishButtonBatchIfAvailable() {
  ButtonSample samples[BATCH_MAX_ITEMS];
  BatchBufferSnapshot bufferSnapshot = {};
  const size_t count = copyButtonSamples(samples, BATCH_MAX_ITEMS, bufferSnapshot);
  if (count == 0) {
    return BatchPublishStatus::NoData;
  }

  char payload[2048];
  if (!buildButtonBatchPayload(samples, count, bufferSnapshot, payload, sizeof(payload))) {
    Serial.println("Falha ao montar batch de botoes.");
    return BatchPublishStatus::Failed;
  }

  char topic[128];
  buildTopic(topic, sizeof(topic), "batch/buttons");
  const MqttPublishResult result = publishMqttNow(topic, payload, false);
  if (!result.success) {
    Serial.printf("Falha ao publicar batch de botoes. Mantendo amostras no buffer. payload=%u mqtt_buffer=%u state=%d connected=%d\n",
                  static_cast<unsigned>(strlen(payload)),
                  mqttClient.getBufferSize(),
                  mqttClient.state(),
                  mqttClient.connected());
    return BatchPublishStatus::Failed;
  }

  lastButtonBatchPublishLatencyUs = result.latency_us;
  discardButtonSamples(count);
  return BatchPublishStatus::Published;
}

static BatchPublishStatus publishPressureBatchIfAvailable() {
  PressureSample samples[BATCH_MAX_ITEMS];
  BatchBufferSnapshot bufferSnapshot = {};
  const size_t count = copyPressureSamples(samples, BATCH_MAX_ITEMS, bufferSnapshot);
  if (count == 0) {
    return BatchPublishStatus::NoData;
  }

  char payload[2048];
  if (!buildPressureBatchPayload(samples, count, bufferSnapshot, payload, sizeof(payload))) {
    Serial.println("Falha ao montar batch de pressao.");
    return BatchPublishStatus::Failed;
  }

  char topic[128];
  buildTopic(topic, sizeof(topic), "batch/pressure");
  const MqttPublishResult result = publishMqttNow(topic, payload, false);
  if (!result.success) {
    Serial.printf("Falha ao publicar batch de pressao. Mantendo amostras no buffer. payload=%u mqtt_buffer=%u state=%d connected=%d\n",
                  static_cast<unsigned>(strlen(payload)),
                  mqttClient.getBufferSize(),
                  mqttClient.state(),
                  mqttClient.connected());
    return BatchPublishStatus::Failed;
  }

  lastPressureBatchPublishLatencyUs = result.latency_us;
  discardPressureSamples(count);
  return BatchPublishStatus::Published;
}

static bool flushAllBatches() {
  for (size_t attempt = 0; attempt < MAX_BATCH_FLUSH_ATTEMPTS; attempt++) {
    const BatchPublishStatus buttonStatus = publishButtonBatchIfAvailable();
    if (buttonStatus == BatchPublishStatus::Failed) {
      return false;
    }

    const BatchPublishStatus pressureStatus = publishPressureBatchIfAvailable();
    if (pressureStatus == BatchPublishStatus::Failed) {
      return false;
    }

    if (buttonStatus == BatchPublishStatus::NoData && pressureStatus == BatchPublishStatus::NoData) {
      return true;
    }
  }

  Serial.println("Flush de batch excedeu o limite de tentativas.");
  return false;
}

static void resetSessionRuntimeState() {
  if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    buttonRingBuffer.clear();
    pressureRingBuffer.clear();
    buttonBufferStats = BufferPerformanceStats{};
    pressureBufferStats = BufferPerformanceStats{};
    xSemaphoreGive(bufferMutex);
  }

  if (pressureQueue != nullptr) {
    xQueueReset(pressureQueue);
  }
  if (buttonEventQueue != nullptr) {
    xQueueReset(buttonEventQueue);
  }

  buttonSequence = 0;
  pressureSequence = 0;
  pressureTimeoutCount = 0;
  lastButtonBatchPublishLatencyUs = 0;
  lastPressureBatchPublishLatencyUs = 0;
  memset(buttonDownInSession, 0, sizeof(buttonDownInSession));
  resetButtonDebounceState();
}

static void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    xEventGroupSetBits(systemEvents, WIFI_CONNECTED_BIT);
    return;
  }

  xEventGroupClearBits(systemEvents, WIFI_CONNECTED_BIT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(APP_WIFI_SSID, APP_WIFI_PASSWORD);

  Serial.print("Conectando ao Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    vTaskDelay(pdMS_TO_TICKS(500));
  }

  Serial.print("\nWi-Fi conectado. IP: ");
  Serial.println(WiFi.localIP());
  xEventGroupSetBits(systemEvents, WIFI_CONNECTED_BIT);
}

static void subscribeCommandTopics() {
  char topic[128];

  buildTopic(topic, sizeof(topic), "commands/start_session");
  mqttClient.subscribe(topic);
  buildTopic(topic, sizeof(topic), "commands/end_session");
  mqttClient.subscribe(topic);
  buildTopic(topic, sizeof(topic), "commands/ping");
  mqttClient.subscribe(topic);
}

static void connectMqtt() {
  if (mqttClient.connected()) {
    return;
  }

  const uint32_t now = millis();
  if (lastMqttConnectAttemptMs != 0 && now - lastMqttConnectAttemptMs < MQTT_RECONNECT_INTERVAL_MS) {
    return;
  }
  lastMqttConnectAttemptMs = now;

  char statusTopic[128];
  char willPayload[160];
  buildTopic(statusTopic, sizeof(statusTopic), "realtime/session");
  snprintf(willPayload, sizeof(willPayload),
           "{\"device_id\":\"%s\",\"status\":\"offline\",\"timestamp_ms\":%lu}",
           APP_DEVICE_ID,
           static_cast<unsigned long>(millis()));

  Serial.print("Conectando ao MQTT...");
  const uint32_t startedAt = millis();
  if (mqttClient.connect(APP_DEVICE_ID, statusTopic, 1, true, willPayload)) {
    Serial.print("conectado em ");
    Serial.print(millis() - startedAt);
    Serial.println(" ms");
    xEventGroupSetBits(systemEvents, MQTT_CONNECTED_BIT);
    subscribeCommandTopics();
    enqueueStatus("online");
    enqueueStatus("idle");
  } else {
    xEventGroupClearBits(systemEvents, MQTT_CONNECTED_BIT);
    Serial.print("falhou em ");
    Serial.print(millis() - startedAt);
    Serial.print(" ms, rc=");
    Serial.println(mqttClient.state());
    mqttClient.disconnect();
    wifiClient.stop();
  }
}

static bool topicEndsWith(const char *topic, const char *suffix) {
  const size_t topicLen = strlen(topic);
  const size_t suffixLen = strlen(suffix);
  if (suffixLen > topicLen) {
    return false;
  }
  return strcmp(topic + topicLen - suffixLen, suffix) == 0;
}

static void handleStartSessionCommand(byte *payload, unsigned int length) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.println("Comando start_session invalido.");
    return;
  }

  const char *sessionId = doc["session_id"] | "";
  const char *userId = doc["user_id"] | "";
  const char *hand = doc["hand"] | "";
  const char *mode = doc["mode"] | "";

  if (strlen(sessionId) == 0 || strlen(userId) == 0 || !isValidHand(hand) || !isValidMode(mode)) {
    Serial.println("Comando start_session sem campos obrigatorios.");
    return;
  }

  if (strlen(sessionId) >= sizeof(currentSession.session_id) ||
      strlen(userId) >= sizeof(currentSession.user_id) ||
      strlen(hand) >= sizeof(currentSession.hand)) {
    Serial.println("Comando start_session com campos grandes demais.");
    return;
  }

  if (xSemaphoreTake(sessionMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    if (currentSession.lifecycle == SessionLifecycle::Running) {
      xSemaphoreGive(sessionMutex);
      Serial.println("Comando start_session ignorado: sessao ativa.");
      return;
    }
    if (currentSession.lifecycle == SessionLifecycle::Finishing) {
      xSemaphoreGive(sessionMutex);
      Serial.println("Comando start_session ignorado: finalizacao pendente.");
      enqueueStatus("finishing");
      return;
    }
    xSemaphoreGive(sessionMutex);
  } else {
    Serial.println("Comando start_session ignorado: estado de sessao indisponivel.");
    return;
  }

  resetSessionRuntimeState();

  SessionState startedSession = {};
  if (xSemaphoreTake(sessionMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    copyText(currentSession.session_id, sizeof(currentSession.session_id), sessionId);
    copyText(currentSession.user_id, sizeof(currentSession.user_id), userId);
    copyText(currentSession.hand, sizeof(currentSession.hand), hand);
    currentSession.mode = modeFromString(mode, RehabMode::Buttons);
    currentSession.started_at_ms = millis();
    currentSession.lifecycle = SessionLifecycle::Running;
    startedSession = currentSession;
    xSemaphoreGive(sessionMutex);
  } else {
    Serial.println("Comando start_session ignorado: falha ao ativar sessao.");
    return;
  }

  if (!enqueueSessionEvent("session_started", startedSession)) {
    Serial.println("Falha ao enfileirar ACK session_started.");
  }
  Serial.printf("Sessao iniciada: id=%s user=%s hand=%s mode=%s\n",
                startedSession.session_id,
                startedSession.user_id,
                startedSession.hand,
                modeToString(startedSession.mode));
}

static void handleEndSessionCommand() {
  bool shouldFinish = false;
  if (xSemaphoreTake(sessionMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    shouldFinish = currentSession.lifecycle == SessionLifecycle::Running;
    if (shouldFinish) {
      currentSession.lifecycle = SessionLifecycle::Finishing;
    }
    xSemaphoreGive(sessionMutex);
  }

  if (!shouldFinish) {
    enqueueStatus("idle");
  } else {
    Serial.println("Comando end_session recebido. Finalizando sessao.");
  }
}

static void mqttCallback(char *topic, byte *payload, unsigned int length) {
  if (topicEndsWith(topic, "/commands/start_session")) {
    handleStartSessionCommand(payload, length);
  } else if (topicEndsWith(topic, "/commands/end_session")) {
    handleEndSessionCommand();
  } else if (topicEndsWith(topic, "/commands/ping")) {
    enqueueStatus("online");
  }
}

static void taskMqtt(void *parameter) {
  (void)parameter;
  MqttMessage message = {};

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

    while (xQueueReceive(mqttCriticalPublishQueue, &message, 0) == pdTRUE) {
      publishMqttNow(message.topic, message.payload, message.retained);
    }

    while (xQueueReceive(mqttPublishQueue, &message, 0) == pdTRUE) {
      publishMqttNow(message.topic, message.payload, message.retained);
    }

    vTaskDelay(pdMS_TO_TICKS(MQTT_LOOP_INTERVAL_MS));
  }
}

static void taskButtons(void *parameter) {
  (void)parameter;

  ButtonIsrEvent ignoredEvent = {};

  for (;;) {
    while (xQueueReceive(buttonEventQueue, &ignoredEvent, 0) == pdTRUE) {
    }

    const uint32_t now = millis();
    SessionState session = {};
    getSessionSnapshot(session);
    const bool canPublish = isSessionRunning(session) && session.mode == RehabMode::Buttons;

    for (uint8_t index = 0; index < BUTTON_COUNT; index++) {
      const bool rawPressed = readButtonPressed(index);
      if (rawPressed != buttonLastRawPressed[index]) {
        buttonLastRawPressed[index] = rawPressed;
        buttonRawChangedAtMs[index] = now;
      }

      if (rawPressed == buttonStablePressed[index] || now - buttonRawChangedAtMs[index] < BUTTON_DEBOUNCE_MS) {
        continue;
      }

      buttonStablePressed[index] = rawPressed;
      if (!canPublish) {
        continue;
      }

      if (rawPressed) {
        buttonDownInSession[index] = true;
      } else if (!buttonDownInSession[index]) {
        Serial.printf("Release inicial ignorado no botao %u\n", index + 1);
        continue;
      } else {
        buttonDownInSession[index] = false;
      }

      ButtonSample sample = {
          static_cast<uint8_t>(index + 1),
          rawPressed ? ButtonEventType::Pressed : ButtonEventType::Released,
          now,
          ++buttonSequence,
      };

      publishRealtimeButton(sample, session);
      recordButtonForBatch(sample);
      Serial.printf("Botao %u %s seq=%lu\n",
                    sample.button_id,
                    eventTypeToString(sample.event_type),
                    static_cast<unsigned long>(sample.sequence));
    }

    vTaskDelay(pdMS_TO_TICKS(BUTTON_SCAN_INTERVAL_MS));
  }
}

static void taskPressure(void *parameter) {
  (void)parameter;

  for (;;) {
    SessionState session = {};
    getSessionSnapshot(session);

    if (isSessionRunning(session) && session.mode == RehabMode::Pressure) {
      const long raw = readHx710bAverage(PRESSURE_SAMPLE_COUNT);

      SessionState latestSession = {};
      getSessionSnapshot(latestSession);
      if (!isSessionRunning(latestSession) ||
          latestSession.mode != RehabMode::Pressure ||
          !isSameSession(session, latestSession)) {
        continue;
      }

      if (raw == LONG_MIN) {
        pressureTimeoutCount++;
        Serial.print("HX710B timeout. DOUT=");
        Serial.print(digitalRead(HX710B_DOUT_PIN));
        Serial.print(" timeouts=");
        Serial.println(pressureTimeoutCount);
        resetHx710b();
        publishPressureTimeout(latestSession);
      } else {
        pressureTimeoutCount = 0;
        const long netRaw = raw - PRESSURE_ZERO_OFFSET_RAW;
        PressureSample sample = {
            raw,
            netRaw / RAW_COUNTS_PER_KPA,
            true,
            millis(),
            ++pressureSequence,
        };

        PressureRealtimeMessage realtimeMessage = {sample, latestSession};
        xQueueSend(pressureQueue, &realtimeMessage, pdMS_TO_TICKS(20));
        recordPressureForBatch(sample);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(PRESSURE_SAMPLE_INTERVAL_MS));
  }
}

static void taskRealtimePublish(void *parameter) {
  (void)parameter;

  PressureRealtimeMessage pressureMessage = {};
  for (;;) {
    if (xQueueReceive(pressureQueue, &pressureMessage, portMAX_DELAY) == pdTRUE) {
      publishRealtimePressure(pressureMessage.sample, pressureMessage.session);
    }
  }
}

static void taskBatchPublish(void *parameter) {
  (void)parameter;

  uint32_t lastPublishMs = 0;

  for (;;) {
    const uint32_t now = millis();
    SessionState session = {};
    getSessionSnapshot(session);

    const bool intervalElapsed = isSessionRunning(session) && now - lastPublishMs >= BATCH_PUBLISH_INTERVAL_MS;
    const bool externalFinish = isSessionFinishing(session);

    if (intervalElapsed) {
      publishButtonBatchIfAvailable();
      publishPressureBatchIfAvailable();
      lastPublishMs = now;
    }

    if (externalFinish) {
      if (flushAllBatches()) {
        if (enqueueSessionEvent("session_finished", session)) {
          if (xSemaphoreTake(sessionMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (isSessionFinishing(currentSession) && isSameSession(currentSession, session)) {
              currentSession.lifecycle = SessionLifecycle::Idle;
            }
            xSemaphoreGive(sessionMutex);
          }
          enqueueStatus("idle");
        } else {
          Serial.println("Falha ao enfileirar ACK session_finished. Tentando novamente.");
        }
      }
      lastPublishMs = now;
    }

    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

static void taskStatusLed(void *parameter) {
  (void)parameter;

  bool ledOn = false;

  for (;;) {
    SessionState session = {};
    const bool hasSnapshot = getSessionSnapshot(session);
    const bool sessionActive = hasSnapshot && (isSessionRunning(session) || isSessionFinishing(session));

    if (sessionActive) {
      ledOn = !ledOn;
      digitalWrite(STATUS_LED_PIN, ledOn ? HIGH : LOW);
      vTaskDelay(pdMS_TO_TICKS(STATUS_LED_BLINK_INTERVAL_MS));
    } else {
      ledOn = false;
      digitalWrite(STATUS_LED_PIN, LOW);
      vTaskDelay(pdMS_TO_TICKS(STATUS_LED_IDLE_POLL_INTERVAL_MS));
    }
  }
}

static void setupHardware() {
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }
  resetButtonDebounceState();

  setupPressureSensor();
}

static void setupFreeRtos() {
  buttonEventQueue = xQueueCreate(16, sizeof(ButtonIsrEvent));
  pressureQueue = xQueueCreate(16, sizeof(PressureRealtimeMessage));
  mqttPublishQueue = xQueueCreate(16, sizeof(MqttMessage));
  mqttCriticalPublishQueue = xQueueCreate(4, sizeof(MqttMessage));
  mqttMutex = xSemaphoreCreateRecursiveMutex();
  bufferMutex = xSemaphoreCreateMutex();
  sessionMutex = xSemaphoreCreateMutex();
  systemEvents = xEventGroupCreate();

  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[0]), button0Isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[1]), button1Isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[2]), button2Isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PINS[3]), button3Isr, CHANGE);

  mqttClient.setServer(APP_MQTT_HOST, APP_MQTT_PORT);
  if (!mqttClient.setBufferSize(MQTT_BUFFER_SIZE_BYTES)) {
    Serial.println("Falha ao configurar buffer MQTT.");
  }
  mqttClient.setSocketTimeout(MQTT_SOCKET_TIMEOUT_SECONDS);
  mqttClient.setKeepAlive(MQTT_KEEP_ALIVE_SECONDS);
  mqttClient.setCallback(mqttCallback);
  Serial.printf("MQTT buffer configurado: %u bytes\n", mqttClient.getBufferSize());

  xTaskCreatePinnedToCore(taskMqtt, "mqtt", MQTT_TASK_STACK, nullptr, 3, nullptr, 0);
  xTaskCreatePinnedToCore(taskButtons, "buttons", BUTTON_TASK_STACK, nullptr, 2, nullptr, 1);
  xTaskCreatePinnedToCore(taskPressure, "pressure", PRESSURE_TASK_STACK, nullptr, 1, nullptr, 1);
  xTaskCreatePinnedToCore(taskRealtimePublish, "realtime", REALTIME_TASK_STACK, nullptr, 2, nullptr, 1);
  xTaskCreatePinnedToCore(taskBatchPublish, "batch", BATCH_TASK_STACK, nullptr, 1, nullptr, 1);
  xTaskCreatePinnedToCore(taskStatusLed, "status_led", STATUS_LED_TASK_STACK, nullptr, 1, nullptr, 1);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  setupHardware();
  setupFreeRtos();

  Serial.println("Hand Rehab firmware iniciado.");
  Serial.printf("Device ID: %s | MQTT: %s:%u\n", APP_DEVICE_ID, APP_MQTT_HOST, APP_MQTT_PORT);
  Serial.printf("Pressao: zero_offset_raw=%ld counts_per_kpa=%.6f\n",
                static_cast<long>(PRESSURE_ZERO_OFFSET_RAW),
                static_cast<double>(RAW_COUNTS_PER_KPA));
  (void)academicButtonBuffer.capacity();
  (void)academicPressureBuffer.capacity();
}

void loop() {
  vTaskDelete(nullptr);
}
