# 0001 — PostgreSQL para fila e estado

**Status:** aceito

## Contexto

A conversa muda de estado (`ai → queued → offered → active → closed`) e a regra mais importante
é "dois atendentes nunca pegam a mesma conversa". Isso exige atomicidade e consistência.

## Opções

1. **PostgreSQL** (relacional, transações ACID).
2. MongoDB para tudo.
3. Fila em Redis/SQS + banco separado para estado.

## Decisão

PostgreSQL para fila, atendentes, sessões e base de conhecimento.

## Consequências

- ✅ Transação + `FOR UPDATE SKIP LOCKED` resolve a disputa sem outro serviço (ADR 0004).
- ✅ Um banco só na V1 (também guarda os vetores, ADR 0006) = menos coisa para manter.
- ⚠️ Escala de escrita vertical; para este volume (centenas de conversas/min) sobra folga.
