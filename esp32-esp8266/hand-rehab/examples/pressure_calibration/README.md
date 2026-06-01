# Pressure Calibration

Projeto PlatformIO isolado para medir o offset RAW do sensor MPS20N0040D com HX710B sem alterar o firmware principal.

## Uso

1. Suba este exemplo temporariamente:

```powershell
pio run -d esp32-esp8266\hand-rehab\examples\pressure_calibration -t upload --upload-port COM7
```

2. Abra o monitor serial em 115200 baud e deixe o sensor sem pressao:

```powershell
pio device monitor -d esp32-esp8266\hand-rehab\examples\pressure_calibration --port COM7 --baud 115200
```

3. O firmware coleta RAW por 10 segundos automaticamente no boot e imprime a media como offset.

O bloco tera este formato:

```cpp
#define PRESSURE_ZERO_OFFSET_RAW 123456L
#define RAW_COUNTS_PER_KPA 10000.000000f
```

Tambem e possivel atualizar o arquivo com o script local:

```powershell
python esp32-esp8266\hand-rehab\examples\pressure_calibration\apply_to_secrets.py --zero-offset 123456
```

Use `--counts-per-kpa` apenas se precisar sobrescrever o fator padrao de `10000.0`.

4. Feche o monitor serial e regrave o firmware principal depois da calibracao:

```powershell
pio run -d esp32-esp8266\hand-rehab -t upload --upload-port COM7
```
