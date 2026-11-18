import type { TopicSlug } from '@orla/shared';
import { and, asc, cosineDistance, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { faq, kbChunks, kbDocuments, topics } from './schema.js';

export interface ChunkInput {
  section: string;
  content: string;
  tokens: number;
  embedding: number[];
}

export interface DocumentInput {
  /** Ex.: `pix/limites-e-horarios.md` — identifica o documento entre uma ingestão e outra. */
  sourcePath: string;
  title: string;
  topic: TopicSlug;
  /** sha256 do conteúdo. */
  contentHash: string;
  chunks: ChunkInput[];
}

async function topicIds(db: Database, slugs: TopicSlug[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: topics.id, slug: topics.slug })
    .from(topics)
    .where(inArray(topics.slug, [...new Set(slugs)]));
  const map = new Map(rows.map((r) => [r.slug, r.id]));
  for (const slug of slugs) if (!map.has(slug)) throw new Error(`Assunto não cadastrado: ${slug}`);
  return map;
}

/** Hash do conteúdo já ingerido (ou `null` se o documento é novo). */
export async function getDocumentHash(db: Database, sourcePath: string): Promise<string | null> {
  const [row] = await db
    .select({ contentHash: kbDocuments.contentHash })
    .from(kbDocuments)
    .where(eq(kbDocuments.sourcePath, sourcePath));
  return row?.contentHash ?? null;
}

/**
 * Grava (ou atualiza) um documento e TROCA todos os trechos dele, numa transação só:
 * quem estiver buscando vê a versão antiga inteira ou a nova inteira, nunca metade.
 *
 * Idempotente: o mesmo conteúdo de novo (SQS entrega "pelo menos uma vez") não muda nada.
 * Duas ingestões simultâneas do mesmo documento: o `ON CONFLICT` trava a linha, a segunda
 * espera a primeira terminar e, vendo o mesmo hash, não faz nada.
 */
export async function saveDocumentWithChunks(
  db: Database,
  input: DocumentInput,
): Promise<{ version: number; changed: boolean }> {
  const topicId = (await topicIds(db, [input.topic])).get(input.topic)!;

  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(kbDocuments)
      .values({
        title: input.title,
        sourcePath: input.sourcePath,
        topicId,
        status: 'publicado',
        contentHash: input.contentHash,
      })
      .onConflictDoUpdate({
        target: kbDocuments.sourcePath,
        set: {
          title: input.title,
          topicId,
          status: 'publicado',
          contentHash: input.contentHash,
          version: sql`${kbDocuments.version} + 1`,
          updatedAt: sql`now()`,
        },
        // Só atualiza se o conteúdo mudou; senão o RETURNING volta vazio.
        setWhere: sql`${kbDocuments.contentHash} <> excluded.content_hash`,
      })
      .returning({ id: kbDocuments.id, version: kbDocuments.version });

    if (!doc) {
      const [current] = await tx
        .select({ version: kbDocuments.version })
        .from(kbDocuments)
        .where(eq(kbDocuments.sourcePath, input.sourcePath));
      return { version: current!.version, changed: false };
    }

    await tx.delete(kbChunks).where(eq(kbChunks.documentId, doc.id));
    await tx.insert(kbChunks).values(
      input.chunks.map((c) => ({
        documentId: doc.id,
        section: c.section,
        content: c.content,
        tokens: c.tokens,
        embedding: c.embedding,
        version: doc.version,
      })),
    );
    return { version: doc.version, changed: true };
  });
}

export interface FaqInput {
  topic: TopicSlug;
  question: string;
  answer: string;
  embedding: number[];
}

