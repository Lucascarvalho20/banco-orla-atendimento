import { createHmac } from 'node:crypto';
import type { CustomerSession, NewCustomerSession } from '@orla/db';
import { entradaSchema } from '@orla/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from './env.js';

export const SESSION_COOKIE = 'orla_sessao';

/** O que a rota precisa do banco. Nos testes, uma versão em memória cumpre o mesmo papel. */
export interface SessionStore {
  create(data: NewCustomerSession): Promise<CustomerSession>;
  findActive(id: string): Promise<CustomerSession | undefined>;
}

/** CPF → HMAC-SHA256 com segredo (ADR 0005). Mesmo CPF = mesmo hash; sem o segredo, irreversível. */
export function hashCpf(cpf: string, secret: string): string {
  return createHmac('sha256', secret).update(cpf).digest('hex');
}

const sessionIdSchema = z.uuid();

export async function sessionRoutes(app: FastifyInstance, env: Env, store: SessionStore) {
  app.post(
    '/sessions',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = entradaSchema.safeParse(request.body);
      if (!parsed.success) {
        // Devolve só o campo e a nossa mensagem — nunca o valor enviado (pode ser um CPF).
        const issues = parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }));
        return reply.code(400).send({ error: 'dados_invalidos', issues });
      }

      const { name, cpf, topic } = parsed.data;
      const ttlSeconds = env.SESSION_TTL_MINUTES * 60;
      const session = await store.create({
        displayName: name,
        cpfHash: hashCpf(cpf, env.CPF_HMAC_SECRET),
        cpfLast2: cpf.slice(-2),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
      request.log.info({ sessionId: session.id, topic }, 'sessão criada');

      reply.setCookie(SESSION_COOKIE, session.id, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: '/',
        maxAge: ttlSeconds,
      });
      return reply.code(201).send({
        displayName: session.displayName,
        cpfLast2: session.cpfLast2,
        topic,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  );

  app.get('/sessions/me', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : undefined;
    const id = unsigned?.valid ? sessionIdSchema.safeParse(unsigned.value) : undefined;
    const session = id?.success ? await store.findActive(id.data) : undefined;

    if (!session) return reply.code(401).send({ error: 'sem_sessao' });
    return { displayName: session.displayName, cpfLast2: session.cpfLast2 };
  });
}
