# Relatório de Perfilamento e Análise

**Projeto:** Otimização de Telemetria com Buffer Circular
**Disciplina:** Análise de Algoritmos e Sistemas Embarcados
**Sistema analisado:** Hand Rehab MVP
**Data da campanha:** 2026-06-03

## 1. Objetivo

Este relatório apresenta o perfilamento de duas estratégias para captura, armazenamento temporário e transmissão de amostras de sensores em um sistema embarcado com comunicação MQTT.

O objetivo da análise é comparar uma abordagem baseada em deslocamento linear de elementos, denominada neste relatório como Vertente 1, com uma abordagem baseada em buffer circular de tamanho fixo, denominada Vertente 2. A comparação considera a complexidade assintótica das operações, o comportamento das estratégias sob diferentes escalas de `N`, o impacto sobre o uso de memória e a resposta do sistema em cenários com gargalo ou instabilidade de rede.

Como a placa ESP32 física não estava disponível durante a análise final, os tempos de execução dos algoritmos foram obtidos por meio de uma emulação determinística. Entretanto, o fluxo de telemetria foi validado de ponta a ponta com os componentes reais do MVP: publicação em broker MQTT, roteamento pelo Node-RED, recebimento pelo backend e persistência em banco PostgreSQL. Dessa forma, os resultados de latência algorítmica devem ser interpretados como resultados emulados, enquanto o fluxo de comunicação e persistência foi exercitado em ambiente real do projeto.

## 2. Contextualização do Problema

Em sistemas embarcados, como aplicações baseadas em ESP32, existe uma diferença significativa entre o tempo de captura local dos dados e o tempo de transmissão pela rede. A leitura de sensores pode ocorrer em escala de microssegundos, enquanto a transmissão via MQTT, o processamento no broker, o roteamento pelo Node-RED e a persistência no backend tendem a operar em escala de milissegundos.

Essa diferença cria um problema importante: quando a transmissão sofre atraso, as amostras continuam sendo produzidas localmente. Caso a estrutura de armazenamento temporário não seja adequada, o sistema pode acumular dados de forma ineficiente, gerar maior uso de CPU, aumentar a latência da amostragem e introduzir jitter temporal.

Uma estratégia simples para manter um histórico de amostras é armazenar os dados em um vetor e, quando necessário remover o primeiro elemento, deslocar todos os demais uma posição para a esquerda. Embora essa solução seja fácil de implementar, ela possui custo linear em relação ao número de elementos armazenados. Assim, quanto maior a janela de amostras, maior o tempo necessário para manter essa estrutura.

Outra possibilidade ineficiente seria utilizar realocação dinâmica frequente, como chamadas sucessivas a `realloc()`. Além do custo de cópia dos dados, esse tipo de abordagem pode aumentar o risco de fragmentação do heap em sistemas embarcados, prejudicando a estabilidade da aplicação ao longo do tempo.

O buffer circular evita esses problemas ao utilizar uma região fixa de memória e controlar a posição de escrita e leitura por meio de índices. Em vez de deslocar os elementos armazenados, a estrutura apenas avança os ponteiros lógicos de início e fim do buffer. Com isso, as operações de inserção e remoção mantêm custo constante, independentemente do tamanho da janela de amostras.

## 3. Vertentes Implementadas

### 3.1 Vertente 1: Abordagem Ineficiente por Deslocamento

A primeira vertente representa uma abordagem ineficiente de manutenção de histórico. Ela está implementada em:

```text
esp32-esp8266/hand-rehab/src/buffering/inefficient_buffer.h
```

Essa implementação utiliza um vetor fixo para fins comparativos, mas realiza a remoção do primeiro item por meio do deslocamento de todos os elementos restantes uma posição para a esquerda. Embora não utilize `realloc()` diretamente, ela reproduz o comportamento ineficiente descrito no problema: a manutenção da janela de dados exige movimentação linear de memória.

Do ponto de vista da telemetria via MQTT, essa estratégia é problemática porque adiciona custo computacional justamente nos momentos em que o sistema precisa absorver atrasos externos. Caso a publicação MQTT fique lenta ou o backend demore a persistir os dados, o buffer tende a permanecer mais cheio. Com mais elementos armazenados, cada operação de deslocamento se torna mais custosa, aumentando a chance de instabilidade temporal na amostragem.

### 3.2 Vertente 2: Buffer Circular

A segunda vertente utiliza uma estrutura de buffer circular, implementada em:

```text
esp32-esp8266/hand-rehab/src/buffering/ring_buffer.h
```

