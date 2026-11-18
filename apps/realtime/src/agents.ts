import { suggestAgentReply, type LanguageModel } from '@orla/ai';
import {
  acceptOffer,
  appendAgentChat,
  claimQueuedConversation,
  closeConversation,
  countQueued,
  expireStaleOffers,
  findAgentByEmail,
  findAgentById,
  getAgentPresence,
  listAgentActive,
  listAgentChat,
  listAllActiveConversations,
  listQueuedConversations,
  listTeamPresence,
  loadDeskConversation,
  offerNextConversation,
  releaseOffer,
  setAgentPresence,
  verifyPassword,
  type AgentChatMessage,
  type MessageStore,
  type QueueConversation,
  type TeamMemberRow,
} from '@orla/db';
import {
  OFFER_TIMEOUT_MS,
  agentLoginSchema,
  agentPresenceSchema,
  enviarSchema,
  type AgentAck,
  type AgentQueueItem,
  type AgentTeamChatMessage,
  type AgentTeamMember,
  type ChatMessage,
  type ClientToServerEvents,
  type CustomerProfile,
  type ServerToClientEvents,
} from '@orla/shared';
import type { FastifyInstance } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { conversationRoom, type ChatStore } from './chat.js';
import type { Env } from './env.js';
import { noopEventPublisher, type EventPublisher } from './events.js';

export const AGENT_COOKIE = 'orla_agente';
const agentIdSchema = z.uuid();

export interface AgentStore {
  findByEmail(email: string): Promise<{
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    role: 'agent' | 'supervisor';
  } | null>;
  findById(id: string): Promise<{
    id: string;
    name: string;
    email: string;
    role: 'agent' | 'supervisor';
  } | null>;
  setPresence(agentId: string, status: 'online' | 'offline' | 'away'): Promise<void>;
  getPresence(agentId: string): Promise<{ status: string; activeCount: number } | null>;
  offerNext(agentId: string): Promise<QueueConversation | null>;
  claim(conversationId: string, agentId: string): Promise<QueueConversation>;
  accept(conversationId: string, agentId: string): Promise<QueueConversation>;
  decline(conversationId: string, agentId: string): Promise<void>;
  timeout(conversationId: string, agentId: string): Promise<void>;
  close(conversationId: string, agentId: string, asSupervisor?: boolean): Promise<void>;
  listActive(agentId: string): Promise<QueueConversation[]>;
  listAllActive(): Promise<QueueConversation[]>;
  listQueued(): Promise<QueueConversation[]>;
  listTeam(): Promise<TeamMemberRow[]>;
  loadConversation(conversationId: string): Promise<QueueConversation | null>;
  listTeamChat(): Promise<AgentChatMessage[]>;
  appendTeamChat(agentId: string, body: string): Promise<AgentChatMessage>;
  countQueued(): Promise<number>;
  expireOffers(olderThanMs: number): Promise<number>;
}

function toTeamChat(m: AgentChatMessage): AgentTeamChatMessage {
  return m;
}

type AgentSocketData = {
  agent: { id: string; name: string; email: string; role: 'agent' | 'supervisor' };
  offerTimers: Map<string, NodeJS.Timeout>;
};

function toItem(q: QueueConversation): AgentQueueItem {
  return {
    id: q.id,
    topicSlug: q.topicSlug,
    topicName: q.topicName,
    displayName: q.displayName,
    cpfLast2: q.cpfLast2,
    aiSummary: q.aiSummary,
    priority: q.priority,
    queuedAt: q.queuedAt?.toISOString() ?? null,
    status: q.status,
    agentId: q.agentId,
    agentName: q.agentName,
  };
}

function toTeam(m: TeamMemberRow): AgentTeamMember {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    activeCount: m.activeCount,
  };
}

function toProfile(q: QueueConversation): CustomerProfile {
  return {
    displayName: q.displayName,
    cpfLast2: q.cpfLast2,
    topicSlug: q.topicSlug,
    topicName: q.topicName,
    conversationStatus: q.status,
    aiSummary: q.aiSummary,
    agentName: q.agentName,
  };
}

function canWriteConversation(
  agent: { id: string; role: 'agent' | 'supervisor' },
  conversation: QueueConversation,
): boolean {
  if (conversation.status !== 'active') return false;
  if (agent.role === 'supervisor') return true;
  return conversation.agentId === agent.id;
}

