# 0002 — MongoDB para mensagens e traces da IA (V2)

**Status:** aceito para a V2 · na V1 usamos tabela `messages` + `ai_traces` (JSONB) no Postgres

## Contexto

Mensagens e traces da IA (pergunta, trechos usados, resposta, tokens, latência) são muito volume,
só de inserção, com formato que muda conforme evoluímos o pipeline.

## Opções

1. **JSONB no Postgres** — simples, um banco só.
2. **MongoDB** — documento flexível, escala horizontal de escrita, TTL nativo para retenção.

## Decisão

V1: JSONB no Postgres (menos infraestrutura, publicamos mais rápido).
V2: mover mensagens e traces para MongoDB, mantendo a mesma interface `MessageStore`.

## Consequências

- ✅ V1 sobe com um `docker compose up`.
- ✅ A troca na V2 vira uma boa história de entrevista: "isolei o acesso atrás de uma interface,
  então trocar o armazenamento não tocou na regra de negócio".
- ⚠️ Na V2 surgem dois bancos: não dá para ter transação entre Postgres e Mongo; a mensagem é
  gravada com `clientMsgId` único (idempotente) para tolerar reenvio.
