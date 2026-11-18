import { topicSlugSchema } from '@orla/shared';
import { z } from 'zod';
import type { Embedder } from './embeddings.js';

/** Formato de `knowledge/faq.json` (validado antes de ir para o banco). */
export const faqFileSchema = z
  .array(
    z.object({
      topic: topicSlugSchema,
      question: z.string().trim().min(5).max(200),
      answer: z.string().trim().min(10).max(1000),
    }),
  )
  .max(500);
export type FaqFile = z.infer<typeof faqFileSchema>;

export interface FaqCandidate {
  question: string;
  answer: string;
  similarity: number;
}

/**
 * Similaridade mínima para responder pela FAQ, calibrada com o `nomic-embed-text`
 * (`pnpm eval:faq`): o maior acerto da pergunta ERRADA ficou em 0,777 e a maior pergunta fora da
 * FAQ em 0,767. Com 0,8, nenhuma resposta errada; o que fica abaixo segue para a busca nos
 * documentos (Etapa 6). Preferimos não responder a responder errado.
 */
export const FAQ_MIN_SIMILARITY = 0.8;

interface FaqLookup {
  findClosest: (embedding: number[]) => Promise<FaqCandidate | null>;
  minSimilarity?: number | undefined;
}

/** Resposta pronta da FAQ para um vetor de pergunta já calculado (reaproveitado pelo RAG). */
export async function matchFaq(embedding: number[], deps: FaqLookup): Promise<FaqCandidate | null> {
  const candidate = await deps.findClosest(embedding);
  const min = deps.minSimilarity ?? FAQ_MIN_SIMILARITY;
  return candidate && candidate.similarity >= min ? candidate : null;
}

/** Resposta pronta da FAQ, se houver uma parecida o bastante com a pergunta. */
export async function findFaqAnswer(
  question: string,
  deps: FaqLookup & { embedder: Embedder },
): Promise<FaqCandidate | null> {
  const [embedding] = await deps.embedder.embedQueries([question]);
  return matchFaq(embedding!, deps);
}

/** Vetores das perguntas da FAQ: mesmo prefixo da pergunta do cliente (comparação pergunta × pergunta). */
export async function embedFaq(items: FaqFile, embedder: Embedder) {
  const embeddings = await embedder.embedQueries(items.map((i) => i.question));
  return items.map((item, i) => ({ ...item, embedding: embeddings[i]! }));
}
