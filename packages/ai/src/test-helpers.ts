import { EMBEDDING_DIMENSIONS } from '@orla/shared';
import type { Embedder } from './embeddings.js';

/**
 * Embedder falso e determinístico: o mesmo texto sempre dá o mesmo vetor, e guarda o que
 * recebeu para o teste conferir. Fica fora do build (só os testes importam).
 */
export function fakeEmbedder() {
  const calls: { kind: 'document' | 'query'; texts: string[] }[] = [];
  const vector = (text: string) =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => ((text.length + i) % 7) / 7);
  const embedder: Embedder = {
    model: 'fake',
    async embedDocuments(texts) {
      calls.push({ kind: 'document', texts });
      return texts.map(vector);
    },
    async embedQueries(texts) {
      calls.push({ kind: 'query', texts });
      return texts.map(vector);
    },
  };
  return { embedder, calls };
}
