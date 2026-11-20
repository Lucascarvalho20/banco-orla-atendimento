import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './client.js';
import { runMigrations } from './migrate.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  acceptOffer,
  enqueueConversation,
  listQueuedConversations,
  offerNextConversation,
  releaseOffer,
} from './queue.js';
import { agentStatus, agents, conversations, customerSessions, topics } from './schema.js';
import { seedTopics } from './seed.js';

let container: StartedPostgreSqlContainer;
let db: Database;
let pool: ReturnType<typeof createDb>['pool'];
let topicId: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').start();
  ({ db, pool } = createDb(container.getConnectionUri()));
  await runMigrations(container.getConnectionUri(), {
    aiReader: 'senha-de-teste-do-ai-reader',
    kbWriter: 'senha-de-teste-do-kb-writer',
  });
  await seedTopics(db);
  const [pix] = await db.select().from(topics).where(eq(topics.slug, 'pix'));
  topicId = pix!.id;
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

async function createAgent(email: string, maxConcurrent = 2) {
  const [agent] = await db
    .insert(agents)
    .values({
      name: email,
      email,
      passwordHash: await hashPassword('teste-senha-atendente'),
      maxConcurrent,
    })
    .returning({ id: agents.id });
  await db.insert(agentStatus).values({ agentId: agent!.id, status: 'online' });
  return agent!.id;
}

async function createQueued(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [session] = await db
      .insert(customerSessions)
      .values({
        displayName: `Cliente ${i}`,
        cpfHash: 'a'.repeat(64),
        cpfLast2: '00',
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning({ id: customerSessions.id });
    const [conv] = await db
      .insert(conversations)
      .values({ sessionId: session!.id, topicId, status: 'ai' })
      .returning({ id: conversations.id });
    await enqueueConversation(db, {
      conversationId: conv!.id,
      summary: `Resumo ${i}`,
      priority: i % 3,
    });
    ids.push(conv!.id);
  }
  return ids;
}

describe('senhas do atendente (scrypt)', () => {
  it('grava e confere a senha; senha errada falha', async () => {
    const hash = await hashPassword('segredo-forte');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('segredo-forte', hash)).toBe(true);
    expect(await verifyPassword('outra', hash)).toBe(false);
  });
});

describe('fila SKIP LOCKED (ADR 0004)', () => {
  it('dois atendentes não pegam a mesma conversa ao mesmo tempo', async () => {
    const a = await createAgent('race-a@test.example', 5);
    const b = await createAgent('race-b@test.example', 5);
    const [only] = await createQueued(1);

    const [r1, r2] = await Promise.all([
      offerNextConversation(db, a),
      offerNextConversation(db, b),
    ]);

    const ids = [r1?.id, r2?.id].filter(Boolean);
    expect(ids).toEqual([only]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
  });

  it('50 ofertas em paralelo: cada conversa vai para um atendente, sem duplicar', async () => {
    const agentIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createAgent(`load-${i}@test.example`, 20)),
    );
    const queued = await createQueued(50);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => offerNextConversation(db, agentIds[i % 5]!)),
    );

    const offered = results.filter(Boolean).map((r) => r!.id);
    expect(offered).toHaveLength(50);
    expect(new Set(offered).size).toBe(50);
    expect(offered.sort()).toEqual([...queued].sort());
  });

  it('aceitar sobe active_count; recusar devolve à fila', async () => {
    const agentId = await createAgent('flow@test.example', 2);
    const [id] = await createQueued(1);
    const offered = await offerNextConversation(db, agentId);
    expect(offered?.id).toBe(id);

    await acceptOffer(db, { conversationId: id!, agentId });
    const [st] = await db.select().from(agentStatus).where(eq(agentStatus.agentId, agentId));
    expect(st?.activeCount).toBe(1);

    // Segunda conversa: oferece e recusa
    const [id2] = await createQueued(1);
    const offered2 = await offerNextConversation(db, agentId);
    expect(offered2?.id).toBe(id2);
    await releaseOffer(db, { conversationId: id2!, agentId, reason: 'declined' });
    const [again] = await db
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, id2!));
    expect(again?.status).toBe('queued');
  });

  it('enqueue é idempotente e monta status queued', async () => {
    const [id] = await createQueued(1);
    const second = await enqueueConversation(db, { conversationId: id!, summary: 'x' });
    expect(second).toEqual({ status: 'queued', alreadyInQueue: true });
  });

  it('mesa lista queued e offered (oferta não some da fila)', async () => {
    const agentId = await createAgent('desk-list@test.example', 2);
    await createQueued(1);
    const offered = await offerNextConversation(db, agentId);
    expect(offered).toBeTruthy();
    // Limite alto: testes anteriores podem deixar dezenas de `offered` no mesmo container.
    const pending = await listQueuedConversations(db, 200);
    expect(pending.some((c) => c.id === offered!.id && c.status === 'offered')).toBe(true);
  });
});
