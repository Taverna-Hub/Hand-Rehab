# Relatório de Perfilamento e Análise

**Projeto:** Otimização de Telemetria com Buffer Circular
**Disciplina:** Análise de Algoritmos e Sistemas Embarcados
**Sistema analisado:** Hand Rehab MVP
**Data da campanha:** 2026-06-04

## 1. Objetivo

Este relatório apresenta o perfilamento de duas estratégias para captura, armazenamento temporário e transmissão de amostras de sensores em um sistema embarcado com comunicação MQTT.

O objetivo da análise é comparar uma abordagem baseada em deslocamento linear de elementos, denominada neste relatório como Vertente 1, com uma abordagem baseada em buffer circular de tamanho fixo, denominada Vertente 2. A comparação considera a complexidade assintótica das operações, o comportamento das estratégias sob diferentes escalas de `N`, o impacto sobre o uso de memória e a resposta do sistema em cenários com gargalo ou instabilidade de rede.

Nesta revisão, os resultados usados no relatório foram obtidos a partir de uma execução persistida no PostgreSQL do MVP, nas tabelas `benchmark_runs` e `benchmark_results`. Assim, os dados analisados correspondem ao fluxo de benchmark publicado no tópico MQTT da ESP32, recebido pelo backend e registrado no banco de dados, permitindo conferência direta a partir do identificador da execução.

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

Para esta revisão do relatório, foi usada uma execução real já persistida no banco de dados. A consulta foi feita no PostgreSQL, banco `postgres`, nas tabelas `benchmark_runs` e `benchmark_results`.

```text
benchmark_runs.id = 762ba7a6-41a5-42ee-99fa-b5a1c23023f6
```

A execução escolhida possui os seguintes metadados:

* dispositivo: `esp32-001`;
* status: `completed`;
* escalas de amostras: `N=100`, `N=5000` e `N=20000`;
* estratégias avaliadas: `ring_buffer` e `inefficient_shift_buffer`;
* operação avaliada: `sliding_insert`;
* iterações por resultado: 100;
* resultados esperados: 6;
* resultados persistidos: 6;
* início da execução: `2026-06-04 15:22:50.78604+00`;
* fim da execução: `2026-06-04 15:22:51.087392+00`;
* tópico de resultados: `rehab/devices/esp32-001/benchmark/results`.

O comando usado para conferir a execução no banco foi:

```text
select *
from benchmark_results
where run_id = '762ba7a6-41a5-42ee-99fa-b5a1c23023f6'
order by strategy, sample_count;
```

## 5. Análise Assintótica

A análise assintótica permite comparar o comportamento das duas estratégias independentemente dos valores absolutos de tempo medidos. O foco está no crescimento do custo computacional conforme o número de amostras `N` aumenta.

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

A execução `762ba7a6-41a5-42ee-99fa-b5a1c23023f6` avaliou o comportamento das duas estratégias sob três escalas de amostras: `N=100`, `N=5000` e `N=20000`. Essas escalas permitem observar a diferença entre uma carga pequena, uma carga intermediária e uma carga elevada de dados.

Os resultados persistidos em `benchmark_results` são apresentados a seguir:

| Estratégia               | N     | Iterações | Duração total (µs) | Latência média (µs) | Latência máxima (µs) | Heap antes (bytes) | Heap depois (bytes) | Heap mínimo (bytes) | Drops |
| ------------------------ | ----: | --------: | -----------------: | ------------------: | -------------------: | -----------------: | ------------------: | ------------------: | ----: |
| ring_buffer              |   100 |       100 |                 72 |                   0 |                    1 |             200992 |              200468 |               86820 |     0 |
| ring_buffer              |  5000 |       100 |                 75 |                   0 |                    1 |             198336 |              178320 |               86820 |     0 |
| ring_buffer              | 20000 |       100 |                 85 |                   0 |                   10 |             198336 |              118320 |               86820 |     0 |
| inefficient_shift_buffer |   100 |       100 |                400 |                   4 |                    4 |             198336 |              197920 |               86820 |     0 |
| inefficient_shift_buffer |  5000 |       100 |              16862 |                 168 |                  195 |             198492 |              179904 |               86820 |     0 |
| inefficient_shift_buffer | 20000 |       100 |              67397 |                 673 |                  700 |             196492 |              121488 |               86820 |     0 |

