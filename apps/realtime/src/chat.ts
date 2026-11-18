import { maskSensitiveData } from '@orla/ai';
import type { CustomerSession } from '@orla/db';
import {
  enviarSchema,
  entrarSchema,
  QUEUE_PRIORITY_NORMAL,
  QUEUE_PRIORITY_PREFERENTIAL,
  TOPICS,
  type ChatMessage,
  type ChatSource,
  type ClientToServerEvents,
  type MessageSender,
  type ServerToClientEvents,
  type TopicSlug,
} from '@orla/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { Assistant } from './assistant.js';
import type { Env } from './env.js';
import type { Metrics } from './metrics.js';
import { isAllowedWebOrigin } from './origins.js';
import { SESSION_COOKIE, type SessionStore } from './sessions.js';

/** O que o chat precisa do banco. Nos testes, uma versão em memória cumpre o mesmo papel. */
export interface ChatStore {
  openConversation(input: {
    sessionId: string;
    topic: TopicSlug;
    welcome: string;
    priority?: number;
  }): Promise<{ id: string; created: boolean }>;
  appendMessage(input: {
    conversationId: string;
    clientMsgId: string | null;
    sender: MessageSender;
    body: string;
    sources?: ChatSource[] | undefined;
  }): Promise<{ message: ChatMessage; duplicate: boolean }>;
  listMessages(conversationId: string, afterSeq: number): Promise<ChatMessage[]>;
  /** Etapa 8: coloca na fila humana com resumo da triagem. */
  enqueueForHuman?(conversationId: string): Promise<{
    alreadyInQueue: boolean;
    position: number;
    status: 'queued' | 'offered' | 'active';
  }>;
  /** Se a conversa já saiu do modo IA, o assistente não responde mais. */
  isAiHandling?(conversationId: string): Promise<boolean>;
}

interface SocketData {
  session: CustomerSession;
  conversationId?: string;
  sentAt: number[];
  replies: Promise<void>;
}

type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export const RATE_LIMIT = { max: 10, windowMs: 10_000 };
export const NO_ANSWER =
  'Não encontrei essa informação nos nossos documentos. Pode reformular a pergunta com outras palavras?';
export const SENSITIVE_DATA_WARNING =
  'Por segurança, escondi dados sensíveis da sua mensagem. O Banco Orla nunca pede senha, código do token, CVV ou número completo do cartão.';
export const OUT_OF_SCOPE =
  'Só consigo ajudar com dúvidas sobre os serviços do Banco Orla. Qual é a sua dúvida?';
export const RAG_LIMIT_REACHED =
  'Você chegou ao limite de perguntas ao assistente nesta conversa. Perguntas frequentes continuam sendo respondidas.';
export const ASSISTANT_DOWN =
  'Estou com instabilidade para responder agora. Tente de novo em alguns instantes.';
export const QUEUED_FOR_HUMAN =
  'Certo — você entrou na fila de um atendente humano. Em breve alguém assume sua conversa. Enquanto isso, pode continuar escrevendo.';
export const ASK_HUMAN_HINT =
  'Se preferir, clique em “Falar com atendente” para ser atendido por uma pessoa.';
const sessionIdSchema = z.uuid();
export const conversationRoom = (conversationId: string) => `conversa:${conversationId}`;
const room = conversationRoom;

