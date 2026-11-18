import type { ChatMessage, ChatSource, MessageSender } from '@orla/shared';
import type { Db } from 'mongodb';
import type { MessageStore } from '../message-store.js';

type MessageDoc = {
  conversationId: string;
  seq: number;
  clientMsgId: string | null;
  sender: MessageSender;
  body: string;
  sources: ChatSource[] | null;
  createdAt: Date;
};

function toChatMessage(doc: MessageDoc): ChatMessage {
  return {
    seq: doc.seq,
    clientMsgId: doc.clientMsgId,
    sender: doc.sender,
    body: doc.body,
    ...(doc.sources?.length ? { sources: doc.sources } : {}),
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * Mensagens no Mongo (ADR 0002). Seq atômica via `conversation_counters`.
 * Sem transação com o Postgres: `clientMsgId` único tolera reenvio.
 */
export function mongoMessageStore(db: Db): MessageStore {
  const messages = db.collection<MessageDoc>('messages');
  const counters = db.collection<{ conversationId: string; seq: number }>('conversation_counters');

  return {
    async append(input) {
      if (input.clientMsgId) {
        const already = await messages.findOne({
          conversationId: input.conversationId,
          clientMsgId: input.clientMsgId,
        });
        if (already) return { message: toChatMessage(already), duplicate: true };
      }

      const counter = await counters.findOneAndUpdate(
        { conversationId: input.conversationId },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      );
      const seq = counter?.seq ?? 1;

      const doc: MessageDoc = {
        conversationId: input.conversationId,
        seq,
        clientMsgId: input.clientMsgId,
        sender: input.sender,
        body: input.body,
        sources: input.sources?.length ? input.sources : null,
        createdAt: new Date(),
      };

      try {
        await messages.insertOne(doc);
        return { message: toChatMessage(doc), duplicate: false };
      } catch (error) {
        // Corrida no mesmo clientMsgId: devolve a já gravada.
        if (input.clientMsgId && isDuplicateKey(error)) {
          const already = await messages.findOne({
            conversationId: input.conversationId,
            clientMsgId: input.clientMsgId,
          });
          if (already) return { message: toChatMessage(already), duplicate: true };
        }
        throw error;
      }
    },

    async list(conversationId, afterSeq = 0, limit = 200) {
      const rows = await messages
        .find({ conversationId, seq: { $gt: afterSeq } })
        .sort({ seq: 1 })
        .limit(limit)
        .toArray();
      return rows.map(toChatMessage);
    },

    async listRecent(conversationId, limit) {
      const rows = await messages.find({ conversationId }).sort({ seq: -1 }).limit(limit).toArray();
      return rows.reverse().map((m) => ({ sender: m.sender, body: m.body }));
    },
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: number }).code === 11000
  );
}
