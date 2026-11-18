# 0013 — Observabilidade: logs estruturados, CloudWatch emulado, Prometheus e Grafana

**Status:** aceito

## Contexto

As vagas pedem "investigar falhas com base em logs, métricas e evidências". Um sistema com IA
precisa responder: a IA está lenta? Está dizendo "não sei" demais? A fila está crescendo?

## Decisão

- **Logs** JSON (pino) com `requestId`/`conversationId` em todas as linhas, CPF/segredos mascarados.
  A Lambda de ingestão escreve no **CloudWatch Logs** (emulado).
- **Métricas** expostas em `/metrics` (Prometheus): latência da IA por etapa, taxa de "não sei",
  tamanho da fila, tempo de espera, ataques bloqueados.
- **Grafana** local com um painel versionado no repositório (provisionado automaticamente).
- Alarme de exemplo no CloudWatch (DLQ com mensagens > 0).

## Alternativas

- Só CloudWatch — fiel às vagas, mas o emulador não tem painel visual.
- OpenTelemetry completo + Jaeger — mais poderoso, mas é muita peça para este tamanho (fica como evolução).

## Consequências

- ✅ Painel bonito e real para o GIF/vídeo do LinkedIn.
- ✅ Material concreto para a pergunta "como você investigaria um incidente?".
- ⚠️ Mais 2 containers (Prometheus e Grafana), só no perfil `obs` do Compose.
