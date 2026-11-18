import { createOllamaChat, createOllamaEmbedder } from '@orla/ai';
import {
  appendMessage,
  buildTriageSummary,
  countAiTraces,
  countQueued,
  createCustomerSession,
  createDb,
  databaseUrlForRole,
  enqueueConversation,
  findActiveSession,
  findClosestFaq,
  getConversationStatus,
  listMessages,
  openConversation,
  recordAiTrace,
  searchChunks,
} from '@orla/db';
import { postgresAgentStore } from './agents.js';
import { buildApp } from './app.js';
import { createAssistant } from './assistant.js';
import { loadEnv } from './env.js';
import { createMetrics } from './metrics.js';

try {
  process.loadEnvFile('../../.env');
} catch {
  // Sem .env local (ex.: CI ou container): as variáveis vêm do ambiente.
}

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
// A IA lê a base de conhecimento com o usuário só-leitura (ADR 0007), em outro pool.
const reader = createDb(databaseUrlForRole(env.DATABASE_URL, 'ai_reader', env.AI_READER_PASSWORD), {
  max: 5,
});

const assistant = createAssistant({
  embedder: createOllamaEmbedder({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_EMBED_MODEL,
    // O cliente está esperando: melhor avisar "instabilidade" do que deixar a tela parada.
    timeoutMs: 8_000,
  }),
  llm: createOllamaChat({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_CHAT_MODEL,
    // Primeira chamada carrega o modelo na GPU (alguns segundos); depois, ~1 s.
    timeoutMs: 30_000,
  }),
  findClosestFaq: (embedding) => findClosestFaq(reader.db, embedding),
  searchChunks: (input) => searchChunks(reader.db, input),
  // Traces são dados operacionais: gravados pelo dono do banco, não pelo ai_reader.
  traces: {
    countRag: (conversationId) => countAiTraces(db, conversationId, 'rag-'),
    record: (trace) => recordAiTrace(db, trace),
  },
  faqMinSimilarity: env.FAQ_MIN_SIMILARITY,
  ragMaxPerConversation: env.RAG_MAX_PER_CONVERSATION,
  onTraceError: (error) => app.log.error({ err: error }, 'falha ao gravar trace da IA'),
});

const metrics = createMetrics();

const app = await buildApp(env, {
  assistant,
  agents: postgresAgentStore(db),
  metrics,
  sessions: {
    create: (data) => createCustomerSession(db, data),
    findActive: (id) => findActiveSession(db, id),
  },
  chat: {
    openConversation: (input) => openConversation(db, input),
    appendMessage: (input) => appendMessage(db, input),
    listMessages: (conversationId, afterSeq) => listMessages(db, conversationId, afterSeq),
    isAiHandling: async (conversationId) =>
      (await getConversationStatus(db, conversationId)) === 'ai',
    enqueueForHuman: async (conversationId) => {
      const summary = await buildTriageSummary(db, conversationId);
      const result = await enqueueConversation(db, { conversationId, summary });
      const position = result.status === 'queued' ? await countQueued(db) : 1;
      metrics.queueDepth.set(await countQueued(db));
      return { alreadyInQueue: result.alreadyInQueue, position, status: result.status };
    },
  },
});

const queuePoll = setInterval(() => {
  countQueued(db)
    .then((n) => metrics.queueDepth.set(n))
    .catch((error) => app.log.error({ err: error }, 'falha ao medir fila'));
}, 10_000);

app.addHook('onClose', async () => {
  clearInterval(queuePoll);
  await Promise.all([pool.end(), reader.pool.end()]);
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'encerrando');
    // Se alguma conexão travar o fechamento, o orquestrador (Docker/K8s) mataria o processo de
    // qualquer jeito; sair antes, com código de erro, deixa isso visível nos logs.
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: env.REALTIME_PORT, host: '127.0.0.1' });
