import { z } from 'zod';
import { topicSlugSchema } from './topics.js';

export const MAX_MESSAGE_LENGTH = 1000;

export type MessageSender = 'customer' | 'ai' | 'agent' | 'system';

/** Documento que embasou uma resposta do assistente (mostrado como "Fonte: …"). */
export interface ChatSource {
  title: string;
  section: string;
}

/** Mensagem como o navegador enxerga (sem ids internos do banco). */
export interface ChatMessage {
  seq: number;
  clientMsgId: string | null;
  sender: MessageSender;
  body: string;
  /** Só nas respostas tiradas dos documentos (RAG). */
  sources?: ChatSource[];
  createdAt: string;
}

// ---------------------------------------------------------------- eventos do Socket.IO
// Nomes e formatos num lugar só: front e back não divergem.

export const entrarSchema = z.object({
  topic: topicSlugSchema,
  /** Última `seq` que o navegador já tem (0 = nenhuma). Na reconexão, só vem o que falta. */
  afterSeq: z.number().int().min(0).default(0),
  /** Preferencial sobe a prioridade da conversa na fila humana. */
  preferential: z.boolean().default(false),
});

export const enviarSchema = z.object({
  /** UUID gerado no navegador: reenviar a mesma mensagem não duplica. */
  clientMsgId: z.uuid(),
  body: z
    .string()
    .trim()
    .min(1, 'Escreva uma mensagem.')
    .max(MAX_MESSAGE_LENGTH, `Use no máximo ${MAX_MESSAGE_LENGTH} caracteres.`),
});

export type ChatError =
  | 'dados_invalidos'
  | 'sem_conversa'
  | 'muitas_mensagens'
  | 'erro_interno'
  | 'ja_na_fila'
  | 'nao_pode_enfileirar';

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: ChatError };

export interface ServerToClientEvents {
  'mensagem:nova': (message: ChatMessage) => void;
  /** O assistente começou (`true`) ou terminou (`false`) de preparar uma resposta. */
  'assistente:digitando': (typing: boolean) => void;
  /** Cliente entrou na fila humana (ou voltou a ela). */
  'fila:atualizada': (data: { status: 'queued' | 'offered' | 'active'; position?: number }) => void;
  /** Mesa: equipe mudou presença. */
  'equipe:estado': (data: { team: import('./agent.js').AgentTeamMember[] }) => void;
  /** Chat interno entre atendentes. */
  'equipe:mensagem': (message: import('./agent.js').AgentTeamChatMessage) => void;
  /** Mesa: fila/ativas mudaram — cliente do painel recarrega. */
  'mesa:atualizada': () => void;
  'fila:oferta': (item: import('./agent.js').AgentQueueItem) => void;
  'fila:oferta_expirada': (data: { conversationId: string }) => void;
}

export interface ClientToServerEvents {
  'conversa:entrar': (
    data: z.input<typeof entrarSchema>,
    ack: (res: Ack<{ messages: ChatMessage[] }>) => void,
  ) => void;
  'mensagem:enviar': (
    data: z.input<typeof enviarSchema>,
    /** `body` = o texto como foi gravado (com dados sensíveis já escondidos). */
    ack: (res: Ack<{ seq: number; duplicate: boolean; body: string }>) => void,
  ) => void;
  /** Cliente pede atendente humano (triagem → fila). */
  'fila:pedir': (ack: (res: Ack<{ status: 'queued' }>) => void) => void;
}

/**
 * Junta mensagens novas na lista sem duplicar: a mesma mensagem pode chegar pelo `ack`, pelo
 * evento `mensagem:nova` e de novo na reconexão. Chave: `seq` (ordem definida pelo servidor).
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const bySeq = new Map(current.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
