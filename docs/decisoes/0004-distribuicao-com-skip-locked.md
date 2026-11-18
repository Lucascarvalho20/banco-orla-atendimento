# 0004 — Distribuição com `FOR UPDATE SKIP LOCKED`

**Status:** aceito

## Contexto

Dois atendentes podem clicar em "próxima" no mesmo milissegundo. Sem proteção, os dois leem a
mesma linha `queued` e ambos a assumem (condição de corrida).

## Opções

1. `SELECT ... FOR UPDATE` simples — correto, mas o segundo atendente fica **esperando** o lock.
2. **`FOR UPDATE SKIP LOCKED`** — o segundo pula a linha travada e pega a próxima.
3. Fila externa (Redis `BRPOPLPUSH`, SQS) — mais um sistema e o estado fica dividido.
4. Lock otimista (`UPDATE ... WHERE status='queued'` e checar linhas afetadas) — funciona, mas gera
   muitas tentativas perdidas sob disputa.

## Decisão

`SKIP LOCKED` dentro de uma transação, ordenando por `priority DESC, queued_at`.

## Consequências

- ✅ Zero duplicidade e sem fila de espera entre atendentes.
- ✅ Provado por teste: 50 atribuições em paralelo contra Postgres real (Testcontainers).
- ⚠️ A ordem não é estritamente FIFO sob disputa (uma linha travada é pulada momentaneamente) —
  aceitável para atendimento.
