import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Registry próprio: evita misturar com outros processos no mesmo Node (testes). */
export function createMetrics() {
  const register = new Registry();
  collectDefaultMetrics({ register, prefix: 'orla_' });

  const httpRequests = new Counter({
    name: 'orla_http_requests_total',
    help: 'Requisições HTTP',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [register],
  });

  const assistantAnswers = new Counter({
    name: 'orla_assistant_answers_total',
    help: 'Respostas do assistente por tipo (faq, rag, not_found, blocked, limit, error)',
    labelNames: ['kind'] as const,
    registers: [register],
  });

  const assistantLatency = new Histogram({
    name: 'orla_assistant_latency_seconds',
    help: 'Latência do assistente (embed + busca + LLM)',
    labelNames: ['kind'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
  });

  const queueDepth = new Gauge({
    name: 'orla_queue_depth',
    help: 'Conversas aguardando atendente (status=queued)',
    registers: [register],
  });

  const guardsBlocked = new Counter({
    name: 'orla_guards_blocked_total',
    help: 'Bloqueios das guardas de entrada/saída',
    labelNames: ['stage', 'kind'] as const,
    registers: [register],
  });

  const messages = new Counter({
    name: 'orla_messages_total',
    help: 'Mensagens gravadas',
    labelNames: ['sender'] as const,
    registers: [register],
  });

  return {
    register,
    httpRequests,
    assistantAnswers,
    assistantLatency,
    queueDepth,
    guardsBlocked,
    messages,
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
