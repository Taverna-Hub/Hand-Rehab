#include <Arduino.h>
#include "HX711.h"

// Configuração inicial do sensor de pressão
const int DOUT_PIN = 3; 
const int SCK_PIN = 4;  

HX711 sensor;

// put function declarations here:
int myFunction(int, int);

void setup() {
  // put your setup code here, to run once:
  int result = myFunction(2, 3);
}

void loop() {
  // put your main code here, to run repeatedly:
}

// put function definitions here:
int myFunction(int x, int y) {
  return x + y;
}