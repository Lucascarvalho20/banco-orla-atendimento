import { S3Client } from '@aws-sdk/client-s3';
import { createOllamaEmbedder, ingestDocument } from '@orla/ai';
import { createDb, getDocumentHash, saveDocumentWithChunks } from '@orla/db';
import type { SQSEvent } from 'aws-lambda';
import { z } from 'zod';
import { jsonLogger } from './log.js';
import { processSqsEvent, type ProcessDeps } from './process.js';
import { createS3Reader } from './s3.js';

const envSchema = z.object({
  KB_BUCKET: z.string().min(3),
  // Usuário `kb_writer`: só escreve na base de conhecimento (migration 0004).
  KB_WRITER_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  OLLAMA_BASE_URL: z.url(),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  AWS_REGION: z.string().default('us-east-1'),
});

/**
 * Criado na primeira invocação e reaproveitado enquanto a Lambda está "quente": abrir conexão
 * com o banco a cada mensagem seria lento e esgotaria as conexões.
 */
let deps: ProcessDeps | undefined;

function buildDeps(): ProcessDeps {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${fields}`);
  }
  const env = parsed.data;
  // Pool pequeno: N Lambdas em paralelo × conexões de cada uma ≤ limite do kb_writer (5).
  const { db } = createDb(env.KB_WRITER_DATABASE_URL, { max: 2 });
  const embedder = createOllamaEmbedder({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_EMBED_MODEL,
    timeoutMs: 20_000,
  });
  const s3 = new S3Client({ region: env.AWS_REGION, forcePathStyle: true });

  return {
    bucket: env.KB_BUCKET,
    getObject: createS3Reader(s3, env.KB_BUCKET),
    ingest: (key, markdown) =>
      ingestDocument(
        { key, markdown },
        {
          embedder,
          store: {
            getDocumentHash: (sourcePath) => getDocumentHash(db, sourcePath),
            saveDocument: (input) => saveDocumentWithChunks(db, input),
          },
        },
      ),
    log: jsonLogger,
  };
}

export const handler = (event: SQSEvent) => processSqsEvent(event, (deps ??= buildDeps()));
