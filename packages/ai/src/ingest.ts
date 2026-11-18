import { createHash } from 'node:crypto';
import { topicSlugSchema, type TopicSlug } from '@orla/shared';
import { chunkMarkdown } from './chunking.js';
import type { Embedder } from './embeddings.js';

/** Limites contra documento gigante (custo de embedding e tempo da Lambda — OWASP LLM10). */
export const MAX_DOCUMENT_BYTES = 200_000;
export const MAX_CHUNKS_PER_DOCUMENT = 200;

/** Erro do documento em si (não adianta tentar de novo): vai para a DLQ para alguém olhar. */
export class InvalidDocumentError extends Error {
  override name = 'InvalidDocumentError';
}

const KEY_PATTERN = /^docs\/([a-z]+)\/([a-z0-9-]{1,80})\.md$/;

/**
 * Valida o caminho do arquivo no bucket: `docs/<assunto>/<nome>.md`.
 * Lista do que é permitido (e não do que é proibido): barra `../`, maiúsculas, espaços, outras
 * extensões e assuntos que não existem.
 */
export function parseKnowledgeKey(key: string): { topic: TopicSlug; sourcePath: string } | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const topic = topicSlugSchema.safeParse(match[1]);
  if (!topic.success) return null;
  return { topic: topic.data, sourcePath: `${match[1]}/${match[2]}.md` };
}

export const extractTitle = (markdown: string) => /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? null;

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** O que a ingestão precisa do banco (implementado com o usuário `kb_writer`). */
export interface KnowledgeStore {
  getDocumentHash(sourcePath: string): Promise<string | null>;
  saveDocument(input: {
    sourcePath: string;
    title: string;
    topic: TopicSlug;
    contentHash: string;
    chunks: { section: string; content: string; tokens: number; embedding: number[] }[];
  }): Promise<{ version: number; changed: boolean }>;
}

export type IngestResult =
  | { status: 'unchanged'; sourcePath: string }
  | { status: 'ingested'; sourcePath: string; version: number; chunks: number };

/**
 * Ingestão de um documento: valida → confere o hash (não reprocessa o que não mudou) →
 * divide em trechos → gera os vetores → grava tudo numa transação.
 */
export async function ingestDocument(
  input: { key: string; markdown: string },
  deps: { embedder: Embedder; store: KnowledgeStore },
): Promise<IngestResult> {
  const parsed = parseKnowledgeKey(input.key);
  if (!parsed) throw new InvalidDocumentError('Caminho fora do padrão docs/<assunto>/<nome>.md');
  if (Buffer.byteLength(input.markdown, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new InvalidDocumentError(`Documento maior que ${MAX_DOCUMENT_BYTES} bytes`);
  }
  const title = extractTitle(input.markdown);
  if (!title) throw new InvalidDocumentError('Documento sem título (linha "# ...")');

  const contentHash = sha256(input.markdown);
  if ((await deps.store.getDocumentHash(parsed.sourcePath)) === contentHash) {
    return { status: 'unchanged', sourcePath: parsed.sourcePath };
  }

  const chunks = chunkMarkdown(input.markdown);
  if (chunks.length === 0) throw new InvalidDocumentError('Documento sem conteúdo');
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new InvalidDocumentError(`Mais de ${MAX_CHUNKS_PER_DOCUMENT} trechos`);
  }

  // A seção vai junto no texto do vetor: "Pix agendado" ajuda a achar o trecho certo.
  const embeddings = await deps.embedder.embedDocuments(
    chunks.map((c) => `${c.section}\n${c.content}`),
  );
  const { version, changed } = await deps.store.saveDocument({
    ...parsed,
    title,
    contentHash,
    chunks: chunks.map((c, i) => ({ ...c, embedding: embeddings[i]! })),
  });
  if (!changed) return { status: 'unchanged', sourcePath: parsed.sourcePath };
  return { status: 'ingested', sourcePath: parsed.sourcePath, version, chunks: chunks.length };
}
