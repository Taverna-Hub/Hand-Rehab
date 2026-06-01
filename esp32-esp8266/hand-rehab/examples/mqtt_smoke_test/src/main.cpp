#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "NOME_DA_REDE"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "SENHA_DA_REDE"
#endif

#ifndef MQTT_HOST
#define MQTT_HOST "192.168.1.7"
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

#ifndef DEVICE_ID
#define DEVICE_ID "esp32-001"
#endif

static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("WiFi SSID: %s\n", WIFI_SSID);
  Serial.print("Conectando ao Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.printf("\nWi-Fi conectado. IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

static void testRawTcp() {
  WiFiClient rawClient;
  Serial.printf("Teste TCP bruto %s:%u...", MQTT_HOST, MQTT_PORT);
  const uint32_t startedAt = millis();
  if (rawClient.connect(MQTT_HOST, MQTT_PORT, 3000)) {
    Serial.printf("ok em %lu ms\n", static_cast<unsigned long>(millis() - startedAt));
    rawClient.stop();
  } else {
    Serial.printf("falhou em %lu ms\n", static_cast<unsigned long>(millis() - startedAt));
  }
}

static void testMqtt() {
  char willTopic[128];
  char willPayload[160];
  snprintf(willTopic, sizeof(willTopic), "rehab/devices/%s/realtime/session", DEVICE_ID);
  snprintf(willPayload, sizeof(willPayload), "{\"device_id\":\"%s\",\"status\":\"offline\",\"timestamp_ms\":%lu}",
           DEVICE_ID,
           static_cast<unsigned long>(millis()));

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setSocketTimeout(10);
  mqttClient.setKeepAlive(15);

  Serial.printf("Teste MQTT %s:%u client_id=%s...", MQTT_HOST, MQTT_PORT, DEVICE_ID);
  const uint32_t startedAt = millis();
  const bool ok = mqttClient.connect(DEVICE_ID, willTopic, 1, true, willPayload);
  Serial.printf("%s em %lu ms state=%d connected=%d\n",
                ok ? "ok" : "falhou",
                static_cast<unsigned long>(millis() - startedAt),
                mqttClient.state(),
                mqttClient.connected());

  if (ok) {
    char topic[128];
    char payload[160];
    snprintf(topic, sizeof(topic), "rehab/devices/%s/realtime/session", DEVICE_ID);
    snprintf(payload, sizeof(payload), "{\"device_id\":\"%s\",\"status\":\"mqtt_smoke_ok\",\"timestamp_ms\":%lu}",
             DEVICE_ID,
             static_cast<unsigned long>(millis()));
    const bool published = mqttClient.publish(topic, payload, true);
    Serial.printf("Publish teste: %s\n", published ? "ok" : "falhou");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("MQTT smoke test ESP32");
  connectWifi();
  testRawTcp();
  testMqtt();
}

void loop() {
  mqttClient.loop();
  delay(100);
}
