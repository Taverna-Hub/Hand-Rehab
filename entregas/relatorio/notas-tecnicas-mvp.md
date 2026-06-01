# Notas tecnicas para relatorio

## Analise assintotica

O Ring Buffer usa capacidade fixa e mantem dois indices: `head` para escrita e `tail` para leitura. Insercao e remocao sao O(1). Quando o buffer esta cheio, a amostra e descartada e `dropped_samples` e incrementado.

A estrategia ineficiente comparativa usa vetor fixo e desloca todos os elementos na remocao do primeiro item. A insercao e O(1) enquanto houver espaco, mas a remocao e O(n). Ela existe para comparacao academica e nao e usada como padrao de producao.

## Diagnostico de memoria

O Ring Buffer evita realocacao durante a sessao porque a memoria e reservada de forma estatica. O firmware registra `free_heap_bytes` e `min_free_heap_bytes` nos batches para acompanhar impacto de memoria ao longo da execucao.

## Produtor-consumidor e rede

As ISRs de botao apenas inserem eventos em fila FreeRTOS. Tasks consumidoras publicam realtime e copiam os dados para o buffer de batch. A publicacao realtime usa fila MQTT para reduzir acoplamento com a task de leitura. Batches sao publicados por uma task separada e enviados de forma assincrona ao backend pelo Node-RED.
