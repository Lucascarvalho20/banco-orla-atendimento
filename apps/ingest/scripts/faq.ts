// Sincroniza knowledge/faq.json com o banco (vetores das perguntas pelo Ollama).
// A FAQ é pequena e curada: vai direto, sem passar pela fila (ver estudo 05).
import { readFileSync } from 'node:fs';
import { createOllamaEmbedder, embedFaq, faqFileSchema } from '@orla/ai';
import { createDb, databaseUrlForRole, upsertFaq } from '@orla/db';
import { env, log, repoPath } from './aws.js';

const items = faqFileSchema.parse(JSON.parse(readFileSync(repoPath('knowledge/faq.json'), 'utf8')));
const embedder = createOllamaEmbedder({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_EMBED_MODEL,
  timeoutMs: 60_000,
});
const { db, pool } = createDb(
  databaseUrlForRole(env.DATABASE_URL, 'kb_writer', env.KB_WRITER_PASSWORD),
  { max: 1 },
);
try {
  const count = await upsertFaq(db, await embedFaq(items, embedder));
  log(`✓ FAQ sincronizada: ${count} perguntas`);
} finally {
  await pool.end();
}
