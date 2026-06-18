#pragma once

#include <Arduino.h>

enum class RehabMode : uint8_t {
  Buttons,
  Pressure,
};

enum class ButtonEventType : uint8_t {
  Pressed,
  Released,
};

struct ButtonIsrEvent {
  uint8_t button_id;
  uint8_t pin;
  uint32_t timestamp_ms;
  bool pressed;
};

struct ButtonSample {
  uint8_t button_id;
  ButtonEventType event_type;
  uint32_t timestamp_ms;
  uint32_t sequence;
};

struct PressureSample {
  long pressure_raw;
  long pressure_delta_raw;
  long pressure_baseline_raw;
  uint32_t pressure_hit_threshold_raw;
  uint32_t pressure_release_threshold_raw;
  float pressure_kpa;
  bool has_pressure_kpa;
  bool pressure_calibrated;
  uint32_t timestamp_ms;
  uint32_t sequence;
};

struct BufferPerformanceStats {
  uint64_t insert_latency_total_us = 0;
  uint32_t insert_count = 0;
  uint32_t insert_latency_max_us = 0;

  void record(uint32_t latency_us) {
    insert_latency_total_us += latency_us;
    insert_count++;
    if (latency_us > insert_latency_max_us) {
      insert_latency_max_us = latency_us;
    }
  }

  uint32_t average_us() const {
    if (insert_count == 0) {
      return 0;
    }
    return static_cast<uint32_t>(insert_latency_total_us / insert_count);
  }
};
