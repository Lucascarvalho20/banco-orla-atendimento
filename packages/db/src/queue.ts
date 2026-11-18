import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  agentStatus,
  agents,
  assignmentLog,
  conversations,
  customerSessions,
  messages,
  topics,
} from './schema.js';

export type QueueConversation = {
  id: string;
  topicSlug: string;
  topicName: string;
  displayName: string;
  cpfLast2: string;
  aiSummary: string | null;
  priority: number;
  queuedAt: Date | null;
  status: 'queued' | 'offered' | 'active';
  offeredTo: string | null;
  agentId: string | null;
  agentName: string | null;
};

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'supervisor';
  status: 'online' | 'offline' | 'away';
  activeCount: number;
};

/**
 * Coloca a conversa na fila humana. Idempotente se já estiver queued/offered/active.
 * `aiSummary` = contexto da triagem para o atendente (assunto + últimas falas).
 */
export async function enqueueConversation(
  db: Database,
  input: { conversationId: string; summary: string; priority?: number },
): Promise<{ status: 'queued' | 'offered' | 'active'; alreadyInQueue: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: conversations.id,
        status: conversations.status,
        priority: conversations.priority,
      })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for('update');

    if (!row) throw new Error('conversa_nao_encontrada');
    if (row.status === 'queued' || row.status === 'offered' || row.status === 'active') {
      return { status: row.status, alreadyInQueue: true };
    }
    if (row.status !== 'ai') throw new Error(`status_invalido:${row.status}`);

    await tx
      .update(conversations)
      .set({
        status: 'queued',
        aiSummary: input.summary,
        // Preferencial já veio na abertura da conversa; não zerar ao enfileirar.
        priority: input.priority ?? row.priority,
        queuedAt: new Date(),
        offeredTo: null,
        offeredAt: null,
        agentId: null,
      })
      .where(eq(conversations.id, input.conversationId));

    return { status: 'queued' as const, alreadyInQueue: false };
  });
}

/**
 * Monta um resumo curto a partir do histórico (sem chamar a IA — determinístico e barato).
 * O atendente ainda vê o chat completo; isso é o "cartão" da triagem.
 */
export async function buildTriageSummary(db: Database, conversationId: string): Promise<string> {
  const [meta] = await db
    .select({
      topic: topics.name,
      displayName: customerSessions.displayName,
    })
    .from(conversations)
    .innerJoin(topics, eq(topics.id, conversations.topicId))
    .innerJoin(customerSessions, eq(customerSessions.id, conversations.sessionId))
    .where(eq(conversations.id, conversationId));

  const recent = await db
    .select({ sender: messages.sender, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(sql`${messages.seq} desc`)
    .limit(8);

  const lines = recent
    .reverse()
    .filter((m) => m.sender === 'customer' || m.sender === 'ai' || m.sender === 'system')
    .map((m) => {
      const who = m.sender === 'customer' ? 'Cliente' : m.sender === 'ai' ? 'IA' : 'Sistema';
      const body = m.body.length > 160 ? `${m.body.slice(0, 157)}…` : m.body;
      return `${who}: ${body}`;
    });

  return [
    `Assunto: ${meta?.topic ?? '?'} · Cliente: ${meta?.displayName ?? '?'}`,
    'Últimas mensagens:',
    ...lines,
  ].join('\n');
}

/**
 * Oferece a próxima conversa da fila ao atendente (ADR 0004).
 * `FOR UPDATE SKIP LOCKED`: se outro atendente já travou a linha, este pula e pega a seguinte.
 * Critério do atendente: online, com vaga (`active_count < max_concurrent`), há mais tempo sem receber.
 */
export async function offerNextConversation(
  db: Database,
  agentId: string,
): Promise<QueueConversation | null> {
  return db.transaction(async (tx) => {
    const [agent] = await tx
      .select({
        id: agents.id,
        maxConcurrent: agents.maxConcurrent,
        status: agentStatus.status,
        activeCount: agentStatus.activeCount,
      })
      .from(agents)
      .innerJoin(agentStatus, eq(agentStatus.agentId, agents.id))
      .where(eq(agents.id, agentId))
      .for('update', { of: agentStatus });

    if (!agent || agent.status !== 'online') return null;
    if (agent.activeCount >= agent.maxConcurrent) return null;

    // Reserva uma conversa queued (pula as que outro processo já travou — ADR 0004).
    const [claimed] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.status, 'queued'))
      .orderBy(sql`${conversations.priority} DESC NULLS FIRST`, asc(conversations.queuedAt))
      .limit(1)
      .for('update', { skipLocked: true });

    if (!claimed) return null;

    await tx
      .update(conversations)
      .set({
        status: 'offered',
        offeredTo: agentId,
        offeredAt: new Date(),
      })
      .where(eq(conversations.id, claimed.id));

    await tx.insert(assignmentLog).values({
      conversationId: claimed.id,
      agentId,
      action: 'offered',
    });

    await tx
      .update(agentStatus)
      .set({ lastAssignedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentStatus.agentId, agentId));

    return loadQueueConversation(tx, claimed.id);
  });
}

