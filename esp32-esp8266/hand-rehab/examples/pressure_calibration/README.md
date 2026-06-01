# Pressure Calibration

Projeto PlatformIO isolado para calibrar o sensor MPS20N0040D com HX710B sem alterar o firmware principal.

## Uso

1. Suba este exemplo temporariamente:

```powershell
pio run -d esp32-esp8266\hand-rehab\examples\pressure_calibration -t upload --upload-port COM7
```

2. Abra o monitor serial em 115200 baud:

```powershell
pio device monitor -d esp32-esp8266\hand-rehab\examples\pressure_calibration --port COM7 --baud 115200
```

3. Com o sensor sem pressao, envie:

```text
t
```

4. Aplique uma pressao conhecida e envie o valor em kPa:

```text
c 10.0
```

5. Copie o bloco entre `BEGIN PRESSURE CALIBRATION SECRETS` e `END PRESSURE CALIBRATION SECRETS` para `esp32-esp8266/hand-rehab/include/secrets.h`.

O bloco tera este formato:

```cpp
#define PRESSURE_ZERO_OFFSET_RAW 123456L
#define RAW_COUNTS_PER_KPA 9876.543000f
```

Tambem e possivel atualizar o arquivo com o script local:

```powershell
python esp32-esp8266\hand-rehab\examples\pressure_calibration\apply_to_secrets.py --zero-offset 123456 --counts-per-kpa 9876.543
```

6. Regrave o firmware principal depois da calibracao:

```powershell
pio run -d esp32-esp8266\hand-rehab -t upload --upload-port COM7
```
