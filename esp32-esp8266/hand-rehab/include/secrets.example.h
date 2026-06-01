#pragma once

#define WIFI_SSID "NOME_DA_REDE"
#define WIFI_PASSWORD "SENHA_DA_REDE"

// Use o IP LAN do computador que roda o Docker/Node-RED.
// Nao use "nodered", pois esse hostname so existe dentro da rede Docker.
#define MQTT_HOST "192.168.0.100"
#define MQTT_PORT 1883

#define DEVICE_ID "esp32-001"

// Gerados pelo projeto examples/pressure_calibration.
#define PRESSURE_ZERO_OFFSET_RAW 0L
#define RAW_COUNTS_PER_KPA 10000.0f
