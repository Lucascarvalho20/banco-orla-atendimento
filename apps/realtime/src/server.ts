import { createOllamaChat, createOllamaEmbedder, runAgentTurn, simulatePixLimit } from '@orla/ai';
import {
  appendMessage,
  buildTriageSummary,
  connectMongo,
  countQueued,
  createCustomerSession,
  createDb,
  databaseUrlForRole,
  enqueueConversation,
  findActiveSession,
  findClosestFaq,
  getConversationStatus,
  listMessages,
  mongoMessageStore,
  mongoTraceStore,
  openConversation,
  postgresMessageStore,
  postgresTraceStore,
  searchChunks,
  type MessageStore,
  type TraceStoreDb,
} from '@orla/db';
import { postgresAgentStore } from './agents.js';
import { buildApp } from './app.js';
import { createAssistant } from './assistant.js';
import { loadEnv } from './env.js';
import { createAwsEventPublisher, noopEventPublisher } from './events.js';
import { createMetrics } from './metrics.js';

try {
  process.loadEnvFile('../../.env');
} catch {
  // Sem .env local (ex.: CI ou container): as variáveis vêm do ambiente.
}

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const reader = createDb(databaseUrlForRole(env.DATABASE_URL, 'ai_reader', env.AI_READER_PASSWORD), {
  max: 5,
});

let mongoClient: Awaited<ReturnType<typeof connectMongo>>['client'] | null = null;
let messages: MessageStore = postgresMessageStore(db);
let traces: TraceStoreDb = postgresTraceStore(db);

if (env.MESSAGE_STORE === 'mongo') {
  const mongo = await connectMongo(env.MONGODB_URL);
  mongoClient = mongo.client;
  messages = mongoMessageStore(mongo.db);
  traces = mongoTraceStore(mongo.db);
}

const events =
  env.AWS_ENDPOINT_URL && env.SNS_TOPIC_ARN
    ? createAwsEventPublisher({
        endpoint: env.AWS_ENDPOINT_URL,
        region: env.AWS_REGION,
        eventBusName: env.EVENT_BUS_NAME,
        snsTopicArn: env.SNS_TOPIC_ARN,
      })
    : noopEventPublisher;

const metrics = createMetrics();

const llm = createOllamaChat({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_CHAT_MODEL,
  timeoutMs: 30_000,
});
const embedder = createOllamaEmbedder({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_EMBED_MODEL,
  timeoutMs: 8_000,
});

const onTraceError = { handler: (_error: unknown) => undefined as void };

const runAgent = env.AGENT_TOOLS_ENABLED
  ? async (question: string, { conversationId }: { conversationId: string }) => {
      const turn = await runAgentTurn({
        question,
        llm,
        tools: {
          buscar_base: async ({ pergunta }: { pergunta: string }) => {
            const [embedding] = await embedder.embedQueries([pergunta]);
            const chunks = await searchChunks(reader.db, {
              embedding: embedding!,
              query: pergunta,
            });
            if (!chunks.length) return 'Nenhum trecho encontrado na base.';
            return chunks
              .slice(0, 4)
              .map((c) => `[${c.chunkId}] ${c.title} › ${c.section}\n${c.content}`)
              .join('\n\n');
          },
          simular_limite_pix: async (args: { valorReais: number; hora?: number | undefined }) =>
            simulatePixLimit(args.valorReais, args.hora ?? new Date().getHours()),
          status_da_fila: async () => {
            const status = await getConversationStatus(db, conversationId);
            const depth = await countQueued(db);
            return `Status desta conversa: ${status}. Pessoas na fila agora: ${depth}.`;
          },
          chamar_atendente: async ({ resumo }: { resumo: string }) => {
            const recent = await messages.listRecent(conversationId, 8);
            const summary = resumo || (await buildTriageSummary(db, conversationId, { recent }));
            const result = await enqueueConversation(db, { conversationId, summary });
            const position = result.status === 'queued' ? await countQueued(db) : 1;
            metrics.queueDepth.set(await countQueued(db));
            await events.publish({
              type: 'conversation.queued',
              conversationId,
              position,
              at: new Date().toISOString(),
            });
            return result.alreadyInQueue
              ? `A conversa já estava na fila (posição ~${position}).`
              : `Conversa enfileirada (posição ~${position}).`;
          },
        },
      });
      await traces
        .record({
          conversationId,
          promptVersion: 'agent-v1',
          model: llm.model,
          latencyMs: 0,
          data: { kind: turn.kind, steps: turn.steps, toolsUsed: turn.toolsUsed },
        })
        .catch(() => undefined);
      if (turn.kind === 'answered') return { kind: 'rag' as const, body: turn.body, sources: [] };
      if (turn.kind === 'blocked') return { kind: 'blocked' as const };
      return null;
    }
  : undefined;

