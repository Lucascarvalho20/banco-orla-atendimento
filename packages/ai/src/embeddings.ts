import { EMBEDDING_DIMENSIONS } from '@orla/shared';
import { z } from 'zod';

/** Transforma texto em vetor. Nos testes, uma versão falsa cumpre o mesmo contrato. */
export interface Embedder {
  readonly model: string;
  /** Trechos da base (o que será encontrado). */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Perguntas (o que procura). */
  embedQueries(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  override name = 'EmbeddingError';
}

const responseSchema = z.object({ embeddings: z.array(z.array(z.number())) });

export interface OllamaEmbedderOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** Quantos textos por chamada (o Ollama processa em lote). */
  batchSize?: number;
  fetchFn?: typeof fetch;
}

/**
 * Embeddings pelo Ollama local (`POST /api/embed`).
 *
 * O `nomic-embed-text` foi treinado com prefixos que dizem o papel do texto:
 * `search_document:` para o que é guardado e `search_query:` para a pergunta. Sem eles, a busca
 * fica visivelmente pior.
 */
export function createOllamaEmbedder(options: OllamaEmbedderOptions): Embedder {
  const { baseUrl, model, timeoutMs = 15_000, batchSize = 16, fetchFn = fetch } = options;

  async function call(input: string[]): Promise<number[][]> {
    let response: Response;
    try {
      response = await fetchFn(new URL('/api/embed', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new EmbeddingError('Ollama indisponível ou lento demais', { cause: error });
    }
    if (!response.ok) throw new EmbeddingError(`Ollama respondeu HTTP ${response.status}`);

    // A resposta é validada como qualquer entrada externa: tamanho, dimensão e números válidos.
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new EmbeddingError('Resposta do Ollama em formato inesperado');
    const { embeddings } = parsed.data;
    if (embeddings.length !== input.length) {
      throw new EmbeddingError('Ollama devolveu quantidade errada de vetores');
    }
    for (const vector of embeddings) {
      if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
        throw new EmbeddingError(`Vetor inválido (esperado ${EMBEDDING_DIMENSIONS} dimensões)`);
      }
    }
    return embeddings;
  }

  async function embed(prefix: string, texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      out.push(...(await call(texts.slice(i, i + batchSize).map((t) => `${prefix}${t}`))));
    }
    return out;
  }

  return {
    model,
    embedDocuments: (texts) => embed('search_document: ', texts),
    embedQueries: (texts) => embed('search_query: ', texts),
  };
}
