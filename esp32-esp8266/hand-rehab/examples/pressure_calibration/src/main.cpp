#include <Arduino.h>
#include <limits.h>

static const uint8_t HX710B_DOUT_PIN = 15;
static const uint8_t HX710B_SCK_PIN = 2;

static const uint8_t HX710B_TOTAL_CLOCK_PULSES = 27;
static const uint32_t HX710B_READY_TIMEOUT_MS = 250;
static const uint32_t CALIBRATION_DURATION_MS = 10000;
static const uint8_t SAMPLE_COUNT = 3;
static const float DEFAULT_COUNTS_PER_KPA = 10000.0f;

static long zeroOffset = 0;
static bool hasCalibration = false;
static uint32_t timeoutCount = 0;

static void printSecretsDefines() {
  if (!hasCalibration) {
    Serial.println("calibration_not_available");
    return;
  }

  Serial.println();
  Serial.println("=== BEGIN PRESSURE CALIBRATION SECRETS ===");
  Serial.print("#define PRESSURE_ZERO_OFFSET_RAW ");
  Serial.print(zeroOffset);
  Serial.println("L");
  Serial.print("#define RAW_COUNTS_PER_KPA ");
  Serial.print(DEFAULT_COUNTS_PER_KPA, 6);
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
  Serial.println("Pressure offset calibration - HX710B/MPS20N0040D");
  Serial.println("Pins: DOUT/OUT=GPIO15, SCK=GPIO2");
  Serial.println("Automatic flow:");
  Serial.println("  1. Keep the sensor without pressure while this firmware boots.");
  Serial.println("  2. It collects raw samples for 10 seconds.");
  Serial.println("  3. It prints PRESSURE_ZERO_OFFSET_RAW for include/secrets.h.");
  Serial.println();
  Serial.println("Debug commands:");
  Serial.println("  h              show this help");
  Serial.println("  r              print one averaged raw sample");
  Serial.println("  p              print secrets.h pressure defines");
  Serial.println();
}

static bool runAutomaticCalibration() {
  Serial.println("Calibration: keep sensor without pressure for 10 seconds...");

  const uint32_t startedAt = millis();
  uint32_t nextProgressAt = startedAt + 1000;
  int64_t sum = 0;
  uint32_t validSamples = 0;
  uint32_t failedSamples = 0;

  while (millis() - startedAt < CALIBRATION_DURATION_MS) {
    const long raw = readHx710bRaw();
    if (raw == LONG_MIN) {
      failedSamples++;
      resetHx710b();
    } else {
      sum += raw;
      validSamples++;
    }

    const uint32_t now = millis();
    if (now >= nextProgressAt) {
      Serial.print("calibration_progress elapsed_ms=");
      Serial.print(now - startedAt);
      Serial.print(" samples=");
      Serial.print(validSamples);
      Serial.print(" timeouts=");
      Serial.println(failedSamples);
      nextProgressAt += 1000;
    }
  }

  if (validSamples == 0) {
    Serial.print("calibration_failed no_valid_samples duration_ms=");
    Serial.print(CALIBRATION_DURATION_MS);
    Serial.print(" timeouts=");
    Serial.println(failedSamples);
    return false;
  }

  zeroOffset = static_cast<long>(sum / validSamples);
  hasCalibration = true;

  Serial.print("calibration_ok duration_ms=");
  Serial.print(CALIBRATION_DURATION_MS);
  Serial.print(" samples=");
  Serial.print(validSamples);
  Serial.print(" timeouts=");
  Serial.print(failedSamples);
  Serial.print(" zero_offset=");
  Serial.println(zeroOffset);
  printSecretsDefines();
  return true;
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
  const float pressureKpa = netRaw / DEFAULT_COUNTS_PER_KPA;

  Serial.print("sample ms=");
  Serial.print(millis());
  Serial.print(" raw=");
  Serial.print(raw);
  Serial.print(" net=");
  Serial.print(netRaw);
  Serial.print(" pressure_kpa=");
  Serial.print(pressureKpa, 6);
  Serial.print(" zero_offset=");
  Serial.print(zeroOffset);
  Serial.print(" counts_per_kpa=");
  Serial.println(DEFAULT_COUNTS_PER_KPA, 6);
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
  if (command == "r" || command == "raw") {
    printOneSample();
    return;
  }
  if (command == "p" || command == "print") {
    printSecretsDefines();
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
    return;
  }

  Serial.println("hx710b_ready");
  runAutomaticCalibration();
}

void loop() {
  if (Serial.available() > 0) {
    const String command = Serial.readStringUntil('\n');
    handleCommand(command);
  }
}
