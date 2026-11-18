import { randomUUID } from 'node:crypto';
import type { CustomerSession, NewCustomerSession } from '@orla/db';
import type { ChatMessage } from '@orla/shared';
import type { ChatStore } from '../chat.js';
import { loadEnv } from '../env.js';
import type { SessionStore } from '../sessions.js';

export const testEnv = loadEnv({
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgres://teste@127.0.0.1:1/teste',
  AI_READER_PASSWORD: 'senha-de-teste-do-ai-reader',
  CPF_HMAC_SECRET: 'segredo-de-teste-do-hmac-com-32-caracteres',
  SESSION_SECRET: 'segredo-de-teste-da-sessao-com-32-caracteres',
});

const toPublic = (row: NewCustomerSession & { id: string }): CustomerSession => ({
  id: row.id,
  displayName: row.displayName,
  cpfLast2: row.cpfLast2,
  expiresAt: row.expiresAt,
});

/** Bancos de mentira, em memória: rápidos e permitem olhar o que o código tentou gravar. */
export function memoryStores() {
  const sessions: (NewCustomerSession & { id: string })[] = [];
  const conversations = new Map<string, { sessionId: string; messages: ChatMessage[] }>();

  const sessionStore: SessionStore = {
    async create(data) {
      const row = { ...data, id: randomUUID() };
      sessions.push(row);
      return toPublic(row);
    },
    async findActive(id) {
      const row = sessions.find((s) => s.id === id && s.expiresAt > new Date());
      return row && toPublic(row);
    },
  };

  const chatStore: ChatStore = {
    async openConversation({ sessionId, welcome }) {
      for (const [id, c] of conversations)
        if (c.sessionId === sessionId) return { id, created: false };
      const id = randomUUID();
      conversations.set(id, {
        sessionId,
        messages: [
          {
            seq: 1,
            clientMsgId: null,
            sender: 'system',
            body: welcome,
            createdAt: new Date().toISOString(),
          },
        ],
      });
      return { id, created: true };
    },
    async appendMessage({ conversationId, clientMsgId, sender, body, sources }) {
      const c = conversations.get(conversationId)!;
      const already = clientMsgId && c.messages.find((m) => m.clientMsgId === clientMsgId);
      if (already) return { message: already, duplicate: true };
      const message: ChatMessage = {
        seq: c.messages.length + 1,
        clientMsgId,
        sender,
        body,
        ...(sources?.length ? { sources } : {}),
        createdAt: new Date().toISOString(),
      };
      c.messages.push(message);
      return { message, duplicate: false };
    },
    async listMessages(conversationId, afterSeq) {
      return conversations.get(conversationId)!.messages.filter((m) => m.seq > afterSeq);
    },
  };

  return { sessions, conversations, sessionStore, chatStore };
}