A razão entre a duração total da Vertente 1 e da Vertente 2 evidencia a diferença de comportamento conforme o volume de amostras cresce:

| N     | Duração Vertente 2 (µs) | Duração Vertente 1 (µs) | Razão Vertente 1 / Vertente 2 |
| ----: | ----------------------: | ----------------------: | ----------------------------: |
|   100 |                      72 |                     400 |                         5.56x |
|  5000 |                      75 |                   16862 |                       224.83x |
| 20000 |                      85 |                   67397 |                       792.91x |

Os resultados acompanham o comportamento previsto pela análise assintótica. Em `N=100`, a Vertente 1 já apresentou duração total maior que a Vertente 2. Em `N=5000`, o custo de deslocamento passou a dominar o tempo de execução. Em `N=20000`, a estratégia por deslocamento registrou `67397 µs`, enquanto o buffer circular registrou `85 µs`.

Esse comportamento reforça que a diferença entre as estratégias não está apenas nos tempos absolutos, mas principalmente na forma como cada uma escala. A Vertente 1 degrada conforme o volume de dados aumenta, enquanto a Vertente 2 mantém maior estabilidade.

## 7. Diagnóstico de Memória

A análise de memória considerou o comportamento esperado das duas abordagens e os indicadores de heap livre persistidos na execução `762ba7a6-41a5-42ee-99fa-b5a1c23023f6`.

Na Vertente 1, o principal risco está associado à movimentação linear de memória e, em implementações alternativas, ao uso frequente de realocação dinâmica. Estratégias baseadas em `realloc()` podem provocar alocações e liberações sucessivas no heap, aumentando a fragmentação ao longo da execução. Em sistemas embarcados, esse comportamento é especialmente problemático, pois a memória disponível é limitada e a previsibilidade do sistema é parte essencial da confiabilidade.

Na implementação comparativa utilizada nesta campanha, a Vertente 1 não provoca fragmentação real por `realloc()`, pois foi implementada com vetor fixo. Ainda assim, ela concentra maior custo computacional na manutenção da janela, já que a remoção do primeiro elemento exige deslocamento dos demais itens. Esse padrão reduz a previsibilidade temporal e representa o mesmo tipo de antipadrão que a abordagem com realocação dinâmica busca evidenciar.

A Vertente 2, por sua vez, utiliza uma área fixa de memória durante a execução. Como os índices `head` e `tail` controlam logicamente as posições de escrita e leitura, não é necessário deslocar elementos nem realocar a estrutura para manter a janela de amostras. Essa característica torna o consumo de memória mais previsível e reduz o risco de instabilidade associado à gestão dinâmica do heap.

Na execução analisada, os dois conjuntos de resultados registraram `86820 bytes` como heap mínimo. A diferença aparece principalmente no heap antes e depois de cada teste, especialmente em `N=20000`: o buffer circular terminou com `118320 bytes` livres, enquanto a abordagem por deslocamento terminou com `121488 bytes`. Esses valores não indicam, isoladamente, fragmentação real do heap, mas documentam a pressão de memória observada durante a execução persistida.

Mesmo com heap mínimo igual na execução selecionada, o ponto central da análise permanece: a Vertente 2 mantém a estrutura em região fixa e evita movimentação linear dos elementos. A Vertente 1, embora use vetor fixo nesta implementação comparativa, concentra custo computacional na manutenção da janela e se torna menos previsível conforme `N` aumenta.

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

Na execução analisada, todos os seis resultados foram recebidos pelo backend pelo tópico `rehab/devices/esp32-001/benchmark/results` e persistidos sem perdas de amostras (`dropped_samples = 0`). Isso indica que, para essa run, o fluxo MQTT e a persistência no PostgreSQL conseguiram absorver os lotes de benchmark sem descarte.

Esse resultado reforça que o buffer circular não apenas reduz o custo computacional das operações, mas também melhora a capacidade do sistema de absorver variações de rede sem comprometer diretamente a rotina de captura.

## 9. Limitações