Essa estrutura utiliza capacidade fixa, índice de escrita (`head`), índice de leitura (`tail`) e contador de ocupação. A inserção ocorre diretamente na posição indicada por `head`, enquanto a remoção ocorre diretamente na posição indicada por `tail`. Após cada operação, os índices são atualizados por aritmética modular.

Essa abordagem é mais adequada para o contexto do projeto porque permite organizar a telemetria no modelo produtor-consumidor. A captura local atua como produtora de amostras, o buffer absorve variações temporais e a rotina de publicação MQTT consome os dados em lote. Assim, eventuais atrasos de rede não bloqueiam imediatamente a captura dos sensores.

## 4. Instrumentação e Campanha

A instrumentação prevista para o firmware utiliza `micros()` para registrar o tempo de execução das operações e `ESP.getFreeHeap()` para acompanhar a memória livre disponível durante a execução.

Um exemplo da instrumentação prevista é apresentado abaixo:

```cpp
unsigned long start = micros();

// Lógica de inserção de dados

unsigned long duration = micros() - start;

Serial.printf(
    "Latência: %lu µs | Heap Livre: %u bytes\n",
    duration,
    ESP.getFreeHeap()
);
```

Além da instrumentação prevista no firmware, o MVP possui um fluxo completo para execução de benchmarks e registro dos resultados. Esse fluxo contempla:

* comando de benchmark enviado pelo backend;
* publicação MQTT no tópico `rehab/devices/{device_id}/benchmark/status`;
* publicação MQTT no tópico `rehab/devices/{device_id}/benchmark/results`;
* normalização das mensagens no Node-RED;
* envio dos dados ao backend;
* persistência dos resultados no PostgreSQL.

Para a campanha final, sem a placa ESP32 física, foram utilizados scripts de apoio para reproduzir deterministicamente o comportamento esperado dos algoritmos e publicar os resultados no fluxo real de telemetria:

```text
entregas/perfilamento/benchmark_model.py
entregas/perfilamento/esp32_flow_emulator.py
entregas/perfilamento/build_emulated_report_assets.py
```

A campanha foi executada com os seguintes parâmetros:

* cenários avaliados: `baseline`, `network_jitter` e `stress`;
* escalas de amostras: `N=100`, `N=5000` e `N=20000`;
* estratégias avaliadas: `ring_buffer` e `inefficient_shift_buffer`;
* repetições por cenário: 5;
* total de resultados publicados: 90;
* execuções persistidas no backend: 15;
* resultados por execução: 6.

A evidência da execução está documentada em:

```text
entregas/evidencias/mqtt-flow-emulated-benchmark.md
```

Os dados finais da campanha foram registrados nos arquivos:

```text
entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_results.csv
entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_summary.csv
```

## 5. Análise Assintótica

A análise assintótica permite comparar o comportamento das duas estratégias independentemente dos valores absolutos de tempo medidos ou emulados. O foco está no crescimento do custo computacional conforme o número de amostras `N` aumenta.

### 5.1 Inserção

No buffer circular, a inserção de uma nova amostra exige apenas três operações principais: escrita na posição indicada por `head`, atualização do índice com aritmética modular e incremento do contador de ocupação. Nenhuma dessas operações depende da quantidade total de elementos armazenados.

Assim, o custo de inserção no buffer circular é constante:

```text
T_insert_ring(N) = c
T_insert_ring(N) ∈ O(1)
```

Na estratégia por deslocamento, a inserção no final do vetor também pode ser considerada `O(1)` enquanto houver espaço disponível. O principal problema dessa abordagem aparece na remoção ou na manutenção da janela de dados, pois essas operações exigem deslocamento dos elementos.

### 5.2 Remoção

No buffer circular, a remoção de uma amostra exige a leitura da posição indicada por `tail`, a atualização do índice com aritmética modular e o decremento do contador de ocupação. Assim como na inserção, nenhuma dessas operações depende do tamanho da janela.

Portanto:

```text
T_remove_ring(N) = c
T_remove_ring(N) ∈ O(1)
```

Na estratégia ineficiente, a remoção do primeiro item exige mover todos os elementos restantes uma posição para a esquerda. Para uma estrutura com `N` elementos, são realizadas aproximadamente `N-1` cópias.

Assim:

```text
T_remove_shift(N) = a(N - 1) + b
T_remove_shift(N) ∈ O(N)
```

Esse custo se repete a cada manutenção da janela. Em cenários de alta frequência de amostragem, esse comportamento linear pode comprometer a previsibilidade temporal do sistema e aumentar o jitter.

