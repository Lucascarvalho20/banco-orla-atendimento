// Avalia o RAG de ponta a ponta com o Llama de verdade (busca + modelo + conferência das citações).
// Uso: pnpm build && pnpm eval:rag   (Docker e Ollama abertos, base já ingerida)
//
// Pergunta da base: precisa responder citando o documento certo.
// Pergunta fora do assunto: precisa dizer "não sei" (responder qualquer coisa é falha grave).
import { readFileSync } from 'node:fs';
import {
  answerWithRag,
  createOllamaChat,
  createOllamaEmbedder,
} from '../../packages/ai/dist/index.js';
import { createDb, databaseUrlForRole, searchChunks } from '../../packages/db/dist/index.js';

process.loadEnvFile(new URL('../../.env', import.meta.url));
const cases = JSON.parse(readFileSync(new URL('./casos.json', import.meta.url), 'utf8'));
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const embedder = createOllamaEmbedder({
  baseUrl,
  model: process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
  timeoutMs: 60_000,
});
const llm = createOllamaChat({
  baseUrl,
  model: process.env.OLLAMA_CHAT_MODEL ?? 'llama3.1:8b',
  timeoutMs: 120_000,
});
const reader = createDb(
  databaseUrlForRole(process.env.DATABASE_URL, 'ai_reader', process.env.AI_READER_PASSWORD),
  { max: 2 },
);
const search = (q) => searchChunks(reader.db, q);

// Aquece o modelo (a primeira chamada carrega 5 GB na GPU) para não distorcer os tempos.
await llm.chat([{ role: 'user', content: 'oi' }]);

const counts = { certa: 0, fonteErrada: 0, naoSeiIndevido: 0, foraOk: 0, inventou: 0 };
const latencies = [];
const reasons = {};
for (const c of cases) {
  const [embedding] = await embedder.embedQueries([c.pergunta]);
  const start = performance.now();
  const { result } = await answerWithRag(
    { question: c.pergunta, embedding },
    { search, llm, embedder },
  );
  latencies.push(performance.now() - start);

  let verdict;
  if (result.status === 'not_found') {
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    verdict = c.fonte === null ? 'ok (não sei)' : `NÃO SEI INDEVIDO (${result.reason})`;
    counts[c.fonte === null ? 'foraOk' : 'naoSeiIndevido']++;
  } else if (c.fonte === null) {
    verdict = 'INVENTOU';
    counts.inventou++;
  } else if (result.sources.some((s) => [c.fonte, ...(c.tambem ?? [])].includes(s.sourcePath))) {
    verdict = 'certa';
    counts.certa++;
  } else {
    verdict = 'FONTE ERRADA';
    counts.fonteErrada++;
  }
  process.stdout.write(`\n[${verdict}] ${c.pergunta}\n`);
  if (result.status === 'answered') {
    process.stdout.write(`  ${result.body.replace(/\n/g, ' ')}\n`);
    process.stdout.write(`  fontes: ${result.sources.map((s) => s.section).join(' | ')}\n`);
  }
}

latencies.sort((a, b) => a - b);
const p = (q) =>
  (latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] / 1000).toFixed(1);
const inScope = cases.filter((c) => c.fonte !== null).length;
process.stdout.write(
  `\nDa base (${inScope}): ${counts.certa} certas, ${counts.fonteErrada} com fonte errada, ` +
    `${counts.naoSeiIndevido} "não sei" indevidos\n` +
    `Fora do assunto (${cases.length - inScope}): ${counts.foraOk} "não sei" corretos, ` +
    `${counts.inventou} respostas inventadas\n` +
    `Motivos dos "não sei": ${JSON.stringify(reasons)}\n` +
    `Tempo (busca + modelo): mediana ${p(0.5)} s, p95 ${p(0.95)} s\n`,
);
await reader.pool.end();
// Falha grave = responder o que a base não diz. Fonte errada (conteúdo certo, citação trocada)
// fica no relatório como limitação conhecida do modelo de 8B.
if (counts.inventou > 0) process.exit(1);
