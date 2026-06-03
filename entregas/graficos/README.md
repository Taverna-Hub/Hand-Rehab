# Graficos

Use esta pasta para guardar graficos usados na avaliacao academica.

Exemplos:

- Amostras recebidas em lote via MQTT.
- Comparativo de latencia entre Ring Buffer e estrategia ineficiente.
- Evolucao de heap livre durante testes.
- Drops por carga de eventos.
- Resultados por escala de amostras, como `N=100`, `N=5000` e `N=20000`.

Os arquivos `aa-*` sao gerados por `entregas/perfilamento/build_emulated_report_assets.py` a partir de `entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_results.csv`.

Os tempos de algoritmo continuam emulados, pois nao houve ESP32 fisica, mas a publicacao MQTT, o roteamento Node-RED e a persistencia passaram pelo fluxo real do MVP.