/**
 * Pega uma pendência específica da fila (botão "Atender" na mesa).
 * Vai de `queued` → `active` em um passo, com SKIP LOCKED naquela linha.
 */
export async function claimQueuedConversation(
  db: Database,
  input: { conversationId: string; agentId: string },
): Promise<QueueConversation> {
  return db.transaction(async (tx) => {
    const [agent] = await tx
      .select({
        id: agents.id,
        maxConcurrent: agents.maxConcurrent,
        status: agentStatus.status,
        activeCount: agentStatus.activeCount,
      })
      .from(agents)
      .innerJoin(agentStatus, eq(agentStatus.agentId, agents.id))
      .where(eq(agents.id, input.agentId))
      .for('update', { of: agentStatus });

    if (!agent || agent.status !== 'online') throw new Error('atendente_indisponivel');
    if (agent.activeCount >= agent.maxConcurrent) throw new Error('atendente_indisponivel');

    const [row] = await tx
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.status, 'queued')))
      .for('update', { skipLocked: true });

    if (!row) throw new Error('oferta_invalida');

    await tx
      .update(conversations)
      .set({
        status: 'active',
        agentId: input.agentId,
        startedAt: new Date(),
        offeredTo: null,
        offeredAt: null,
      })
      .where(eq(conversations.id, input.conversationId));

    await tx
      .update(agentStatus)
      .set({
        activeCount: agent.activeCount + 1,
        lastAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentStatus.agentId, input.agentId));

    await tx.insert(assignmentLog).values({
      conversationId: input.conversationId,
      agentId: input.agentId,
      action: 'accepted',
    });

    return (await loadQueueConversation(tx, input.conversationId))!;
  });
}

/** Atendente aceita a oferta → conversa ativa. */
export async function acceptOffer(
  db: Database,
  input: { conversationId: string; agentId: string },
): Promise<QueueConversation> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for('update');

    if (!row || row.status !== 'offered' || row.offeredTo !== input.agentId) {
      throw new Error('oferta_invalida');
    }

    const [agent] = await tx
      .select({
        maxConcurrent: agents.maxConcurrent,
        activeCount: agentStatus.activeCount,
        status: agentStatus.status,
      })
      .from(agents)
      .innerJoin(agentStatus, eq(agentStatus.agentId, agents.id))
      .where(eq(agents.id, input.agentId))
      .for('update', { of: agentStatus });

    if (!agent || agent.status !== 'online' || agent.activeCount >= agent.maxConcurrent) {
      throw new Error('atendente_indisponivel');
    }

    await tx
      .update(conversations)
      .set({
        status: 'active',
        agentId: input.agentId,
        startedAt: new Date(),
        offeredTo: null,
        offeredAt: null,
      })
      .where(eq(conversations.id, input.conversationId));

    await tx
      .update(agentStatus)
      .set({
        activeCount: agent.activeCount + 1,
        lastAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentStatus.agentId, input.agentId));

    await tx.insert(assignmentLog).values({
      conversationId: input.conversationId,
      agentId: input.agentId,
      action: 'accepted',
    });

    return (await loadQueueConversation(tx, input.conversationId))!;
  });
}

/** Recusa ou timeout → volta para a fila (outro atendente pode pegar). */
export async function releaseOffer(
  db: Database,
  input: { conversationId: string; agentId: string; reason: 'declined' | 'timeout' },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for('update');

    if (!row || row.status !== 'offered' || row.offeredTo !== input.agentId) return;

    await tx
      .update(conversations)
      .set({
        status: 'queued',
        offeredTo: null,
        offeredAt: null,
        declineCount: row.declineCount + (input.reason === 'declined' ? 1 : 0),
      })
      .where(eq(conversations.id, input.conversationId));

    await tx.insert(assignmentLog).values({
      conversationId: input.conversationId,
      agentId: input.agentId,
      action: input.reason,
    });
  });
}

