import { desc, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { agentMessages, agents } from './schema.js';

export type AgentChatMessage = {
  id: number;
  fromAgentId: string;
  fromName: string;
  body: string;
  createdAt: string;
};

export async function listAgentChat(db: Database, limit = 80): Promise<AgentChatMessage[]> {
  const rows = await db
    .select({
      id: agentMessages.id,
      fromAgentId: agentMessages.fromAgentId,
      fromName: agents.name,
      body: agentMessages.body,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .innerJoin(agents, eq(agents.id, agentMessages.fromAgentId))
    .orderBy(desc(agentMessages.id))
    .limit(limit);

  return rows.reverse().map((r) => ({
    id: r.id,
    fromAgentId: r.fromAgentId,
    fromName: r.fromName,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function appendAgentChat(
  db: Database,
  input: { fromAgentId: string; body: string },
): Promise<AgentChatMessage> {
  const body = input.body.trim();
  if (!body || body.length > 1000) throw new Error('dados_invalidos');

  const [inserted] = await db
    .insert(agentMessages)
    .values({ fromAgentId: input.fromAgentId, body })
    .returning({
      id: agentMessages.id,
      fromAgentId: agentMessages.fromAgentId,
      createdAt: agentMessages.createdAt,
      body: agentMessages.body,
    });

  const [agent] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, input.fromAgentId));

  return {
    id: inserted!.id,
    fromAgentId: inserted!.fromAgentId,
    fromName: agent?.name ?? 'Atendente',
    body: inserted!.body,
    createdAt: inserted!.createdAt.toISOString(),
  };
}