### 5.3 Comparativo Teórico

| Operação                  |                        Vertente 1: deslocamento | Vertente 2: buffer circular |
| ------------------------- | ----------------------------------------------: | --------------------------: |
| Inserção                  |                                          `O(1)` |                      `O(1)` |
| Remoção do primeiro item  |                                          `O(N)` |                      `O(1)` |
| Manutenção de janela      |                                          Linear |                   Constante |
| Alocação durante execução | Pode envolver cópia ou realocação no antipadrão |                        Fixa |
| Previsibilidade temporal  |                       Piora conforme `N` cresce |           Mantém-se estável |

A análise teórica indica que, para valores pequenos de `N`, a diferença entre as estratégias tende a ser pouco perceptível. Porém, conforme o número de amostras aumenta, o custo linear da Vertente 1 passa a dominar o tempo de execução, enquanto a Vertente 2 mantém comportamento constante.

## 6. Resultados de Escalabilidade

A campanha emulada avaliou o comportamento das duas estratégias sob três escalas de amostras: `N=100`, `N=5000` e `N=20000`. Essas escalas permitem observar a diferença entre uma carga pequena, uma carga intermediária e uma carga elevada de dados.

O resumo agregado da campanha é apresentado a seguir:

| Cenário        | Estratégia               | Latência média (µs) | Desvio padrão (µs) | Latência máxima média (µs) | Drops médios | Heap mínimo médio (bytes) | Publicação MQTT média (µs) |
| -------------- | ------------------------ | ------------------: | -----------------: | -------------------------: | -----------: | ------------------------: | -------------------------: |
| baseline       | ring_buffer              |              10.709 |              0.902 |                     18.200 |        0.600 |                185374.467 |                     88.800 |
| baseline       | inefficient_shift_buffer |              46.821 |             38.268 |                     96.000 |        1.533 |                184537.667 |                    100.000 |
| network_jitter | ring_buffer              |              12.707 |              1.242 |                     20.733 |        1.333 |                185234.733 |                     76.800 |
| network_jitter | inefficient_shift_buffer |              55.136 |             45.284 |                    110.800 |        2.867 |                184330.667 |                    101.333 |
| stress         | ring_buffer              |              14.866 |              0.907 |                     24.267 |        2.200 |                185076.067 |                     95.867 |
| stress         | inefficient_shift_buffer |              66.991 |             54.310 |                    136.733 |        3.667 |                184233.467 |                     99.800 |

![Latência média por N](../graficos/aa-latency-avg-by-n.png)

**Figura 1.** Latência média emulada por escala de `N`.

![Latência máxima por N](../graficos/aa-latency-max-by-n.png)

**Figura 2.** Latência máxima média por escala de `N`.

A razão entre a latência média da Vertente 1 e da Vertente 2 evidencia a diferença de comportamento conforme o volume de amostras cresce:

| Cenário        | N=100 | N=5000 | N=20000 |
| -------------- | ----: | -----: | ------: |
| baseline       | 1.10x |  2.93x |   8.47x |
| network_jitter | 1.11x |  2.92x |   8.24x |
| stress         | 1.21x |  2.93x |   8.99x |

![Razão entre estratégia ineficiente e buffer circular](../graficos/aa-inefficient-vs-ring-ratio-bars.svg)

**Figura 3.** Razão entre a latência média da Vertente 1 e da Vertente 2.

Os resultados acompanham o comportamento previsto pela análise assintótica. Em `N=100`, a diferença entre as estratégias é pequena. Em `N=5000`, a Vertente 1 passa a apresentar latência quase três vezes maior que a Vertente 2. Em `N=20000`, o custo linear da estratégia por deslocamento se torna dominante, chegando a uma latência entre `8.24x` e `8.99x` maior que a do buffer circular.

Esse comportamento reforça que a diferença entre as estratégias não está apenas nos tempos absolutos, mas principalmente na forma como cada uma escala. A Vertente 1 degrada conforme o volume de dados aumenta, enquanto a Vertente 2 mantém maior estabilidade.

## 7. Diagnóstico de Memória

A análise de memória considerou o comportamento esperado das duas abordagens e os indicadores emulados de heap livre registrados durante a campanha. Como a execução final não ocorreu em uma placa ESP32 física, os valores apresentados nesta seção devem ser interpretados como indicadores emulados de pressão de memória, e não como medição direta de fragmentação real do heap.

