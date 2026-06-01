#include <Arduino.h>
#include <limits.h>
#include <stdlib.h>

static const uint8_t HX710B_DOUT_PIN = 15;
static const uint8_t HX710B_SCK_PIN = 2;

static const uint8_t HX710B_TOTAL_CLOCK_PULSES = 27;
static const uint32_t HX710B_READY_TIMEOUT_MS = 250;
static const uint32_t STREAM_INTERVAL_MS = 500;
static const uint8_t SAMPLE_COUNT = 3;
static const uint8_t CALIBRATION_SAMPLE_COUNT = 20;
static const float DEFAULT_COUNTS_PER_KPA = 10000.0f;

static long zeroOffset = 0;
static float calibratedCountsPerKpa = DEFAULT_COUNTS_PER_KPA;
static bool streamEnabled = true;
static uint32_t timeoutCount = 0;

static void printSecretsDefines() {
  Serial.println();
  Serial.println("=== BEGIN PRESSURE CALIBRATION SECRETS ===");
  Serial.print("#define PRESSURE_ZERO_OFFSET_RAW ");
  Serial.print(zeroOffset);
  Serial.println("L");
  Serial.print("#define RAW_COUNTS_PER_KPA ");
  Serial.print(calibratedCountsPerKpa, 6);
  Serial.println("f");
  Serial.println("=== END PRESSURE CALIBRATION SECRETS ===");
  Serial.println();
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
  if (!waitForHx710b(HX710B_READY_TIMEOUT_MS)) {
    return LONG_MIN;
  }

  uint32_t value = 0;
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

static void printHelp() {
  Serial.println();
  Serial.println("Pressure calibration - HX710B/MPS20N0040D");
  Serial.println("Pins: DOUT/OUT=GPIO15, SCK=GPIO2");
  Serial.println("Commands:");
  Serial.println("  h              show this help");
  Serial.println("  t              tare with no pressure applied");
  Serial.println("  c <kpa>        calibrate using known pressure in kPa");
  Serial.println("  r              print one averaged raw sample");
  Serial.println("  p              print secrets.h pressure defines");
  Serial.println("  s              toggle streaming");
  Serial.println();
  Serial.println("Flow:");
  Serial.println("  1. Leave sensor without pressure and send: t");
  Serial.println("  2. Apply a known pressure and send: c <kpa>");
  Serial.println("  3. Copy the printed PRESSURE_ZERO_OFFSET_RAW and RAW_COUNTS_PER_KPA defines to secrets.h.");
  Serial.println();
}

static void tareSensor() {
  Serial.println("Tare: keep sensor without pressure...");
  const long raw = readHx710bAverage(CALIBRATION_SAMPLE_COUNT);
  if (raw == LONG_MIN) {
    Serial.println("tare_failed timeout");
    resetHx710b();
    return;
  }

  zeroOffset = raw;
  Serial.print("tare_ok zero_offset=");
  Serial.println(zeroOffset);
  printSecretsDefines();
}

static void calibrateSensor(float knownPressureKpa) {
  if (knownPressureKpa <= 0.0f) {
    Serial.println("calibration_failed invalid_kpa");
    return;
  }

  Serial.print("Calibration: apply known pressure kPa=");
  Serial.println(knownPressureKpa, 6);
  const long raw = readHx710bAverage(CALIBRATION_SAMPLE_COUNT);
  if (raw == LONG_MIN) {
    Serial.println("calibration_failed timeout");
    resetHx710b();
    return;
  }

  const long netRaw = raw - zeroOffset;
  if (netRaw == 0) {
    Serial.println("calibration_failed net_raw_zero");
    return;
  }

  calibratedCountsPerKpa = static_cast<float>(netRaw) / knownPressureKpa;
  Serial.print("calibration_ok raw=");
  Serial.print(raw);
  Serial.print(" zero_offset=");
  Serial.print(zeroOffset);
  Serial.print(" net_raw=");
  Serial.print(netRaw);
  Serial.print(" known_kpa=");
  Serial.print(knownPressureKpa, 6);
  Serial.print(" counts_per_kpa=");
  Serial.println(calibratedCountsPerKpa, 6);
  printSecretsDefines();
}

static void printOneSample() {
  const long raw = readHx710bAverage(SAMPLE_COUNT);
  if (raw == LONG_MIN) {
    timeoutCount++;
    Serial.print("sample_failed timeout_count=");
    Serial.println(timeoutCount);
    resetHx710b();
    return;
  }

  timeoutCount = 0;
  const long netRaw = raw - zeroOffset;
  const float defaultKpa = netRaw / DEFAULT_COUNTS_PER_KPA;
  const float calibratedKpa = netRaw / calibratedCountsPerKpa;

  Serial.print("sample ms=");
  Serial.print(millis());
  Serial.print(" raw=");
  Serial.print(raw);
  Serial.print(" net=");
  Serial.print(netRaw);
  Serial.print(" default_kpa=");
  Serial.print(defaultKpa, 6);
  Serial.print(" calibrated_kpa=");
  Serial.print(calibratedKpa, 6);
  Serial.print(" counts_per_kpa=");
  Serial.println(calibratedCountsPerKpa, 6);
}

static void handleCommand(String command) {
  command.trim();
  if (command.length() == 0) {
    return;
  }

  if (command == "h" || command == "help") {
    printHelp();
    return;
  }
  if (command == "t" || command == "tare") {
    tareSensor();
    return;
  }
  if (command == "r" || command == "raw") {
    printOneSample();
    return;
  }
  if (command == "p" || command == "print") {
    printSecretsDefines();
    return;
  }
  if (command == "s" || command == "stream") {
    streamEnabled = !streamEnabled;
    Serial.print("stream=");
    Serial.println(streamEnabled ? "on" : "off");
    return;
  }
  if (command.startsWith("c ")) {
    calibrateSensor(command.substring(2).toFloat());
    return;
  }
  if (command.startsWith("calibrate ")) {
    calibrateSensor(command.substring(10).toFloat());
    return;
  }

  Serial.println("unknown_command");
  printHelp();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(HX710B_SCK_PIN, OUTPUT);
  digitalWrite(HX710B_SCK_PIN, LOW);
  pinMode(HX710B_DOUT_PIN, INPUT);

  resetHx710b();
  printHelp();
  Serial.println("Waiting for HX710B...");
  if (!waitForHx710b(5000)) {
    Serial.println("hx710b_not_ready check wiring and power");
  } else {
    Serial.println("hx710b_ready");
  }
}

void loop() {
  static uint32_t lastStreamMs = 0;

  if (Serial.available() > 0) {
    const String command = Serial.readStringUntil('\n');
    handleCommand(command);
  }

  if (streamEnabled && millis() - lastStreamMs >= STREAM_INTERVAL_MS) {
    lastStreamMs = millis();
    printOneSample();
  }
}
