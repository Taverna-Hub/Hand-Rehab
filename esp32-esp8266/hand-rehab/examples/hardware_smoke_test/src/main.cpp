#include <Arduino.h>
#include <limits.h>

static const uint8_t BUTTON_PINS[] = {27, 14, 12, 13};
static const uint8_t BUTTON_COUNT = sizeof(BUTTON_PINS) / sizeof(BUTTON_PINS[0]);

static const uint8_t HX710B_DOUT_PIN = 15;
static const uint8_t HX710B_SCK_PIN = 2;
static const uint8_t STATUS_LED_PIN = 23;

static const uint32_t HX710B_READY_TIMEOUT_MS = 300;
static const uint8_t HX710B_TOTAL_CLOCK_PULSES = 27;

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

static void printPins() {
  Serial.println();
  Serial.println("Teste simples de hardware Hand Rehab");
  Serial.println("HX710B OUT/DOUT -> D15/GPIO15");
  Serial.println("HX710B SCK/CLK  -> D2/GPIO2");
  Serial.println("LED status      -> D23/GPIO23");
  Serial.println("Botoes fisicos 1..4: D27, D14, D12, D13 ligados ao GND quando pressionados");
  Serial.println("Botao solto=1, pressionado=0");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }

  pinMode(HX710B_SCK_PIN, OUTPUT);
  digitalWrite(HX710B_SCK_PIN, LOW);
  pinMode(HX710B_DOUT_PIN, INPUT);

  printPins();
}

void loop() {
  static uint32_t lastButtonPrintMs = 0;
  static uint32_t lastSensorPrintMs = 0;
  static uint32_t lastBlinkMs = 0;
  static bool ledOn = false;

  const uint32_t now = millis();

  if (now - lastBlinkMs >= 500) {
    lastBlinkMs = now;
    ledOn = !ledOn;
    digitalWrite(STATUS_LED_PIN, ledOn ? HIGH : LOW);
  }

  if (now - lastButtonPrintMs >= 200) {
    lastButtonPrintMs = now;
    Serial.print("Botoes B1..B4 = ");
    for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
      Serial.print(digitalRead(BUTTON_PINS[i]));
      if (i + 1 < BUTTON_COUNT) {
        Serial.print(" ");
      }
    }
    Serial.print(" | DOUT=");
    Serial.println(digitalRead(HX710B_DOUT_PIN));
  }

  if (now - lastSensorPrintMs >= 1000) {
    lastSensorPrintMs = now;
    const long raw = readHx710bRaw();
    if (raw == LONG_MIN) {
      Serial.println("HX710B: timeout esperando DOUT ficar LOW. Confira VCC, GND, OUT e SCK.");
    } else {
      Serial.print("HX710B raw=");
      Serial.println(raw);
    }
  }
}
