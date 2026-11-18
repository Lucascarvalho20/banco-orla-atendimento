import type { ChatMessage, ChatSource, MessageSender, TopicSlug } from '@orla/shared';
import { and, asc, count, eq, gt, like, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { aiTraces, conversations, messages, topics } from './schema.js';

const OPEN = notInArray(conversations.status, ['closed', 'abandoned']);

const messageColumns = {
  seq: messages.seq,
  clientMsgId: messages.clientMsgId,
  sender: messages.sender,
  body: messages.body,
  sources: messages.sources,
  createdAt: messages.createdAt,
};

type MessageRow = Omit<ChatMessage, 'createdAt' | 'sources'> & {
  sources: ChatSource[] | null;
  createdAt: Date;
};
const toChatMessage = ({ sources, createdAt, ...row }: MessageRow): ChatMessage => ({
  ...row,
  ...(sources?.length ? { sources } : {}),
  createdAt: createdAt.toISOString(),
});

/**
 * Devolve a conversa aberta da sessão ou cria uma (com mensagem de boas-vindas).
 * Duas abas ao mesmo tempo: o índice único parcial deixa só uma criar; a outra reaproveita.
 *
 * `writeWelcome` (V2/Mongo): grava a boas-vindas fora do Postgres — não há transação entre bancos.
 */
export async function openConversation(
  db: Database,
  input: {
    sessionId: string;
    topic: TopicSlug;
    welcome: string;
    priority?: number;
    writeWelcome?: (conversationId: string, welcome: string) => Promise<void>;
  },
): Promise<{ id: string; created: boolean }> {
  const findOpen = async () => {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.sessionId, input.sessionId), OPEN));
    return row;
  };

  const existing = await findOpen();
  if (existing) return { id: existing.id, created: false };

  const created = await db.transaction(async (tx) => {
    const [topic] = await tx
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.slug, input.topic));
    if (!topic) throw new Error(`Assunto não cadastrado: ${input.topic}`);

    const [row] = await tx
      .insert(conversations)
      .values({
        sessionId: input.sessionId,
        topicId: topic.id,
        priority: input.priority ?? 0,
      })
      .onConflictDoNothing()
      .returning({ id: conversations.id });

    if (!row) {
      // Outra aba criou no mesmo instante: usa a dela.
      const [other] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.sessionId, input.sessionId), OPEN));
      return { id: other!.id, created: false as const };
    }

    if (!input.writeWelcome) {
      await tx
        .insert(messages)
        .values({ conversationId: row.id, seq: 1, sender: 'system', body: input.welcome });
    }
    return { id: row.id, created: true as const };
  });

  if (created.created && input.writeWelcome) {
    await input.writeWelcome(created.id, input.welcome);
  }
  return created;
}

/**
 * Grava uma mensagem com a próxima `seq`. Idempotente: o mesmo `clientMsgId` devolve a mensagem
 * já gravada (`duplicate: true`) em vez de criar outra.
 */
export async function appendMessage(
  db: Database,
  input: {
    conversationId: string;
    clientMsgId: string | null;
    sender: MessageSender;
    body: string;
    sources?: ChatSource[] | undefined;
  },
): Promise<{ message: ChatMessage; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    // Trava SÓ esta conversa até o fim da transação: duas mensagens simultâneas dela
    // esperam uma pela outra (e não pegam a mesma seq). Outras conversas não são afetadas.
    await tx.execute(
      sql`SELECT 1 FROM ${conversations} WHERE ${conversations.id} = ${input.conversationId} FOR UPDATE`,
    );

    if (input.clientMsgId) {
      const [already] = await tx
        .select(messageColumns)
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, input.conversationId),
            eq(messages.clientMsgId, input.clientMsgId),
          ),
        );
      if (already) return { message: toChatMessage(already), duplicate: true };
    }

    const [row] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        clientMsgId: input.clientMsgId,
        sender: input.sender,
        body: input.body,
        sources: input.sources?.length ? input.sources : null,
        seq: sql`(SELECT COALESCE(MAX(${messages.seq}), 0) + 1 FROM ${messages} WHERE ${messages.conversationId} = ${input.conversationId})`,
      })
      .returning(messageColumns);
    return { message: toChatMessage(row!), duplicate: false };
  });
}

/** Mensagens com `seq` maior que `afterSeq` (reconexão: só o que o navegador ainda não tem). */
export async function listMessages(
  db: Database,
  conversationId: string,
  afterSeq = 0,
  limit = 200,
): Promise<ChatMessage[]> {
  const rows = await db
    .select(messageColumns)
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.seq, afterSeq)))
    .orderBy(asc(messages.seq))
    .limit(limit);
  return rows.map(toChatMessage);
}

export interface NewAiTrace {
  conversationId: string;
  promptVersion: string;
  model: string;
  latencyMs: number;
  /** Só números e ids: o texto da pergunta e da resposta NÃO entra aqui (pode ter dado pessoal). */
  data: Record<string, unknown>;
}

export async function recordAiTrace(db: Database, trace: NewAiTrace): Promise<void> {
  await db.insert(aiTraces).values(trace);
}

/** Quantas chamadas com prompt desta família (ex.: `rag-`) a conversa já fez. */
export async function countAiTraces(
  db: Database,
  conversationId: string,
  promptVersionPrefix: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(aiTraces)
    .where(
      and(
        eq(aiTraces.conversationId, conversationId),
        like(aiTraces.promptVersion, `${promptVersionPrefix}%`),
      ),
    );
  return row?.total ?? 0;
}