export async function agentRoutes(app: FastifyInstance, env: Env, store: AgentStore) {
  app.post(
    '/agents/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = agentLoginSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'dados_invalidos' });

      const agent = await store.findByEmail(parsed.data.email);
      if (!agent || !(await verifyPassword(parsed.data.password, agent.passwordHash))) {
        return reply.code(401).send({ error: 'nao_autorizado' });
      }

      const ttlSeconds = env.SESSION_TTL_MINUTES * 60;
      reply.setCookie(AGENT_COOKIE, agent.id, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: '/',
        maxAge: ttlSeconds,
      });
      request.log.info({ agentId: agent.id }, 'atendente autenticado');
      return {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        role: agent.role,
      };
    },
  );

  app.post('/agents/logout', async (request, reply) => {
    const agentId = await readAgentId(app, request.cookies[AGENT_COOKIE]);
    if (agentId) await store.setPresence(agentId, 'offline').catch(() => undefined);
    reply.clearCookie(AGENT_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/agents/me', async (request, reply) => {
    const agentId = await readAgentId(app, request.cookies[AGENT_COOKIE]);
    if (!agentId) return reply.code(401).send({ error: 'nao_autorizado' });
    const agent = await store.findById(agentId);
    if (!agent) return reply.code(401).send({ error: 'nao_autorizado' });
    const presence = await store.getPresence(agentId);
    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      presence: presence?.status ?? 'offline',
      activeCount: presence?.activeCount ?? 0,
    };
  });
}

async function readAgentId(
  app: FastifyInstance,
  raw: string | undefined,
): Promise<string | undefined> {
  const unsigned = raw ? app.unsignCookie(raw) : undefined;
  const id = unsigned?.valid ? agentIdSchema.safeParse(unsigned.value) : undefined;
  return id?.success ? id.data : undefined;
}

/**
 * Namespace `/agent` do Socket.IO: presença, próxima da fila, aceitar/recusar, chat do atendente.
 * Timeout de oferta (30 s) é do **servidor** (ADR 0003) — não confia no relógio do navegador.
 */
