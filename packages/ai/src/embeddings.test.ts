import { EMBEDDING_DIMENSIONS } from '@orla/shared';
import { describe, expect, it, vi } from 'vitest';
import { createOllamaEmbedder, EmbeddingError } from './embeddings.js';

const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5);

/** `fetch` falso: devolve um vetor para cada texto recebido e guarda os corpos enviados. */
function fakeOllama(makeVector = vector) {
  return vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const { input } = JSON.parse(String(init!.body)) as { input: string[] };
    return Response.json({ embeddings: input.map(makeVector) });
  });
}

const options = { baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' };

describe('createOllamaEmbedder', () => {
  it('usa o prefixo certo para documento e para pergunta', async () => {
    const fetchFn = fakeOllama();
    const embedder = createOllamaEmbedder({ ...options, fetchFn });
    await embedder.embedDocuments(['trecho']);
    await embedder.embedQueries(['pergunta']);
    const bodies = fetchFn.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));
    expect(bodies[0]).toEqual({ model: 'nomic-embed-text', input: ['search_document: trecho'] });
    expect(bodies[1].input).toEqual(['search_query: pergunta']);
  });

  it('manda em lotes e devolve os vetores na ordem', async () => {
    const fetchFn = fakeOllama();
    const embedder = createOllamaEmbedder({ ...options, batchSize: 2, fetchFn });
    const result = await embedder.embedDocuments(['a', 'b', 'c', 'd', 'e']);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(5);
  });

  it('erro HTTP vira EmbeddingError', async () => {
    const fetchFn = vi.fn(async () => new Response('falhou', { status: 500 }));
    const embedder = createOllamaEmbedder({ ...options, fetchFn });
    await expect(embedder.embedQueries(['x'])).rejects.toThrow(EmbeddingError);
  });

  it('Ollama fora do ar vira EmbeddingError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const embedder = createOllamaEmbedder({ ...options, fetchFn });
    await expect(embedder.embedQueries(['x'])).rejects.toThrow('Ollama indisponível');
  });

  it('recusa vetor com dimensão errada (modelo trocado sem migrar o banco)', async () => {
    const fetchFn = fakeOllama(() => [0.1, 0.2, 0.3]);
    const embedder = createOllamaEmbedder({ ...options, fetchFn });
    await expect(embedder.embedQueries(['x'])).rejects.toThrow('768 dimensões');
  });

  it('recusa resposta em formato inesperado', async () => {
    const fetchFn = vi.fn(async () => Response.json({ outra: 'coisa' }));
    const embedder = createOllamaEmbedder({ ...options, fetchFn });
    await expect(embedder.embedQueries(['x'])).rejects.toThrow('formato inesperado');
  });
});