/** Encerra o atendimento e libera a vaga do atendente dono. Supervisor pode encerrar qualquer ativa. */
export async function closeConversation(
  db: Database,
  input: { conversationId: string; agentId: string; asSupervisor?: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for('update');

    if (!row || row.status !== 'active' || !row.agentId) {
      throw new Error('conversa_invalida');
    }
    if (!input.asSupervisor && row.agentId !== input.agentId) {
      throw new Error('conversa_invalida');
    }

    const ownerId = row.agentId;

    await tx
      .update(conversations)
      .set({
        status: 'closed',
        resolvedBy: 'agent',
        closedAt: new Date(),
      })
      .where(eq(conversations.id, input.conversationId));

    await tx
      .update(agentStatus)
      .set({
        activeCount: sql`GREATEST(${agentStatus.activeCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(agentStatus.agentId, ownerId));
  });
}

export async function setAgentPresence(
  db: Database,
  agentId: string,
  status: 'online' | 'offline' | 'away',
): Promise<void> {
  await db
    .update(agentStatus)
    .set({ status, updatedAt: new Date(), lastHeartbeatAt: new Date() })
    .where(eq(agentStatus.agentId, agentId));
}

const agentColumns = {
  id: agents.id,
  name: agents.name,
  email: agents.email,
  passwordHash: agents.passwordHash,
  role: agents.role,
  maxConcurrent: agents.maxConcurrent,
};

export async function findAgentByEmail(db: Database, email: string) {
  const [row] = await db
    .select(agentColumns)
    .from(agents)
    .where(eq(agents.email, email.toLowerCase()));
  return row;
}

export async function findAgentById(db: Database, id: string) {
  const [row] = await db.select(agentColumns).from(agents).where(eq(agents.id, id));
  return row;
}

export async function getAgentPresence(db: Database, agentId: string) {
  const [row] = await db.select().from(agentStatus).where(eq(agentStatus.agentId, agentId));
  return row;
}

export async function listAgentActive(db: Database, agentId: string): Promise<QueueConversation[]> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.agentId, agentId), eq(conversations.status, 'active')))
    .orderBy(asc(conversations.startedAt));
  const out: QueueConversation[] = [];
  for (const r of rows) {
    const loaded = await loadQueueConversation(db, r.id);
    if (loaded) out.push(loaded);
  }
  return out;
}

export async function getConversationStatus(
  db: Database,
  conversationId: string,
): Promise<(typeof conversations.$inferSelect)['status'] | undefined> {
  const [row] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  return row?.status;
}

export async function countQueued(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.status, 'queued'));
  return row?.n ?? 0;
}

/** Equipe: quem está online/offline e quantas conversas ativas. */
export async function listTeamPresence(db: Database): Promise<TeamMemberRow[]> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      email: agents.email,
      role: agents.role,
      status: agentStatus.status,
      activeCount: agentStatus.activeCount,
    })
    .from(agents)
    .innerJoin(agentStatus, eq(agentStatus.agentId, agents.id))
    .orderBy(asc(agents.name));
  return rows;
}

/** Conversas na fila (pendentes), mais urgentes primeiro. */
export async function listQueuedConversations(
  db: Database,
  limit = 30,
): Promise<QueueConversation[]> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.status, 'queued'))
    .orderBy(sql`${conversations.priority} DESC NULLS FIRST`, asc(conversations.queuedAt))
    .limit(limit);
  const out: QueueConversation[] = [];
  for (const r of rows) {
    const loaded = await loadQueueConversation(db, r.id);
    if (loaded) out.push(loaded);
  }
  return out;
}

/** Todas as conversas ativas (mesa: ver quem atende quem). */
export async function listAllActiveConversations(db: Database): Promise<QueueConversation[]> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.status, 'active'))
    .orderBy(asc(conversations.startedAt));
  const out: QueueConversation[] = [];
  for (const r of rows) {
    const loaded = await loadQueueConversation(db, r.id);
    if (loaded) out.push(loaded);
  }
  return out;
}

export async function loadDeskConversation(
  db: Database,
  conversationId: string,
): Promise<QueueConversation | null> {
  return loadQueueConversation(db, conversationId);
}

/** Ofertas vencidas (servidor é a fonte da verdade do timeout de 30 s). */
export async function expireStaleOffers(db: Database, olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ id: conversations.id, offeredTo: conversations.offeredTo })
    .from(conversations)
    .where(and(eq(conversations.status, 'offered'), lt(conversations.offeredAt, cutoff)));

  for (const row of stale) {
    if (!row.offeredTo) continue;
    await releaseOffer(db, {
      conversationId: row.id,
      agentId: row.offeredTo,
      reason: 'timeout',
    });
  }
  return stale.length;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function loadQueueConversation(
  db: Database | Tx,
  conversationId: string,
): Promise<QueueConversation | null> {
  const [row] = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      aiSummary: conversations.aiSummary,
      priority: conversations.priority,
      queuedAt: conversations.queuedAt,
      offeredTo: conversations.offeredTo,
      agentId: conversations.agentId,
      topicSlug: topics.slug,
      topicName: topics.name,
      displayName: customerSessions.displayName,
      cpfLast2: customerSessions.cpfLast2,
      agentName: agents.name,
    })
    .from(conversations)
    .innerJoin(topics, eq(topics.id, conversations.topicId))
    .innerJoin(customerSessions, eq(customerSessions.id, conversations.sessionId))
    .leftJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(conversations.id, conversationId));

  if (!row) return null;
  if (row.status !== 'queued' && row.status !== 'offered' && row.status !== 'active') return null;

  return {
    id: row.id,
    topicSlug: row.topicSlug,
    topicName: row.topicName,
    displayName: row.displayName,
    cpfLast2: row.cpfLast2,
    aiSummary: row.aiSummary,
    priority: row.priority,
    queuedAt: row.queuedAt,
    status: row.status,
    offeredTo: row.offeredTo,
    agentId: row.agentId,
    agentName: row.agentName,
  };
}
