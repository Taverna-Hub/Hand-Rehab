# Buffer Circular e estrategia ineficiente

O fluxo oficial de persistencia usa batches montados no firmware. Cada amostra capturada e enviada em tempo real tambem e copiada para um buffer local de persistencia.

## Ring Buffer

A estrategia eficiente usa um Ring Buffer de capacidade fixa:

- `head` aponta para a proxima posicao de escrita.
- `tail` aponta para a proxima posicao de leitura.
- Insercao e remocao sao O(1).
- Quando cheio, o buffer contabiliza `dropped_samples`.
- A capacidade fixa evita realocacao durante a sessao.

## Estrategia ineficiente

A estrategia comparativa usa deslocamento de elementos em vetor fixo. Ao remover o primeiro item, os demais itens sao copiados uma posicao para a esquerda, gerando custo O(n). Ela existe para analise academica e nao e a estrategia padrao de publicacao.

## Metadados coletados

Cada batch inclui `performance` com:

- `insert_latency_us_avg`
- `insert_latency_us_max`
- `mqtt_publish_latency_us`
- `free_heap_bytes`
- `min_free_heap_bytes`
- `buffer_capacity`
- `buffer_used`
- `dropped_samples`

Esses campos permitem comparar latencia, heap e perdas entre as estrategias.
