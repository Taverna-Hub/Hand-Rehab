#include <Arduino.h>

// Modulo HX710B com pinos GND, SCK, OUT e VCC.
// OUT do modulo e o sinal de dados do ADC.
static const uint8_t HX710B_OUT_PIN = 32;
static const uint8_t HX710B_SCK_PIN = 33;

static const uint8_t SAMPLE_COUNT = 3;
static const uint8_t HX710B_TOTAL_CLOCK_PULSES = 27;
static const uint32_t READY_TIMEOUT_MS = 250;
static const uint32_t READ_INTERVAL_MS = 500;

// Fator inicial apenas para teste. Calibre usando uma pressao conhecida.
static const float RAW_COUNTS_PER_KPA = 10000.0f;
static const float KPA_TO_MMHG = 7.50062f;

static long zeroOffset = 0;
static long lastRaw = 0;
static uint32_t readingCount = 0;
static uint32_t timeoutCount = 0;

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

  if (!waitForHx710b(READY_TIMEOUT_MS)) {
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

  // Pulsos extras: 27 pulsos no total selecionam entrada diferencial em 40 Hz.
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
  uint8_t validSamples = 0;

  for (uint8_t i = 0; i < sampleCount; i++) {
    const long raw = readHx710bRaw();
    if (raw != LONG_MIN) {
      sum += raw;
      validSamples++;
    } else {
      return LONG_MIN;
    }
  }

  if (validSamples == 0) {
    return LONG_MIN;
  }

  return static_cast<long>(sum / validSamples);
}

static void printPinDiagnostics() {
  digitalWrite(HX710B_SCK_PIN, LOW);
  delay(50);

  uint8_t highCount = 0;
  uint8_t lowCount = 0;

  for (uint8_t i = 0; i < 20; i++) {
    if (digitalRead(HX710B_OUT_PIN) == HIGH) {
      highCount++;
    } else {
      lowCount++;
    }
    delay(10);
  }

  Serial.print("Diagnostico GPIO: OUT LOW=");
  Serial.print(lowCount);
  Serial.print(" HIGH=");
  Serial.print(highCount);
  Serial.print(" | SCK=");
  Serial.println(digitalRead(HX710B_SCK_PIN));
}

static void printStartupSamples() {
  Serial.println("Amostras brutas antes da tara:");
  for (uint8_t i = 0; i < 5; i++) {
    const long raw = readHx710bRaw();
    Serial.print("  raw[");
    Serial.print(i);
    Serial.print("]=");
    if (raw == LONG_MIN) {
      Serial.println("timeout");
    } else {
      Serial.println(raw);
    }
    delay(100);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(HX710B_SCK_PIN, OUTPUT);
  digitalWrite(HX710B_SCK_PIN, LOW);
  pinMode(HX710B_OUT_PIN, INPUT);

  Serial.println();
  Serial.println("MPS20N0040D + HX710B - teste serial");
  Serial.printf("OUT: GPIO %u | SCK: GPIO %u\n", HX710B_OUT_PIN, HX710B_SCK_PIN);
  Serial.println("Ligacao: GND->GND, SCK->GPIO33, OUT->GPIO32, VCC->3V3");
  Serial.println("Modo HX710B: entrada diferencial, 40 Hz, 27 pulsos");

  printPinDiagnostics();

  resetHx710b();

  Serial.println("Aguardando HX710B...");
  if (!waitForHx710b(5000)) {
    Serial.println("Erro: HX710B nao ficou pronto. Confira OUT, SCK, VCC e GND.");
    return;
  }

  printStartupSamples();

  Serial.println("Fazendo tara. Deixe o sensor sem pressao aplicada.");
  zeroOffset = readHx710bAverage(20);
  lastRaw = zeroOffset;

  Serial.print("Offset zero: ");
  if (zeroOffset == LONG_MIN) {
    Serial.println("timeout");
  } else {
    Serial.println(zeroOffset);
  }
  Serial.println("Iniciando leituras...");
}

void loop() {
  const long raw = readHx710bAverage(SAMPLE_COUNT);
  if (raw == LONG_MIN) {
    timeoutCount++;
    Serial.print("HX710B timeout: OUT nao ficou LOW. OUT=");
    Serial.print(digitalRead(HX710B_OUT_PIN));
    Serial.print(" timeout_count=");
    Serial.println(timeoutCount);

    resetHx710b();
    delay(READ_INTERVAL_MS);
    return;
  }

  timeoutCount = 0;

  const long netRaw = raw - zeroOffset;
  const long rawDelta = raw - lastRaw;
  const float pressureKpa = netRaw / RAW_COUNTS_PER_KPA;
  const float pressureMmhg = pressureKpa * KPA_TO_MMHG;
  lastRaw = raw;
  readingCount++;

  Serial.print("raw=");
  Serial.print(raw);
  Serial.print(" delta=");
  Serial.print(rawDelta);
  Serial.print(" net=");
  Serial.print(netRaw);
  Serial.print(" pressao=");
  Serial.print(pressureKpa, 6);
  Serial.print(" kPa ");
  Serial.print(pressureMmhg, 4);
  Serial.println(" mmHg");

  if (raw == 8388607L || raw == -8388608L) {
    Serial.println("Diagnostico: leitura saturada. Pressao fora da faixa, sensor invertido ou ponte mal ligada.");
  }

  if (readingCount % 20 == 0 && raw == 0 && netRaw == 0) {
    Serial.println("Diagnostico: raw e net estao em zero. OUT pode estar preso em LOW ou ligado ao GND.");
  }

  if (readingCount % 20 == 0 && abs(netRaw) < 5) {
    Serial.println("Diagnostico: variacao muito baixa. Aplique pressao apos a tara para testar resposta.");
  }

  delay(READ_INTERVAL_MS);
}
