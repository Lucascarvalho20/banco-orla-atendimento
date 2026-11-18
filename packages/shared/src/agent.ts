import { z } from 'zod';

export const OFFER_TIMEOUT_MS = 30_000;

export const agentLoginSchema = z.object({
  email: z.email().max(120),
  password: z.string().min(8).max(72),
});

export const agentPresenceSchema = z.object({
  status: z.enum(['online', 'offline', 'away']),
});

/** Cartão da conversa na fila / oferta / atendimento ativo. */
export interface AgentQueueItem {
  id: string;
  topicSlug: string;
  topicName: string;
  displayName: string;
  cpfLast2: string;
  aiSummary: string | null;
  priority: number;
  queuedAt: string | null;
  status: 'queued' | 'offered' | 'active';
  /** Atendente dono (quando active); null na fila. */
  agentId?: string | null;
  agentName?: string | null;
}

/** Presença da equipe no painel. */
export interface AgentTeamMember {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'supervisor';
  status: 'online' | 'offline' | 'away';
  activeCount: number;
}

/** Perfil seguro do cliente (sem CPF completo). */
export interface CustomerProfile {
  displayName: string;
  cpfLast2: string;
  topicSlug: string;
  topicName: string;
  conversationStatus: 'queued' | 'offered' | 'active';
  aiSummary: string | null;
  agentName: string | null;
}

/** Mensagem do chat interno da equipe. */
export interface AgentTeamChatMessage {
  id: number;
  fromAgentId: string;
  fromName: string;
  body: string;
  createdAt: string;
}

export type AgentError =
  | 'dados_invalidos'
  | 'nao_autorizado'
  | 'somente_leitura'
  | 'oferta_invalida'
  | 'atendente_indisponivel'
  | 'erro_interno';

export type AgentAck<T> = ({ ok: true } & T) | { ok: false; error: AgentError };
