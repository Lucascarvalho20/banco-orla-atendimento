import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LanguageModel } from '@orla/ai';
import type { MessageStore } from '@orla/db';
import { agentRoutes, attachAgent, type AgentStore } from './agents.js';
import type { Assistant } from './assistant.js';
import { attachChat, type ChatStore } from './chat.js';
import type { Env } from './env.js';
import type { EventPublisher } from './events.js';
import { createMetrics, type Metrics } from './metrics.js';
import { isAllowedWebOrigin } from './origins.js';
import { sessionRoutes, type SessionStore } from './sessions.js';

export interface AppDeps {
  sessions: SessionStore;
  chat: ChatStore;
  assistant?: Assistant;
  agents?: AgentStore;
  metrics?: Metrics;
  events?: EventPublisher;
  llm?: LanguageModel;
  messageStore?: MessageStore;
}

export async function buildApp(env: Env, deps: AppDeps): Promise<FastifyInstance> {
  const metrics = deps.metrics ?? (env.NODE_ENV === 'test' ? undefined : createMetrics());

  const app = Fastify({
    // ID em todo log: investiga incidente com um único conversationId/requestId (Etapa 9).
    genReqId: (req) =>
      (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
      randomUUID(),
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.cpf',
                '*.password',
                '*.body',
              ],
              censor: '[mascarado]',
            },
          },
    bodyLimit: 16 * 1024,
  });

  await app.register(helmet);
  // Reflete a Origin se for localhost ↔ 127.0.0.1 (mesmo app local).
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || isAllowedWebOrigin(env.WEB_ORIGIN, origin)) {
        cb(null, origin ?? true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  // Limite só nas rotas que pedem (config.rateLimit); o /health fica livre.
  await app.register(rateLimit, { global: false });

  if (metrics) {
    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
      if (route === '/metrics') return;
      metrics.httpRequests.inc({
        method: request.method,
        route,
        status: String(reply.statusCode),
      });
    });
    app.get('/metrics', async (_request, reply) => {
      reply.header('Content-Type', metrics.register.contentType);
      return metrics.register.metrics();
    });
  }

  app.get('/health', async () => ({ status: 'ok' }));
  await sessionRoutes(app, env, deps.sessions);
  if (deps.agents) await agentRoutes(app, env, deps.agents);
  const { io } = attachChat(app, env, metrics ? { ...deps, metrics } : deps);
  if (deps.agents) {
    attachAgent(io, app, {
      agents: deps.agents,
      chat: deps.chat,
      ...(deps.events ? { events: deps.events } : {}),
      ...(deps.llm ? { llm: deps.llm } : {}),
      ...(deps.messageStore ? { messageStore: deps.messageStore } : {}),
    });
  }

  return app;
}