export function attachChat(
  app: FastifyInstance,
  env: Env,
  // Sem assistente, o chat só transporta mensagens (os testes de transporte usam assim).
  deps: { sessions: SessionStore; chat: ChatStore; assistant?: Assistant; metrics?: Metrics },
) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
    app.server,
    {
      serveClient: false,
      maxHttpBufferSize: 16 * 1024,
      cors: {
        origin: (origin, callback) => {
          callback(null, !origin || isAllowedWebOrigin(env.WEB_ORIGIN, origin));
        },
        credentials: true,
      },
      // WebSocket não respeita CORS: sem isto, outro site poderia abrir o chat usando o cookie
      // do cliente (Cross-Site WebSocket Hijacking). Só aceitamos a origem do nosso front.
      allowRequest: (req, callback) =>
        callback(null, isAllowedWebOrigin(env.WEB_ORIGIN, req.headers.origin)),
    },
  );

  // Porteiro: toda conexão precisa de um cookie de sessão válido (Etapa 3).
  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const raw = cookies[SESSION_COOKIE];
      const unsigned = raw ? app.unsignCookie(raw) : undefined;
      const id = unsigned?.valid ? sessionIdSchema.safeParse(unsigned.value) : undefined;
      const session = id?.success ? await deps.sessions.findActive(id.data) : undefined;
      if (!session) return next(new Error('sem_sessao'));

      socket.data.session = session;
      socket.data.sentAt = [];
      socket.data.replies = Promise.resolve();
      next();
    } catch (error) {
      app.log.error({ err: error }, 'falha ao autenticar socket');
      next(new Error('erro_interno'));
    }
  });

  io.on('connection', (socket: ChatSocket) => {
    const { session } = socket.data;
    const log = app.log.child({ sessionId: session.id, socketId: socket.id });

    socket.on('conversa:entrar', async (data, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = entrarSchema.safeParse(data);
      if (!parsed.success) return ack({ ok: false, error: 'dados_invalidos' });

      try {
        const topicName = TOPICS.find((t) => t.slug === parsed.data.topic)!.name;
        const conversation = await deps.chat.openConversation({
          sessionId: session.id,
          topic: parsed.data.topic,
          welcome: `Olá, ${session.displayName}! Conte sua dúvida sobre ${topicName}.`,
          priority: parsed.data.preferential ? QUEUE_PRIORITY_PREFERENTIAL : QUEUE_PRIORITY_NORMAL,
        });
        // O id da conversa vem do servidor, nunca do navegador: ninguém entra na conversa alheia.
        socket.data.conversationId = conversation.id;
        await socket.join(room(conversation.id));
        const messages = await deps.chat.listMessages(conversation.id, parsed.data.afterSeq);
        log.info(
          { conversationId: conversation.id, created: conversation.created },
          'entrou na conversa',
        );
        ack({ ok: true, messages });
      } catch (error) {
        log.error({ err: error }, 'falha ao entrar na conversa');
        ack({ ok: false, error: 'erro_interno' });
      }
    });

    socket.on('mensagem:enviar', async (data, ack) => {
      if (typeof ack !== 'function') return;
      const { conversationId } = socket.data;
      if (!conversationId) return ack({ ok: false, error: 'sem_conversa' });

      // Limite por conexão: no máximo 10 mensagens a cada 10 s (anti-spam e anti-custo da IA).
      const now = Date.now();
      socket.data.sentAt = socket.data.sentAt.filter((t) => now - t < RATE_LIMIT.windowMs);
      if (socket.data.sentAt.length >= RATE_LIMIT.max) {
        return ack({ ok: false, error: 'muitas_mensagens' });
      }

      const parsed = enviarSchema.safeParse(data);
      if (!parsed.success) return ack({ ok: false, error: 'dados_invalidos' });
      socket.data.sentAt.push(now);

      // Cartão, CPF, senha… são escondidos ANTES de gravar: não ficam no banco, no histórico do
      // atendente nem chegam à IA (minimização, LGPD). O cliente vê a versão mascarada.
      const masked = maskSensitiveData(parsed.data.body);

      try {
        const { message, duplicate } = await deps.chat.appendMessage({
          conversationId,
          clientMsgId: parsed.data.clientMsgId,
          sender: 'customer',
          body: masked.text,
        });
        // O texto da mensagem NÃO vai para o log; só QUE tipo de dado foi escondido.
        log.info(
          { conversationId, seq: message.seq, duplicate, masked: masked.found },
          'mensagem recebida',
        );
        ack({ ok: true, seq: message.seq, duplicate, body: message.body });
        if (duplicate) return;
        deps.metrics?.messages.inc({ sender: 'customer' });
        // Avisa todas as abas/atendentes na sala (inclusive esta; o navegador junta sem duplicar).
        io.to(room(conversationId)).emit('mensagem:nova', message);
        // Aviso e resposta não seguram a confirmação acima; a fila por conexão mantém a ordem.
        if (masked.found.length > 0) {
          socket.data.replies = socket.data.replies.then(() =>
            post(conversationId, 'system', SENSITIVE_DATA_WARNING, undefined, log),
          );
        }
        if (deps.assistant) {
          const { assistant } = deps;
          socket.data.replies = socket.data.replies.then(async () => {
            if (deps.chat.isAiHandling && !(await deps.chat.isAiHandling(conversationId))) return;
            await reply(assistant, conversationId, message.body, log);
          });
        }
      } catch (error) {
        log.error({ err: error, conversationId }, 'falha ao gravar mensagem');
        ack({ ok: false, error: 'erro_interno' });
      }
    });

    socket.on('fila:pedir', async (ack) => {
      if (typeof ack !== 'function') return;
      const { conversationId } = socket.data;
      if (!conversationId) return ack({ ok: false, error: 'sem_conversa' });
      if (!deps.chat.enqueueForHuman) return ack({ ok: false, error: 'erro_interno' });

      try {
        const result = await deps.chat.enqueueForHuman(conversationId);
        if (!result.alreadyInQueue) {
          await post(conversationId, 'system', QUEUED_FOR_HUMAN, undefined, log);
        }
        socket.emit('fila:atualizada', {
          status: result.status,
          position: result.position,
        });
        ack({ ok: true, status: 'queued' });
        log.info({ conversationId, ...result }, 'cliente pediu atendente');
      } catch (error) {
        log.error({ err: error, conversationId }, 'falha ao enfileirar');
        ack({ ok: false, error: 'erro_interno' });
      }
    });
  });

  /** Grava e transmite a resposta automática. Nunca lança: o erro vira aviso para o cliente. */
  async function reply(
    assistant: Assistant,
    conversationId: string,
    question: string,
    log: FastifyBaseLogger,
  ) {
    let sender: MessageSender = 'system';
    let body = ASSISTANT_DOWN;
    let sources: ChatSource[] | undefined;
    io.to(room(conversationId)).emit('assistente:digitando', true);
    const started = Date.now();
    let kind: string = 'error';
    try {
      const answer = await assistant.answer(question, { conversationId });
      kind = answer.kind;
      if (answer.kind === 'faq' || answer.kind === 'rag') {
        sender = 'ai';
        body = answer.body;
        if (answer.kind === 'rag') sources = answer.sources;
      } else {
        body = { limit: RAG_LIMIT_REACHED, blocked: OUT_OF_SCOPE, not_found: NO_ANSWER }[
          answer.kind
        ];
        if (answer.kind === 'blocked') {
          deps.metrics?.guardsBlocked.inc({ stage: 'input', kind: 'blocked' });
        }
      }
      log.info({ conversationId, kind: answer.kind }, 'resposta automática');
    } catch (error) {
      log.error({ err: error, conversationId }, 'assistente indisponível');
    } finally {
      deps.metrics?.assistantAnswers.inc({ kind });
      deps.metrics?.assistantLatency.observe({ kind }, (Date.now() - started) / 1000);
    }

    try {
      await post(conversationId, sender, body, sources, log);
      if (body === NO_ANSWER || body === RAG_LIMIT_REACHED) {
        await post(conversationId, 'system', ASK_HUMAN_HINT, undefined, log);
      }
    } finally {
      io.to(room(conversationId)).emit('assistente:digitando', false);
    }
  }

  /** Grava e transmite uma mensagem do servidor. Nunca lança: a falha vai para o log. */
  async function post(
    conversationId: string,
    sender: MessageSender,
    body: string,
    sources: ChatSource[] | undefined,
    log: FastifyBaseLogger,
  ) {
    try {
      const { message } = await deps.chat.appendMessage({
        conversationId,
        clientMsgId: null,
        sender,
        body,
        sources,
      });
      io.to(room(conversationId)).emit('mensagem:nova', message);
      deps.metrics?.messages.inc({ sender });
    } catch (error) {
      log.error({ err: error, conversationId, sender }, 'falha ao gravar mensagem do servidor');
    }
  }

  // Desligamento gracioso: derruba os sockets antes de o Fastify fechar o servidor HTTP.
  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
  });

  return { io };
}