Na Vertente 1, o principal risco está associado à movimentação linear de memória e, em implementações alternativas, ao uso frequente de realocação dinâmica. Estratégias baseadas em `realloc()` podem provocar alocações e liberações sucessivas no heap, aumentando a fragmentação ao longo da execução. Em sistemas embarcados, esse comportamento é especialmente problemático, pois a memória disponível é limitada e a previsibilidade do sistema é parte essencial da confiabilidade.

Na implementação comparativa utilizada nesta campanha, a Vertente 1 não provoca fragmentação real por `realloc()`, pois foi implementada com vetor fixo. Ainda assim, ela concentra maior custo computacional na manutenção da janela, já que a remoção do primeiro elemento exige deslocamento dos demais itens. Esse padrão reduz a previsibilidade temporal e representa o mesmo tipo de antipadrão que a abordagem com realocação dinâmica busca evidenciar.

A Vertente 2, por sua vez, utiliza uma área fixa de memória durante a execução. Como os índices `head` e `tail` controlam logicamente as posições de escrita e leitura, não é necessário deslocar elementos nem realocar a estrutura para manter a janela de amostras. Essa característica torna o consumo de memória mais previsível e reduz o risco de instabilidade associado à gestão dinâmica do heap.

![Heap mínimo por N](../graficos/aa-min-heap-by-n.png)

**Figura 4.** Heap mínimo médio emulado por escala de `N`.

Na campanha emulada, a Vertente 2 apresentou maior heap mínimo médio em todos os cenários avaliados:

| Cenário        | Heap mínimo médio Vertente 2 | Heap mínimo médio Vertente 1 | Diferença aproximada |
| -------------- | ---------------------------: | ---------------------------: | -------------------: |
| baseline       |                 185374 bytes |                 184538 bytes |            837 bytes |
| network_jitter |                 185235 bytes |                 184331 bytes |            904 bytes |
| stress         |                 185076 bytes |                 184233 bytes |            843 bytes |

Esses resultados indicam menor pressão de memória na Vertente 2 dentro do modelo emulado. A diferença observada está alinhada ao comportamento esperado de uma estrutura com memória fixa e operações constantes. No entanto, a fragmentação real do heap deve ser validada em uma etapa futura com a placa ESP32 física, utilizando medições diretas com `ESP.getFreeHeap()` e, se necessário, testes específicos com alocação e realocação dinâmica.

Portanto, a análise de memória aponta que o buffer circular é a estratégia mais adequada para o MVP por oferecer uso previsível de memória, menor dependência de movimentações internas e menor exposição a problemas associados à fragmentação do heap.

## 8. Discussão Sobre Instabilidade de Rede

A transmissão de dados por rede possui comportamento menos previsível do que a captura local de eventos. Enquanto uma leitura de sensor pode ocorrer em microssegundos, a publicação MQTT depende de fatores externos, como conexão Wi-Fi, disponibilidade do broker, roteamento no Node-RED, processamento no backend e persistência no banco.

No MVP Hand Rehab, o fluxo foi organizado em duas partes principais. A primeira está relacionada ao feedback do usuário:

```text
ESP32 -> MQTT -> Node-RED -> WebSocket -> Frontend
```

A segunda está relacionada à persistência e análise dos dados:

```text
ESP32 -> MQTT batch/benchmark -> Node-RED -> Backend -> PostgreSQL
```

Essa separação é importante porque o sistema não deve bloquear a captura local sempre que houver atraso na transmissão ou persistência dos dados. Em um cenário ideal, a coleta das amostras deve continuar de forma estável, enquanto o envio ocorre em lotes ou em uma rotina separada.

Na Vertente 1, o acoplamento entre acúmulo de dados e custo de manutenção do buffer tende a piorar a instabilidade. Quando a rede atrasa, o buffer pode permanecer mais cheio. Com o buffer mais cheio, a remoção por deslocamento exige mais cópias. Com mais cópias, o tempo de CPU aumenta. Como consequência, o próprio processo de amostragem pode sofrer jitter.

Esse ciclo pode ser resumido da seguinte forma:

```text
rede lenta -> maior ocupação do buffer -> maior custo de deslocamento -> maior jitter de amostragem
```

Na Vertente 2, o buffer circular reduz esse problema. Como a inserção e a remoção são `O(1)`, o custo das operações não cresce proporcionalmente ao número de amostras armazenadas. Isso torna a estrutura mais adequada para o modelo produtor-consumidor, no qual a captura local produz dados continuamente e a publicação MQTT consome esses dados conforme a rede permite.

![Latência MQTT por N](../graficos/aa-mqtt-latency-by-n.png)

**Figura 5.** Latência local de publicação MQTT medida pelo emulador.

