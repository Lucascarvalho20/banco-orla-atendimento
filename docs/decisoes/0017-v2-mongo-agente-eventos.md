# 0017 — V2: Mongo para mensagens/traces, agente com 4 ferramentas, EventBridge/SNS

**Status:** aceito

## Contexto

A V1 publicável usava Postgres para tudo (fila + mensagens + traces). O plano e o ADR 0002
previam mover volume de escrita (mensagens/traces) para Mongo; o ADR 0008 previa as 4
ferramentas; o plano pedia EventBridge/SNS emulados e copiloto.

## Decisão

1. **`MESSAGE_STORE=postgres|mongo`**: mesma interface `MessageStore` / `TraceStoreDb`.
   Fila, sessão, agentes e KB continuam no Postgres (`SKIP LOCKED` + pgvector).
2. **Agente** (`AGENT_TOOLS_ENABLED`): só as 4 ferramentas do ADR 0008; máx. 4 passos;
   IDs de conversa/sessão vêm do servidor.
3. **Eventos**: `conversation.queued|accepted|closed` → EventBridge bus `orla` + SNS
   `orla-eventos` (MiniStack). Sem SNS_TOPIC_ARN = no-op (CI/V1).
4. **Copiloto**: `mesa:copiloto` sugere texto; atendente edita e envia.
5. **Terraform** em `infra/terraform` e **kind** em `infra/k8s` para IaC/K8s de lab.

## Consequências

- ✅ História de entrevista: “isolei atrás de interface; troquei o store sem mudar o chat”.
- ✅ Agência limitada por construção (LLM06).
- ⚠️ Sem transação entre Postgres e Mongo — idempotência via `clientMsgId`.
- ⚠️ MiniStack pode ter suporte parcial a EventBridge; o publisher é best-effort + logs.
