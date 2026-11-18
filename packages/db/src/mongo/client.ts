import { MongoClient, type Db } from 'mongodb';

export interface MongoHandles {
  client: MongoClient;
  db: Db;
}

export async function connectMongo(uri: string, dbName = 'orla'): Promise<MongoHandles> {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(dbName);
  await ensureIndexes(db);
  return { client, db };
}

async function ensureIndexes(db: Db): Promise<void> {
  const messages = db.collection('messages');
  await messages.createIndex({ conversationId: 1, seq: 1 }, { unique: true });
  await messages.createIndex(
    { conversationId: 1, clientMsgId: 1 },
    { unique: true, partialFilterExpression: { clientMsgId: { $type: 'string' } } },
  );

  const traces = db.collection('ai_traces');
  await traces.createIndex({ conversationId: 1, promptVersion: 1 });
  await traces.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // TTL 90 dias

  const counters = db.collection('conversation_counters');
  await counters.createIndex({ conversationId: 1 }, { unique: true });
}