![Drops por N](../graficos/aa-drops-by-n.png)

**Figura 6.** Perdas de amostras emuladas por escala de `N`.

Os cenários `network_jitter` e `stress` foram utilizados para representar condições de maior instabilidade. Mesmo nesses cenários, a Vertente 2 manteve menor latência média, menor latência máxima e menor número médio de perdas de amostras em relação à Vertente 1.

Esse resultado reforça que o buffer circular não apenas reduz o custo computacional das operações, mas também melhora a capacidade do sistema de absorver variações de rede sem comprometer diretamente a rotina de captura.

## 9. Limitações

A campanha apresentada possui limitações importantes. A principal delas é a ausência da placa ESP32 física durante a execução final dos testes. Por esse motivo, os tempos de execução dos algoritmos foram obtidos por emulação determinística, e os valores de heap livre também foram simulados.

As principais limitações da análise são:

* `micros()` não foi medido diretamente na ESP32 durante a campanha final;
* `ESP.getFreeHeap()` não foi coletado fisicamente na placa;
* a fragmentação real do heap por uso de `realloc()` não foi provocada em hardware;
* os tempos de execução dos algoritmos foram obtidos por modelo determinístico;
* a latência MQTT registrada representa o ambiente local do emulador e dos containers do MVP.

Apesar dessas limitações, a campanha validou aspectos importantes da solução. O fluxo MQTT foi exercitado de ponta a ponta, os contratos dos payloads foram testados, os dados foram processados pelo Node-RED, recebidos pelo backend e persistidos no PostgreSQL. Além disso, os resultados emulados foram coerentes com a análise assintótica esperada para as duas estruturas.

Uma etapa futura recomendada é repetir a campanha com a ESP32 física, sensores reais e conexão Wi-Fi do ambiente de teste. Essa etapa permitiria coletar medições reais de latência com `micros()`, memória livre com `ESP.getFreeHeap()` e eventuais efeitos de fragmentação em cenários com alocação dinâmica.

## 10. Conclusão

A análise realizada demonstra que o buffer circular é a estratégia mais adequada para a telemetria do MVP Hand Rehab. Do ponto de vista assintótico, a Vertente 2 mantém inserção e remoção em tempo constante, `O(1)`, enquanto a Vertente 1 apresenta custo linear, `O(N)`, na remoção do primeiro elemento e na manutenção da janela de amostras.

Os resultados da campanha emulada acompanham essa diferença teórica. Para `N=100`, a diferença entre as estratégias foi pequena. Para `N=5000`, a abordagem por deslocamento já apresentou degradação relevante. Para `N=20000`, o custo linear tornou a Vertente 1 significativamente mais lenta, chegando a quase nove vezes a latência média da Vertente 2 em alguns cenários.

Na análise de memória, a Vertente 2 também se mostrou mais adequada por utilizar uma região fixa de armazenamento e evitar movimentações desnecessárias de dados. Embora a fragmentação real do heap não tenha sido medida nesta campanha, o comportamento teórico das duas abordagens indica maior previsibilidade e menor risco operacional no uso do buffer circular.

Em condições de instabilidade de rede, a Vertente 2 também apresenta vantagem. O modelo produtor-consumidor permite que a captura local continue inserindo amostras no buffer em tempo constante, enquanto a publicação MQTT consome os dados conforme a disponibilidade da rede. Isso reduz o acoplamento entre atraso de transmissão e jitter de amostragem.

Dessa forma, a Vertente 2 atende melhor aos requisitos de previsibilidade temporal, estabilidade de memória e tolerância a variações de rede. Para o MVP Hand Rehab, recomenda-se manter o buffer circular como estrutura principal de telemetria em lote, preservando o registro de metadados como latência, heap livre e perdas de amostras. A abordagem ineficiente deve permanecer apenas como referência comparativa para fins acadêmicos.

## 11. Reprodução

Com os containers do MVP ativos, a campanha pode ser reproduzida com o seguinte comando:

```powershell
.\.venv\Scripts\python.exe entregas\perfilamento\esp32_flow_emulator.py --replicates 5
```

Após a execução, os resumos, gráficos e manifesto podem ser regenerados com:

```powershell
.\.venv\Scripts\python.exe entregas\perfilamento\build_emulated_report_assets.py
```

Os principais arquivos gerados são:

```text
entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_results.csv
entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_summary.csv
entregas/perfilamento/raw/mqtt_flow_emulated_benchmark_manifest.json
entregas/graficos/aa-*.png
entregas/graficos/aa-*.svg
```