const assistant = createAssistant({
  embedder,
  llm,
  findClosestFaq: (embedding) => findClosestFaq(reader.db, embedding),
  searchChunks: (input) => searchChunks(reader.db, input),
  traces: {
    countRag: (conversationId) => traces.countByPromptPrefix(conversationId, 'rag-'),
    record: (trace) => traces.record(trace),
  },
  faqMinSimilarity: env.FAQ_MIN_SIMILARITY,
  ragMaxPerConversation: env.RAG_MAX_PER_CONVERSATION,
  ...(runAgent ? { runAgent } : {}),
  onTraceError: (error) => onTraceError.handler(error),
});

const app = await buildApp(env, {
  assistant,
  agents: postgresAgentStore(db),
  metrics,
  events,
  llm,
  messageStore: messages,
  sessions: {
    create: (data) => createCustomerSession(db, data),
    findActive: (id) => findActiveSession(db, id),
  },
  chat: {
    openConversation: (input) =>
      openConversation(db, {
        ...input,
        ...(env.MESSAGE_STORE === 'mongo'
          ? {
              writeWelcome: async (id: string, welcome: string) => {
                await messages.append({
                  conversationId: id,
                  clientMsgId: null,
                  sender: 'system',
                  body: welcome,
                });
              },
            }
          : {}),
      }),
    appendMessage: (input) =>
      env.MESSAGE_STORE === 'mongo' ? messages.append(input) : appendMessage(db, input),
    listMessages: (conversationId, afterSeq) =>
      env.MESSAGE_STORE === 'mongo'
        ? messages.list(conversationId, afterSeq)
        : listMessages(db, conversationId, afterSeq),
    isAiHandling: async (conversationId) =>
      (await getConversationStatus(db, conversationId)) === 'ai',
    enqueueForHuman: async (conversationId) => {
      const recent = await messages.listRecent(conversationId, 8);
      const summary = await buildTriageSummary(db, conversationId, { recent });
      const result = await enqueueConversation(db, { conversationId, summary });
      const position = result.status === 'queued' ? await countQueued(db) : 1;
      metrics.queueDepth.set(await countQueued(db));
      await events.publish({
        type: 'conversation.queued',
        conversationId,
        position,
        at: new Date().toISOString(),
      });
      return { alreadyInQueue: result.alreadyInQueue, position, status: result.status };
    },
  },
});

onTraceError.handler = (error) => app.log.error({ err: error }, 'falha ao gravar trace da IA');

const queuePoll = setInterval(() => {
  countQueued(db)
    .then((n) => metrics.queueDepth.set(n))
    .catch((error) => app.log.error({ err: error }, 'falha ao medir fila'));
}, 10_000);

app.addHook('onClose', async () => {
  clearInterval(queuePoll);
  await Promise.all([pool.end(), reader.pool.end(), mongoClient?.close() ?? Promise.resolve()]);
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'encerrando');
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: env.REALTIME_PORT, host: '127.0.0.1' });
app.log.info(
  {
    messageStore: env.MESSAGE_STORE,
    agentTools: env.AGENT_TOOLS_ENABLED,
    events: Boolean(env.SNS_TOPIC_ARN),
  },
  'realtime no ar (V2 flags)',
);
