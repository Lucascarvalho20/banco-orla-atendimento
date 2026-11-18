// Avalia a busca da base de conhecimento com o banco e o Ollama de verdade.
// Uso: pnpm build && pnpm eval:busca   (Docker e Ollama abertos, base já ingerida: pnpm kb:upload)
//
// Compara 3 jeitos de ordenar os mesmos candidatos: só vetor, só texto e híbrida (RRF).
// Recall@k: a seção certa apareceu entre as k primeiras?  MRR: média de 1/posição da seção certa.
import { readFileSync } from 'node:fs';
import { createOllamaEmbedder } from '../../packages/ai/dist/index.js';
import { createDb, databaseUrlForRole, searchChunks } from '../../packages/db/dist/index.js';

process.loadEnvFile(new URL('../../.env', import.meta.url));
const cases = JSON.parse(readFileSync(new URL('./casos.json', import.meta.url), 'utf8'));
const embedder = createOllamaEmbedder({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
  timeoutMs: 60_000,
});
const reader = createDb(
  databaseUrlForRole(process.env.DATABASE_URL, 'ai_reader', process.env.AI_READER_PASSWORD),
  { max: 2 },
);

const vectors = await embedder.embedQueries(cases.map((c) => c.pergunta));
const methods = {
  vetor: (hits) => hits.filter((h) => h.vectorRank).sort((a, b) => a.vectorRank - b.vectorRank),
  texto: (hits) => hits.filter((h) => h.textRank).sort((a, b) => a.textRank - b.textRank),
  hibrida: (hits) => hits,
};
const totals = Object.fromEntries(Object.keys(methods).map((m) => [m, { r1: 0, r5: 0, mrr: 0 }]));
const inScope = [];
const outScope = [];

for (const [i, c] of cases.entries()) {
  const hits = await searchChunks(reader.db, {
    embedding: vectors[i],
    query: c.pergunta,
    limit: 40,
  });
  const top = Math.max(...hits.map((h) => h.similarity));
  if (c.fonte === null) {
    outScope.push(top);
    process.stdout.write(`${top.toFixed(3)}  fora do assunto   ${c.pergunta}\n`);
    continue;
  }
  inScope.push(top);
  const isRight = (h) => h.sourcePath === c.fonte && h.section.endsWith(c.secao);
  const positions = {};
  for (const [name, order] of Object.entries(methods)) {
    const pos = order(hits).findIndex(isRight) + 1; // 0 = não achou
    positions[name] = pos || '-';
    if (pos === 1) totals[name].r1++;
    if (pos >= 1 && pos <= 5) totals[name].r5++;
    if (pos >= 1) totals[name].mrr += 1 / pos;
  }
  process.stdout.write(
    `${top.toFixed(3)}  vetor ${String(positions.vetor).padStart(2)} | texto ${String(positions.texto).padStart(2)} | híbrida ${String(positions.hibrida).padStart(2)}   ${c.pergunta}\n`,
  );
}

const n = inScope.length;
process.stdout.write(`\n${n} perguntas da base:\n`);
for (const [name, t] of Object.entries(totals)) {
  process.stdout.write(
    `  ${name.padEnd(8)} Recall@1 ${(t.r1 / n).toFixed(2)}  Recall@5 ${(t.r5 / n).toFixed(2)}  MRR ${(t.mrr / n).toFixed(2)}\n`,
  );
}
process.stdout.write(
  `\nMaior similaridade do melhor trecho:\n` +
    `  perguntas da base:  menor ${Math.min(...inScope).toFixed(3)}\n` +
    `  fora do assunto:    maior ${Math.max(...outScope).toFixed(3)}\n`,
);
await reader.pool.end();
