# Evidencias dos benchmarks

Esta pasta contem os CSVs usados como evidencia da analise de algoritmos do MVP Hand Rehab. Os dados registram execucoes reais de benchmark no dispositivo `esp32-001`, comparando a estrategia eficiente `ring_buffer` com a estrategia comparativa `inefficient_shift_buffer` na operacao `sliding_insert`.

## Arquivos

- `benchmark_runs.csv`: lista as execucoes de benchmark solicitadas e seus metadados.
- `benchmark_results.csv`: lista os resultados medidos em cada combinacao de execucao, estrategia e tamanho de entrada.

## `benchmark_runs.csv`

Cada linha representa uma execucao completa de benchmark. O arquivo contem 14 execucoes, todas com status `completed`.

Campos principais:

- `id`: identificador da execucao. Este valor se relaciona com `run_id` em `benchmark_results.csv`.
- `device_id`: dispositivo que executou o teste.
- `status` e `last_status`: estado da execucao.
- `sample_counts`: tamanhos de entrada avaliados. Nesta evidencia: `100`, `5000` e `20000`.
- `strategies`: algoritmos comparados. Nesta evidencia: `ring_buffer` e `inefficient_shift_buffer`.
- `iterations`: quantidade de repeticoes por cenario. Nesta evidencia: `100`.
- `operation`: operacao medida. Nesta evidencia: `sliding_insert`.
- `expected_results`: quantidade esperada de resultados por execucao.
- `started_at` e `finished_at`: janela temporal da execucao.
- `error`: mensagem de erro quando a execucao falha. Nas evidencias atuais, o campo esta vazio.
- `created_at` e `updated_at`: timestamps de persistencia do registro.

## `benchmark_results.csv`

Cada linha representa um resultado medido para uma execucao especifica. O arquivo contem 84 resultados: 42 para `ring_buffer` e 42 para `inefficient_shift_buffer`, distribuidos igualmente entre os tamanhos `100`, `5000` e `20000`.

Campos principais:

- `id`: identificador do resultado.
- `run_id`: referencia para a execucao registrada em `benchmark_runs.csv`.
- `device_id`: dispositivo que gerou a medicao.
- `strategy`: algoritmo avaliado.
- `sample_count`: tamanho da entrada usada no teste.
- `iterations`: quantidade de repeticoes usadas no cenario.
- `operation`: operacao medida.
- `duration_total_us`: duracao total do cenario em microssegundos.
- `latency_us_avg`: latencia media por iteracao em microssegundos.
- `latency_us_max`: maior latencia observada em microssegundos.
- `free_heap_before_bytes`: heap livre antes do teste.
- `free_heap_after_bytes`: heap livre depois do teste.
- `min_free_heap_bytes`: menor heap livre observado durante o teste.
- `dropped_samples`: amostras descartadas durante a execucao.
- `timestamp_ms`: timestamp emitido pelo firmware.
- `source_topic`: topico MQTT de origem do resultado.
- `created_at`: timestamp de persistencia do registro.

## Como usar estes dados

Use `benchmark_runs.csv` para identificar quais execucoes foram feitas e `benchmark_results.csv` para analisar o desempenho de cada estrategia. A relacao entre os arquivos e feita por `benchmark_runs.id` e `benchmark_results.run_id`.

Estes dados sustentam os graficos em `../graficos/real/` e o relatorio em `../relatorio/final.md`, incluindo a comparacao entre a insercao/remocao O(1) do buffer circular e o custo crescente da estrategia com deslocamento de vetor.