/** Sincroniza a FAQ (upsert pela pergunta). Perguntas novas já entram publicadas. */
export async function upsertFaq(db: Database, items: FaqInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const ids = await topicIds(
    db,
    items.map((i) => i.topic),
  );
  const rows = await db
    .insert(faq)
    .values(
      items.map((i) => ({
        topicId: ids.get(i.topic)!,
        question: i.question,
        answer: i.answer,
        embedding: i.embedding,
        status: 'publicado' as const,
      })),
    )
    .onConflictDoUpdate({
      target: faq.question,
      set: {
        topicId: sql`excluded.topic_id`,
        answer: sql`excluded.answer`,
        embedding: sql`excluded.embedding`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: faq.id });
  return rows.length;
}

export interface FaqMatch {
  id: number;
  question: string;
  answer: string;
  /** Similaridade de cosseno: 1 = mesmo sentido, 0 = nada a ver. */
  similarity: number;
}

export interface ChunkHit {
  chunkId: number;
  documentId: number;
  title: string;
  sourcePath: string;
  section: string;
  content: string;
  /** Similaridade de cosseno do trecho com a pergunta (0 a 1). */
  similarity: number;
  /** Pontuação RRF: soma de 1/(60 + posição) em cada busca em que o trecho apareceu. */
  score: number;
  /** Posição na busca por significado e na busca por palavras (`null` = não apareceu). */
  vectorRank: number | null;
  textRank: number | null;
}

/** Constante do RRF: amortece a diferença entre 1º e 2º lugar (valor usual na literatura). */
const RRF_K = 60;

/**
 * Busca híbrida (ADR 0006): por significado (pgvector) + por palavras (texto em português),
 * combinadas por Reciprocal Rank Fusion. Roda com o `ai_reader`; o filtro de publicado está na
 * própria consulta além do RLS (defesa em profundidade, OWASP LLM08).
 */
export async function searchChunks(
  db: Database,
  input: { embedding: number[]; query: string; limit?: number; candidates?: number },
): Promise<ChunkHit[]> {
  const limit = input.limit ?? 5;
  const candidates = input.candidates ?? 20;
  const vector = sql`${JSON.stringify(input.embedding)}::vector`;
  // plainto_tsquery trata o texto do cliente como texto (sem sintaxe de busca) e junta os termos
  // com E; trocamos por OU para que basta um termo coincidir (o ranking ordena por quantos).
  const tsquery = sql`replace(plainto_tsquery('portuguese', ${input.query})::text, ' & ', ' | ')::tsquery`;

  const { rows } = await db.execute<{
    chunk_id: string;
    document_id: number;
    title: string;
    source_path: string;
    section: string;
    content: string;
    similarity: number;
    score: number;
    vector_rank: string | null;
    text_rank: string | null;
  }>(sql`
    WITH publicados AS (
      SELECT c.id, c.embedding, c.tsv
      FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
      WHERE d.status = 'publicado'
    ),
    por_vetor AS (
      SELECT id, row_number() OVER (ORDER BY embedding <=> ${vector}) AS posicao
      FROM publicados ORDER BY embedding <=> ${vector} LIMIT ${candidates}
    ),
    consulta AS (SELECT ${tsquery} AS q),
    por_texto AS (
      SELECT p.id, row_number() OVER (ORDER BY ts_rank_cd(p.tsv, consulta.q) DESC) AS posicao
      FROM publicados p, consulta
      WHERE p.tsv @@ consulta.q
      ORDER BY ts_rank_cd(p.tsv, consulta.q) DESC LIMIT ${candidates}
    )
    SELECT c.id AS chunk_id, d.id AS document_id, d.title, d.source_path, c.section, c.content,
           1 - (c.embedding <=> ${vector}) AS similarity,
           coalesce(1.0 / (${RRF_K} + v.posicao), 0) + coalesce(1.0 / (${RRF_K} + t.posicao), 0)
             AS score,
           v.posicao AS vector_rank, t.posicao AS text_rank
    FROM (SELECT id FROM por_vetor UNION SELECT id FROM por_texto) ids
    JOIN kb_chunks c ON c.id = ids.id
    JOIN kb_documents d ON d.id = c.document_id
    LEFT JOIN por_vetor v ON v.id = c.id
    LEFT JOIN por_texto t ON t.id = c.id
    ORDER BY score DESC, similarity DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    chunkId: Number(r.chunk_id),
    documentId: r.document_id,
    title: r.title,
    sourcePath: r.source_path,
    section: r.section,
    content: r.content,
    similarity: Number(r.similarity),
    score: Number(r.score),
    vectorRank: r.vector_rank === null ? null : Number(r.vector_rank),
    textRank: r.text_rank === null ? null : Number(r.text_rank),
  }));
}

/**
 * A pergunta publicada da FAQ mais parecida com o vetor da pergunta do cliente.
 * Roda com o usuário `ai_reader` no servidor: o RLS garante que só a FAQ publicada aparece.
 */
export async function findClosestFaq(db: Database, embedding: number[]): Promise<FaqMatch | null> {
  const distance = cosineDistance(faq.embedding, embedding);
  const [row] = await db
    .select({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      similarity: sql<number>`1 - (${distance})`.mapWith(Number),
    })
    .from(faq)
    .where(and(eq(faq.status, 'publicado'), isNotNull(faq.embedding)))
    .orderBy(asc(distance))
    .limit(1);
  return row ?? null;
}
