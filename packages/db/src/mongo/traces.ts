import type { Db } from 'mongodb';
import type { NewAiTrace } from '../chat.js';
import type { TraceStoreDb } from '../message-store.js';

type TraceDoc = NewAiTrace & { createdAt: Date };

export function mongoTraceStore(db: Db): TraceStoreDb {
  const traces = db.collection<TraceDoc>('ai_traces');

  return {
    async record(trace) {
      await traces.insertOne({ ...trace, createdAt: new Date() });
    },

    async countByPromptPrefix(conversationId, promptVersionPrefix) {
      return traces.countDocuments({
        conversationId,
        promptVersion: { $regex: `^${escapeRegex(promptVersionPrefix)}` },
      });
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
