import type { ChatMessage, ChatSource, MessageSender } from '@orla/shared';
import type { Database } from './client.js';
import {
  appendMessage,
  countAiTraces,
  listMessages,
  recordAiTrace,
  type NewAiTrace,
} from './chat.js';

/** Contrato da V2 (ADR 0002): trocar Postgres ↔ Mongo sem mudar o chat. */
export interface MessageStore {
  append(input: {
    conversationId: string;
    clientMsgId: string | null;
    sender: MessageSender;
    body: string;
    sources?: ChatSource[] | undefined;
  }): Promise<{ message: ChatMessage; duplicate: boolean }>;
  list(conversationId: string, afterSeq?: number, limit?: number): Promise<ChatMessage[]>;
  /** Últimas N mensagens (triagem), ordem cronológica. */
  listRecent(
    conversationId: string,
    limit: number,
  ): Promise<{ sender: MessageSender; body: string }[]>;
}

export interface TraceStoreDb {
  record(trace: NewAiTrace): Promise<void>;
  countByPromptPrefix(conversationId: string, promptVersionPrefix: string): Promise<number>;
}

export function postgresMessageStore(db: Database): MessageStore {
  return {
    append: (input) => appendMessage(db, input),
    list: (conversationId, afterSeq = 0, limit = 200) =>
      listMessages(db, conversationId, afterSeq, limit),
    async listRecent(conversationId, limit) {
      const all = await listMessages(db, conversationId, 0, 500);
      return all.slice(-limit).map((m) => ({ sender: m.sender, body: m.body }));
    },
  };
}

export function postgresTraceStore(db: Database): TraceStoreDb {
  return {
    record: (trace) => recordAiTrace(db, trace),
    countByPromptPrefix: (conversationId, prefix) => countAiTraces(db, conversationId, prefix),
  };
}
