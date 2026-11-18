import { randomUUID } from 'node:crypto';
import { MongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMongo } from './client.js';
import { mongoMessageStore } from './messages.js';
import { mongoTraceStore } from './traces.js';

describe('mongo message + trace store (ADR 0002)', () => {
  let stop: (() => Promise<void>) | undefined;
  let store: ReturnType<typeof mongoMessageStore>;
  let traces: ReturnType<typeof mongoTraceStore>;

  beforeAll(async () => {
    const container = await new MongoDBContainer('mongo:8').start();
    // No Windows o hostname do container não resolve: usa host + porta mapeada.
    const uri = `mongodb://${container.getHost()}:${container.getMappedPort(27017)}/?directConnection=true`;
    const { client, db } = await connectMongo(uri, 'orla');
    store = mongoMessageStore(db);
    traces = mongoTraceStore(db);
    stop = async () => {
      await client.close();
      await container.stop();
    };
  }, 120_000);

  afterAll(async () => {
    await stop?.();
  });

  it('grava com seq atômica e é idempotente no clientMsgId', async () => {
    const conversationId = randomUUID();
    const clientMsgId = randomUUID();
    const a = await store.append({
      conversationId,
      clientMsgId,
      sender: 'customer',
      body: 'oi',
    });
    const b = await store.append({
      conversationId,
      clientMsgId,
      sender: 'customer',
      body: 'oi',
    });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.message.seq).toBe(a.message.seq);

    const second = await store.append({
      conversationId,
      clientMsgId: randomUUID(),
      sender: 'ai',
      body: 'olá',
    });
    expect(second.message.seq).toBe(a.message.seq + 1);
    const listed = await store.list(conversationId, 0);
    expect(listed.map((m) => m.body)).toEqual(['oi', 'olá']);
  });

  it('conta traces por prefixo de prompt', async () => {
    const conversationId = randomUUID();
    await traces.record({
      conversationId,
      promptVersion: 'rag-v3',
      model: 'test',
      latencyMs: 10,
      data: { status: 'answered' },
    });
    await traces.record({
      conversationId,
      promptVersion: 'agent-v1',
      model: 'test',
      latencyMs: 5,
      data: { status: 'ok' },
    });
    expect(await traces.countByPromptPrefix(conversationId, 'rag-')).toBe(1);
    expect(await traces.countByPromptPrefix(conversationId, 'agent-')).toBe(1);
  });
});
