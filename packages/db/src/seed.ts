import { TOPICS } from '@orla/shared';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { hashPassword } from './passwords.js';
import { agentStatus, agents, topics } from './schema.js';

/** Idempotente: pode rodar várias vezes sem duplicar (upsert pelo slug). */
export async function seedTopics(db: Database): Promise<void> {
  await db
    .insert(topics)
    .values(TOPICS.map((t, i) => ({ slug: t.slug, name: t.name, sortOrder: i })))
    .onConflictDoUpdate({
      target: topics.slug,
      set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
    });
}

/** Senha padrão só para demo local — documentada no README; trocar em qualquer ambiente real. */
export const DEMO_AGENT_PASSWORD = 'atendente-demo';

const DEMO_AGENTS = [
  {
    name: 'Ana Atendente',
    email: 'ana@bancoorla.example',
    role: 'agent' as const,
    maxConcurrent: 2,
  },
  {
    name: 'Carlos Atendente',
    email: 'carlos@bancoorla.example',
    role: 'agent' as const,
    maxConcurrent: 2,
  },
  {
    name: 'Sofia Supervisora',
    email: 'sofia@bancoorla.example',
    role: 'supervisor' as const,
    maxConcurrent: 1,
  },
];

/** Idempotente: recria o hash se o e-mail já existir (útil quando a senha demo muda). */
export async function seedAgents(db: Database): Promise<void> {
  const passwordHash = await hashPassword(DEMO_AGENT_PASSWORD);
  for (const agent of DEMO_AGENTS) {
    const [row] = await db
      .insert(agents)
      .values({ ...agent, passwordHash })
      .onConflictDoUpdate({
        target: agents.email,
        set: {
          name: agent.name,
          role: agent.role,
          maxConcurrent: agent.maxConcurrent,
          passwordHash,
        },
      })
      .returning({ id: agents.id });

    await db
      .insert(agentStatus)
      .values({ agentId: row!.id, status: 'offline' })
      .onConflictDoNothing();
  }
}

export async function seedAll(db: Database): Promise<void> {
  await seedTopics(db);
  await seedAgents(db);
}
