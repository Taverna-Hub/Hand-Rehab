#pragma once

#include <Arduino.h>

// Ordem logica dos botoes fisicos 1..4.
static const uint8_t BUTTON_PINS[] = {27, 14, 12, 13};
static const uint8_t BUTTON_COUNT = sizeof(BUTTON_PINS) / sizeof(BUTTON_PINS[0]);

// Rótulos físicos usados na ESP32 DevKit: D15 e D2.
static const uint8_t HX710B_DOUT_PIN = 15;
static const uint8_t HX710B_SCK_PIN = 2;
static const uint8_t STATUS_LED_PIN = 23;
