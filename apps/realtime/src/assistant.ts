import {
  answerWithRag,
  checkOutput,
  detectInjection,
  GUARDS_VERSION,
  maskSensitiveData,
  matchFaq,
  RAG_PROMPT_LEAK_SOURCE,
  RAG_PROMPT_VERSION,
  type Embedder,
  type FaqCandidate,
  type LanguageModel,
  type RagChunk,
} from '@orla/ai';
import type { ChatSource } from '@orla/shared';

export type AssistantAnswer =
  /** Texto gravado na FAQ, nunca algo gerado a partir da pergunta. */
  | { kind: 'faq'; body: string }
  /** Gerado pelo modelo a partir dos documentos e conferido pelo código (citações, números, fidelidade). */
  | { kind: 'rag'; body: string; sources: ChatSource[] }
  | { kind: 'not_found' }
  /** A conversa já usou todas as perguntas aos documentos (a FAQ continua respondendo). */
  | { kind: 'limit' }
  /** Tentativa de manipular a IA: recusada sem chamar o modelo. */
  | { kind: 'blocked' };

/** Quem responde o cliente automaticamente. Nos testes, uma versão falsa cumpre o mesmo papel. */
export interface Assistant {
  answer(question: string, ctx: { conversationId: string }): Promise<AssistantAnswer>;
}

export interface TraceStore {
  /** Quantas perguntas desta conversa já foram para o RAG (conta os traces `rag-*`). */
  countRag(conversationId: string): Promise<number>;
  record(trace: {
    conversationId: string;
    promptVersion: string;
    model: string;
    latencyMs: number;
    data: Record<string, unknown>;
  }): Promise<void>;
}

/** Perguntas aos documentos por conversa: cada uma ocupa a GPU por ~1 s (anti-abuso e anti-custo). */
export const RAG_MAX_PER_CONVERSATION = 15;

export function createAssistant(deps: {
  embedder: Embedder;
  llm: LanguageModel;
  findClosestFaq: (embedding: number[]) => Promise<FaqCandidate | null>;
  searchChunks: (input: { embedding: number[]; query: string }) => Promise<RagChunk[]>;
  traces: TraceStore;
  faqMinSimilarity?: number;
  ragMaxPerConversation?: number;
  /** Falha ao gravar o trace não pode custar a resposta do cliente: só vira log. */
  onTraceError: (error: unknown) => void;
  now?: () => number;
}): Assistant {
  const now = deps.now ?? Date.now;
  const maxRag = deps.ragMaxPerConversation ?? RAG_MAX_PER_CONVERSATION;

  const record = (trace: Parameters<TraceStore['record']>[0]) =>
    deps.traces.record(trace).catch(deps.onTraceError);
  const guardTrace = (conversationId: string, data: Record<string, unknown>) =>
    record({ conversationId, promptVersion: GUARDS_VERSION, model: 'guarda', latencyMs: 0, data });

  return {
    async answer(rawQuestion, { conversationId }) {
      // O chat já mascara antes de gravar; repetir aqui protege qualquer outro caminho até a IA.
      const question = maskSensitiveData(rawQuestion).text;
      const injection = detectInjection(question);
      if (injection) {
        await guardTrace(conversationId, { stage: 'input', kind: injection });
        return { kind: 'blocked' };
      }

      // Um vetor só para as duas buscas: a FAQ e os documentos usam o mesmo prefixo de pergunta.
      const [embedding] = await deps.embedder.embedQueries([question]);
      const faq = await matchFaq(embedding!, {
        findClosest: deps.findClosestFaq,
        minSimilarity: deps.faqMinSimilarity,
      });
      if (faq) {
        // A FAQ é revisada, mas se alguém envenenar o arquivo, a guarda ainda segura.
        const issue = checkOutput(faq.answer);
        if (!issue) return { kind: 'faq', body: faq.answer };
        await guardTrace(conversationId, { stage: 'output', source: 'faq', issue });
        return { kind: 'not_found' };
      }

      if ((await deps.traces.countRag(conversationId)) >= maxRag) return { kind: 'limit' };

      const started = now();
      const { result, trace } = await answerWithRag(
        { question, embedding: embedding! },
        { search: deps.searchChunks, llm: deps.llm, embedder: deps.embedder },
      );
      const issue =
        result.status === 'answered'
          ? checkOutput(result.body, { leakSources: [RAG_PROMPT_LEAK_SOURCE] })
          : null;
      await record({
        conversationId,
        promptVersion: RAG_PROMPT_VERSION,
        model: deps.llm.model,
        latencyMs: now() - started,
        data: {
          status: issue ? 'blocked' : result.status,
          ...(result.status === 'not_found'
            ? { reason: result.reason }
            : { citedChunkIds: result.citedChunkIds }),
          ...(issue ? { guard: GUARDS_VERSION, issue } : {}),
          ...trace,
        },
      });

      if (result.status !== 'answered' || issue) return { kind: 'not_found' };
      return {
        kind: 'rag',
        body: result.body,
        sources: result.sources.map(({ title, section }) => ({
          title,
          // A seção vem com o caminho dos títulos ("Pix: limites › Pix agendado"): sem repetir o título.
          section: section.startsWith(`${title} › `) ? section.slice(title.length + 3) : section,
        })),
      };
    },
  };
}