export function attachAgent(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  app: FastifyInstance,
  deps: {
    agents: AgentStore;
    chat: ChatStore;
    events?: EventPublisher;
    llm?: LanguageModel;
    messageStore?: MessageStore;
  },
) {
  const events = deps.events ?? noopEventPublisher;
  const nsp = io.of('/agent');

  nsp.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const agentId = await readAgentId(app, cookies[AGENT_COOKIE]);
      if (!agentId) return next(new Error('nao_autorizado'));
      const agent = await deps.agents.findById(agentId);
      if (!agent) return next(new Error('nao_autorizado'));

      (socket.data as AgentSocketData).agent = agent;
      (socket.data as AgentSocketData).offerTimers = new Map();
      next();
    } catch (error) {
      app.log.error({ err: error }, 'falha ao autenticar socket do atendente');
      next(new Error('erro_interno'));
    }
  });

  nsp.on('connection', (socket: Socket) => {
    const data = socket.data as AgentSocketData;
    const { agent } = data;
    const log = app.log.child({ agentId: agent.id, socketId: socket.id });
    void socket.join('equipe');

    socket.on('presenca', async (payload, ack: (res: AgentAck<{ status: string }>) => void) => {
      if (typeof ack !== 'function') return;
      const parsed = agentPresenceSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'dados_invalidos' });
      try {
        await deps.agents.setPresence(agent.id, parsed.data.status);
        const team = await deps.agents.listTeam();
        nsp.to('equipe').emit('equipe:estado', { team: team.map(toTeam) });
        ack({ ok: true, status: parsed.data.status });
      } catch {
        ack({ ok: false, error: 'erro_interno' });
      }
    });

    socket.on(
      'fila:proxima',
      async (ack: (res: AgentAck<{ offer: AgentQueueItem | null; queued: number }>) => void) => {
        if (typeof ack !== 'function') return;
        try {
          await deps.agents.expireOffers(OFFER_TIMEOUT_MS);
          const offer = await deps.agents.offerNext(agent.id);
          const queued = await deps.agents.countQueued();
          if (offer) {
            scheduleTimeout(socket, offer.id, agent.id, deps, log);
            socket.emit('fila:oferta', toItem(offer));
          }
          ack({ ok: true, offer: offer ? toItem(offer) : null, queued });
        } catch (error) {
          log.error({ err: error }, 'falha ao oferecer conversa');
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'fila:aceitar',
      async (
        payload: { conversationId: string },
        ack: (res: AgentAck<{ conversation: AgentQueueItem; messages: ChatMessage[] }>) => void,
      ) => {
        if (typeof ack !== 'function') return;
        const conversationId = z.uuid().safeParse(payload?.conversationId);
        if (!conversationId.success) return ack({ ok: false, error: 'dados_invalidos' });
        clearTimeout(data.offerTimers.get(conversationId.data));
        data.offerTimers.delete(conversationId.data);
        try {
          const conversation = await deps.agents.accept(conversationId.data, agent.id);
          await socket.join(conversationRoom(conversation.id));
          const messages = await deps.chat.listMessages(conversation.id, 0);
          const joined: ChatMessage = (
            await deps.chat.appendMessage({
              conversationId: conversation.id,
              clientMsgId: null,
              sender: 'system',
              body: `Atendente entrou na conversa.`,
            })
          ).message;
          io.to(conversationRoom(conversation.id)).emit('mensagem:nova', joined);
          await events.publish({
            type: 'conversation.accepted',
            conversationId: conversation.id,
            agentId: agent.id,
            at: new Date().toISOString(),
          });
          ack({ ok: true, conversation: toItem(conversation), messages: [...messages, joined] });
        } catch (error) {
          const msg = error instanceof Error ? error.message : '';
          ack({
            ok: false,
            error:
              msg === 'oferta_invalida'
                ? 'oferta_invalida'
                : msg === 'atendente_indisponivel'
                  ? 'atendente_indisponivel'
                  : 'erro_interno',
          });
        }
      },
    );

    socket.on(
      'fila:recusar',
      async (payload: { conversationId: string }, ack: (res: AgentAck<{ done: true }>) => void) => {
        if (typeof ack !== 'function') return;
        const conversationId = z.uuid().safeParse(payload?.conversationId);
        if (!conversationId.success) return ack({ ok: false, error: 'dados_invalidos' });
        clearTimeout(data.offerTimers.get(conversationId.data));
        data.offerTimers.delete(conversationId.data);
        try {
          await deps.agents.decline(conversationId.data, agent.id);
          ack({ ok: true, done: true });
        } catch {
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'mesa:estado',
      async (
        ack: (
          res: AgentAck<{
            team: AgentTeamMember[];
            queued: AgentQueueItem[];
            active: AgentQueueItem[];
            queuedCount: number;
          }>,
        ) => void,
      ) => {
        if (typeof ack !== 'function') return;
        try {
          const [team, queued, active, queuedCount] = await Promise.all([
            deps.agents.listTeam(),
            deps.agents.listQueued(),
            deps.agents.listAllActive(),
            deps.agents.countQueued(),
          ]);
          ack({
            ok: true,
            team: team.map(toTeam),
            queued: queued.map(toItem),
            active: active.map(toItem),
            queuedCount,
          });
        } catch (error) {
          log.error({ err: error }, 'falha ao carregar mesa');
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'mesa:abrir',
      async (
        payload: { conversationId: string },
        ack: (
          res: AgentAck<{
            conversation: AgentQueueItem;
            messages: ChatMessage[];
            profile: CustomerProfile;
            canWrite: boolean;
          }>,
        ) => void,
      ) => {
        if (typeof ack !== 'function') return;
        const conversationId = z.uuid().safeParse(payload?.conversationId);
        if (!conversationId.success) return ack({ ok: false, error: 'dados_invalidos' });
        try {
          const conversation = await deps.agents.loadConversation(conversationId.data);
          if (!conversation) return ack({ ok: false, error: 'nao_autorizado' });
          await socket.join(conversationRoom(conversation.id));
          const messages = await deps.chat.listMessages(conversation.id, 0);
          ack({
            ok: true,
            conversation: toItem(conversation),
            messages,
            profile: toProfile(conversation),
            canWrite: canWriteConversation(agent, conversation),
          });
        } catch (error) {
          log.error({ err: error }, 'falha ao abrir conversa na mesa');
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'fila:pegar',
      async (
        payload: { conversationId: string },
        ack: (res: AgentAck<{ conversation: AgentQueueItem; messages: ChatMessage[] }>) => void,
      ) => {
        if (typeof ack !== 'function') return;
        const conversationId = z.uuid().safeParse(payload?.conversationId);
        if (!conversationId.success) return ack({ ok: false, error: 'dados_invalidos' });
        try {
          const conversation = await deps.agents.claim(conversationId.data, agent.id);
          await socket.join(conversationRoom(conversation.id));
          const messages = await deps.chat.listMessages(conversation.id, 0);
          const joined = (
            await deps.chat.appendMessage({
              conversationId: conversation.id,
              clientMsgId: null,
              sender: 'system',
              body: `Atendente ${agent.name} assumiu a conversa.`,
            })
          ).message;
          io.to(conversationRoom(conversation.id)).emit('mensagem:nova', joined);
          nsp.to('equipe').emit('mesa:atualizada');
          ack({ ok: true, conversation: toItem(conversation), messages: [...messages, joined] });
        } catch (error) {
          const msg = error instanceof Error ? error.message : '';
          ack({
            ok: false,
            error:
              msg === 'oferta_invalida'
                ? 'oferta_invalida'
                : msg === 'atendente_indisponivel'
                  ? 'atendente_indisponivel'
                  : 'erro_interno',
          });
        }
      },
    );

    socket.on(
      'equipe:historico',
      async (ack: (res: AgentAck<{ messages: AgentTeamChatMessage[] }>) => void) => {
        if (typeof ack !== 'function') return;
        try {
          const messages = await deps.agents.listTeamChat();
          ack({ ok: true, messages: messages.map(toTeamChat) });
        } catch {
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'equipe:enviar',
      async (
        payload: { body: string },
        ack: (res: AgentAck<{ message: AgentTeamChatMessage }>) => void,
      ) => {
        if (typeof ack !== 'function') return;
        const body = z.string().trim().min(1).max(1000).safeParse(payload?.body);
        if (!body.success) return ack({ ok: false, error: 'dados_invalidos' });
        try {
          const message = await deps.agents.appendTeamChat(agent.id, body.data);
          const mapped = toTeamChat(message);
          nsp.to('equipe').emit('equipe:mensagem', mapped);
          ack({ ok: true, message: mapped });
        } catch {
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'mensagem:enviar',
      async (payload: unknown, ack: (res: AgentAck<{ seq: number; body: string }>) => void) => {
        if (typeof ack !== 'function') return;
        const parsed = enviarSchema.extend({ conversationId: z.uuid() }).safeParse(payload);
        if (!parsed.success) return ack({ ok: false, error: 'dados_invalidos' });

        try {
          const conversation = await deps.agents.loadConversation(parsed.data.conversationId);
          if (!conversation) return ack({ ok: false, error: 'nao_autorizado' });
          if (!canWriteConversation(agent, conversation)) {
            return ack({
              ok: false,
              error: agent.role === 'agent' ? 'somente_leitura' : 'nao_autorizado',
            });
          }
          const prefix =
            agent.role === 'supervisor' && conversation.agentId !== agent.id
              ? `[Supervisão · ${agent.name}] `
              : '';
          const { message } = await deps.chat.appendMessage({
            conversationId: parsed.data.conversationId,
            clientMsgId: parsed.data.clientMsgId,
            sender: 'agent',
            body: prefix + parsed.data.body,
          });
          await socket.join(conversationRoom(parsed.data.conversationId));
          io.to(conversationRoom(parsed.data.conversationId)).emit('mensagem:nova', message);
          ack({ ok: true, seq: message.seq, body: message.body });
        } catch (error) {
          log.error({ err: error }, 'falha ao enviar mensagem do atendente');
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on(
      'fila:encerrar',
      async (payload: { conversationId: string }, ack: (res: AgentAck<{ done: true }>) => void) => {
        if (typeof ack !== 'function') return;
        const conversationId = z.uuid().safeParse(payload?.conversationId);
        if (!conversationId.success) return ack({ ok: false, error: 'dados_invalidos' });
        try {
          const conversation = await deps.agents.loadConversation(conversationId.data);
          if (!conversation) return ack({ ok: false, error: 'nao_autorizado' });
          if (!canWriteConversation(agent, conversation)) {
            return ack({ ok: false, error: 'somente_leitura' });
          }
          await deps.agents.close(
            conversationId.data,
            agent.id,
            agent.role === 'supervisor' && conversation.agentId !== agent.id,
          );
          const { message } = await deps.chat.appendMessage({
            conversationId: conversationId.data,
            clientMsgId: null,
            sender: 'system',
            body: 'Atendimento encerrado. Obrigado pelo contato com o Banco Orla.',
          });
          io.to(conversationRoom(conversationId.data)).emit('mensagem:nova', message);
          await socket.leave(conversationRoom(conversationId.data));
          await events.publish({
            type: 'conversation.closed',
            conversationId: conversationId.data,
            agentId: agent.id,
            at: new Date().toISOString(),
          });
          ack({ ok: true, done: true });
        } catch {
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    /** V2 copiloto: sugere texto; o atendente edita e envia (nada sai sozinho). */
    socket.on(
      'mesa:copiloto',
      async (
        payload: { conversationId: string },
        ack: (res: AgentAck<{ suggestion: string }>) => void,
      ) => {
        if (typeof ack !== 'function') return;
        if (!deps.llm) return ack({ ok: false, error: 'erro_interno' });
        const conversationId = z.uuid().safeParse(payload?.conversationId);
        if (!conversationId.success) return ack({ ok: false, error: 'dados_invalidos' });
        try {
          const conversation = await deps.agents.loadConversation(conversationId.data);
          if (!conversation) return ack({ ok: false, error: 'nao_autorizado' });
          if (!canWriteConversation(agent, conversation)) {
            return ack({ ok: false, error: 'somente_leitura' });
          }
          const history = deps.messageStore
            ? await deps.messageStore.listRecent(conversationId.data, 12)
            : (await deps.chat.listMessages(conversationId.data, 0)).map((m) => ({
                sender: m.sender,
                body: m.body,
              }));
          const suggested = await suggestAgentReply({
            llm: deps.llm,
            topicName: conversation.topicName,
            customerName: conversation.displayName,
            history,
            triageSummary: conversation.aiSummary,
          });
          if (!suggested.ok) return ack({ ok: false, error: 'erro_interno' });
          ack({ ok: true, suggestion: suggested.suggestion });
        } catch (error) {
          log.error({ err: error }, 'falha no copiloto');
          ack({ ok: false, error: 'erro_interno' });
        }
      },
    );

    socket.on('disconnect', () => {
      for (const t of data.offerTimers.values()) clearTimeout(t);
      data.offerTimers.clear();
    });
  });

  // Varre ofertas vencidas a cada 5 s (fonte da verdade no servidor).
  const sweep = setInterval(() => {
    deps.agents.expireOffers(OFFER_TIMEOUT_MS).catch((error) => {
      app.log.error({ err: error }, 'falha ao expirar ofertas');
    });
  }, 5_000);
  app.addHook('preClose', async () => clearInterval(sweep));
}

function scheduleTimeout(
  socket: Socket,
  conversationId: string,
  agentId: string,
  deps: { agents: AgentStore },
  log: { error: (o: object, m: string) => void },
) {
  const data = socket.data as AgentSocketData;
  const prev = data.offerTimers.get(conversationId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    data.offerTimers.delete(conversationId);
    deps.agents
      .timeout(conversationId, agentId)
      .then(() => socket.emit('fila:oferta_expirada', { conversationId }))
      .catch((error) => log.error({ err: error, conversationId }, 'timeout de oferta'));
  }, OFFER_TIMEOUT_MS);
  data.offerTimers.set(conversationId, timer);
}

/** Adaptador Postgres → AgentStore (produção). */
export function postgresAgentStore(db: Parameters<typeof findAgentByEmail>[0]): AgentStore {
  return {
    findByEmail: async (email) => (await findAgentByEmail(db, email)) ?? null,
    findById: async (id) => {
      const row = await findAgentById(db, id);
      return row ? { id: row.id, name: row.name, email: row.email, role: row.role } : null;
    },
    setPresence: (id, status) => setAgentPresence(db, id, status),
    getPresence: async (id) => {
      const row = await getAgentPresence(db, id);
      return row ? { status: row.status, activeCount: row.activeCount } : null;
    },
    offerNext: (id) => offerNextConversation(db, id),
    claim: (conversationId, agentId) => claimQueuedConversation(db, { conversationId, agentId }),
    accept: (conversationId, agentId) => acceptOffer(db, { conversationId, agentId }),
    decline: (conversationId, agentId) =>
      releaseOffer(db, { conversationId, agentId, reason: 'declined' }),
    timeout: (conversationId, agentId) =>
      releaseOffer(db, { conversationId, agentId, reason: 'timeout' }),
    close: (conversationId, agentId, asSupervisor) =>
      closeConversation(
        db,
        asSupervisor
          ? { conversationId, agentId, asSupervisor: true }
          : { conversationId, agentId },
      ),
    listActive: (id) => listAgentActive(db, id),
    listAllActive: () => listAllActiveConversations(db),
    listQueued: () => listQueuedConversations(db),
    listTeam: () => listTeamPresence(db),
    loadConversation: (id) => loadDeskConversation(db, id),
    listTeamChat: () => listAgentChat(db),
    appendTeamChat: (agentId, body) => appendAgentChat(db, { fromAgentId: agentId, body }),
    countQueued: () => countQueued(db),
    expireOffers: (ms) => expireStaleOffers(db, ms),
  };
}