A campanha apresentada possui limitações importantes. O relatório utiliza uma run real persistida no banco, mas a análise está baseada em uma única execução completa. Portanto, os resultados devem ser interpretados como evidência de uma execução verificável, não como média estatística de uma campanha ampla.

As principais limitações da análise são:

* apenas uma run completa foi usada no relatório;
* os resultados não foram agregados por múltiplas repetições;
* a fragmentação real do heap por uso de `realloc()` não foi provocada em hardware;
* a execução não isola a latência de rede do custo algorítmico local;
* a tabela `benchmark_results` registra os resultados finais por estratégia e escala, não uma série temporal completa de cada iteração.

Apesar dessas limitações, a run escolhida valida aspectos importantes da solução. O fluxo MQTT foi exercitado de ponta a ponta, os contratos dos payloads foram testados, os dados foram recebidos pelo backend e persistidos no PostgreSQL. Além disso, os resultados registrados foram coerentes com a análise assintótica esperada para as duas estruturas.

Uma etapa futura recomendada é repetir a campanha com várias runs completas, sensores reais e conexão Wi-Fi do ambiente de teste. Essa etapa permitiria calcular médias, desvio padrão, intervalos de confiança e eventuais efeitos de fragmentação em cenários com alocação dinâmica.

## 10. Conclusão

A análise realizada demonstra que o buffer circular é a estratégia mais adequada para a telemetria do MVP Hand Rehab. Do ponto de vista assintótico, a Vertente 2 mantém inserção e remoção em tempo constante, `O(1)`, enquanto a Vertente 1 apresenta custo linear, `O(N)`, na remoção do primeiro elemento e na manutenção da janela de amostras.

Os resultados da run `762ba7a6-41a5-42ee-99fa-b5a1c23023f6` acompanham essa diferença teórica. Para `N=100`, a abordagem por deslocamento registrou `400 µs` de duração total contra `72 µs` do buffer circular. Para `N=5000`, a diferença subiu para `16862 µs` contra `75 µs`. Para `N=20000`, o custo linear tornou a Vertente 1 significativamente mais lenta, com `67397 µs` contra `85 µs` da Vertente 2.

Na análise de memória, os resultados da run registraram o mesmo heap mínimo para as duas estratégias, mas a Vertente 2 continua sendo mais adequada por utilizar uma região fixa de armazenamento e evitar movimentações desnecessárias de dados. Embora a fragmentação real do heap não tenha sido isolada nesta campanha, o comportamento teórico das duas abordagens indica maior previsibilidade e menor risco operacional no uso do buffer circular.

Em condições de instabilidade de rede, a Vertente 2 também apresenta vantagem. O modelo produtor-consumidor permite que a captura local continue inserindo amostras no buffer em tempo constante, enquanto a publicação MQTT consome os dados conforme a disponibilidade da rede. Isso reduz o acoplamento entre atraso de transmissão e jitter de amostragem.

Dessa forma, a Vertente 2 atende melhor aos requisitos de previsibilidade temporal, estabilidade de memória e tolerância a variações de rede. Para o MVP Hand Rehab, recomenda-se manter o buffer circular como estrutura principal de telemetria em lote, preservando o registro de metadados como latência, heap livre e perdas de amostras. A abordagem ineficiente deve permanecer apenas como referência comparativa para fins acadêmicos.

## 11. Reprodução

Com os containers do MVP ativos, a run usada neste relatório pode ser conferida no banco com:

```bash
docker compose exec postgres psql -U rehab_user -d postgres -c "select * from benchmark_runs where id = '762ba7a6-41a5-42ee-99fa-b5a1c23023f6';"
```

Os resultados associados podem ser conferidos com:

```bash
docker compose exec postgres psql -U rehab_user -d postgres -c "select * from benchmark_results where run_id = '762ba7a6-41a5-42ee-99fa-b5a1c23023f6' order by strategy, sample_count;"
```

Para executar uma nova campanha a partir do firmware, o backend deve criar uma nova entrada em `benchmark_runs`, enviar o comando de benchmark por MQTT e persistir os resultados recebidos em `benchmark_results`. A run usada neste relatório deve permanecer como referência verificável:

```text
762ba7a6-41a5-42ee-99fa-b5a1c23023f6
```
