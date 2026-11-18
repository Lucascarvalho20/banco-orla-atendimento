import { EMBEDDING_DIMENSIONS, type ChatSource } from '@orla/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export { EMBEDDING_DIMENSIONS };

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- enums
export const agentRole = pgEnum('agent_role', ['agent', 'supervisor']);
export const agentPresence = pgEnum('agent_presence', ['online', 'offline', 'away']);
export const conversationStatus = pgEnum('conversation_status', [
  'ai',
  'queued',
  'offered',
  'active',
  'closed',
  'abandoned',
]);
export const resolvedBy = pgEnum('resolved_by', ['ai', 'agent']);
export const assignmentAction = pgEnum('assignment_action', [
  'offered',
  'accepted',
  'declined',
  'timeout',
  'transferred',
  'requeued',
]);
export const messageSender = pgEnum('message_sender', ['customer', 'ai', 'agent', 'system']);
export const publicationStatus = pgEnum('publication_status', ['rascunho', 'publicado']);

// ---------------------------------------------------------------- atendimento (operacional)
export const topics = pgTable('topics', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: agentRole('role').notNull().default('agent'),
    maxConcurrent: integer('max_concurrent').notNull().default(2),
    createdAt: createdAt(),
  },
  (t) => [check('agents_max_concurrent_positive', sql`${t.maxConcurrent} >= 1`)],
);

export const agentStatus = pgTable(
  'agent_status',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agents.id, { onDelete: 'cascade' }),
    status: agentPresence('status').notNull().default('offline'),
    lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
    activeCount: integer('active_count').notNull().default(0),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_status_active_count_non_negative', sql`${t.activeCount} >= 0`),
    // "atendente online há mais tempo sem receber conversa"
    index('agent_status_available_idx').on(t.status, t.lastAssignedAt.asc().nullsFirst()),
  ],
);

export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    // HMAC-SHA256(cpf, CPF_HMAC_SECRET) em hex — nunca o CPF (ADR 0005)
    cpfHash: char('cpf_hash', { length: 64 }).notNull(),
    cpfLast2: char('cpf_last2', { length: 2 }).notNull(),
    aiQuestionsUsed: integer('ai_questions_used').notNull().default(0),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('customer_sessions_cpf_hash_idx').on(t.cpfHash)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => customerSessions.id),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id),
    status: conversationStatus('status').notNull().default('ai'),
    aiSummary: text('ai_summary'),
    resolvedBy: resolvedBy('resolved_by'),
    priority: integer('priority').notNull().default(0),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    offeredTo: uuid('offered_to').references(() => agents.id),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    agentId: uuid('agent_id').references(() => agents.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    rating: smallint('rating'),
    declineCount: integer('decline_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check('conversations_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
    // Índice PARCIAL: só as conversas na fila entram no índice (pequeno e quente).
    // NULLS FIRST = padrão do Postgres para DESC, igual ao `ORDER BY priority DESC` da fila;
    // se divergir, o índice não serve para ordenar.
    index('conversations_queue_idx')
      .on(t.topicId, t.priority.desc().nullsFirst(), t.queuedAt)
      .where(sql`${t.status} = 'queued'`),
    index('conversations_session_idx').on(t.sessionId),
    // No máximo UMA conversa aberta por sessão (duas abas ao mesmo tempo não criam duas).
    uniqueIndex('conversations_one_open_per_session_uq')
      .on(t.sessionId)
      .where(sql`${t.status} NOT IN ('closed', 'abandoned')`),
  ],
);

export const assignmentLog = pgTable(
  'assignment_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id),
    action: assignmentAction('action').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assignment_log_conversation_idx').on(t.conversationId)],
);

export const cannedResponses = pgTable('canned_responses', {
  id: serial('id').primaryKey(),
  topicId: integer('topic_id').references(() => topics.id),
  shortcut: text('shortcut').notNull().unique(),
  text: text('text').notNull(),
});

/** Chat interno entre atendentes (não misturar com mensagens do cliente). */
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fromAgentId: uuid('from_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('agent_messages_created_idx').on(t.createdAt)],
);

// V1: mensagens e traces no Postgres; na V2 vão para o MongoDB (ADR 0002)
export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    // Gerado no navegador: reenviar a mesma mensagem não duplica (idempotência)
    clientMsgId: uuid('client_msg_id'),
    sender: messageSender('sender').notNull(),
    body: text('body').notNull(),
    sources: jsonb('sources').$type<ChatSource[]>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_conversation_seq_uq').on(t.conversationId, t.seq),
    uniqueIndex('messages_conversation_client_msg_uq').on(t.conversationId, t.clientMsgId),
  ],
);

export const aiTraces = pgTable(
  'ai_traces',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    latencyMs: integer('latency_ms'),
    data: jsonb('data').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ai_traces_conversation_idx').on(t.conversationId)],
);

// ---------------------------------------------------------------- base de conhecimento (pública)
// ÚNICAS tabelas que o usuário de banco `ai_reader` consegue ler (migration de permissões).

export const faq = pgTable(
  'faq',
  {
    id: serial('id').primaryKey(),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    status: publicationStatus('status').notNull().default('rascunho'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('portuguese', question)`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A FAQ é sincronizada a partir de `knowledge/faq.json`: a pergunta é a chave do upsert.
    uniqueIndex('faq_question_uq').on(t.question),
    index('faq_tsv_idx').using('gin', t.tsv),
    index('faq_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const kbDocuments = pgTable('kb_documents', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  sourcePath: text('source_path').notNull().unique(),
  topicId: integer('topic_id').references(() => topics.id),
  status: publicationStatus('status').notNull().default('rascunho'),
  version: integer('version').notNull().default(1),
  // sha256 do conteúdo: só reprocessa o documento se ele mudou
  contentHash: char('content_hash', { length: 64 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    section: text('section').notNull(),
    content: text('content').notNull(),
    tokens: integer('tokens').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(
      sql`to_tsvector('portuguese', section || ' ' || content)`,
    ),
    version: integer('version').notNull(),
  },
  (t) => [
    index('kb_chunks_document_idx').on(t.documentId),
    index('kb_chunks_tsv_idx').using('gin', t.tsv),
    index('kb_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// Perguntas que a IA não soube responder (lacunas da base). Escrita pelo servidor, não pela IA.
export const kbGaps = pgTable('kb_gaps', {
  id: serial('id').primaryKey(),
  questionNormalized: text('question_normalized').notNull().unique(),
  count: integer('count').notNull().default(1),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});
