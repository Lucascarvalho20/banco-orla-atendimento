// Calibra o limite de similaridade da FAQ com o Ollama de verdade.
// Uso: pnpm build && pnpm eval:faq   (Ollama aberto, com o nomic-embed-text)
import { readFileSync } from 'node:fs';
import { createOllamaEmbedder, FAQ_MIN_SIMILARITY } from '../../packages/ai/dist/index.js';

const faq = JSON.parse(readFileSync(new URL('../../knowledge/faq.json', import.meta.url), 'utf8'));
const cases = JSON.parse(readFileSync(new URL('./casos.json', import.meta.url), 'utf8'));
const embedder = createOllamaEmbedder({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
  timeoutMs: 60_000,
});

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / Math.sqrt(na * nb);
};

const faqVectors = await embedder.embedQueries(faq.map((f) => f.question));
const queryVectors = await embedder.embedQueries(cases.map((c) => c.pergunta));

let certas = 0;
let erradas = 0;
let semResposta = 0;
let indevidas = 0;
for (const [i, c] of cases.entries()) {
  const scores = faqVectors.map((v) => cosine(queryVectors[i], v));
  const best = scores.indexOf(Math.max(...scores));
  const answered = scores[best] >= FAQ_MIN_SIMILARITY;
  const expected = c.faq === null ? null : faq.findIndex((f) => f.question === c.faq);
  let verdict;
  if (!answered) {
    verdict = expected === null ? 'ok (fora da FAQ)' : 'sem resposta pronta';
    if (expected !== null) semResposta++;
  } else if (expected === null) {
    verdict = 'INDEVIDA';
    indevidas++;
  } else if (best === expected) {
    verdict = 'certa';
    certas++;
  } else {
    verdict = 'ERRADA';
    erradas++;
  }
  process.stdout.write(`${scores[best].toFixed(3)}  ${verdict.padEnd(20)} ${c.pergunta}\n`);
}

process.stdout.write(
  `\nLimite ${FAQ_MIN_SIMILARITY}: ${certas} certas, ${erradas} erradas, ` +
    `${indevidas} respostas indevidas, ${semResposta} sem resposta pronta (vão para a busca).\n`,
);
if (erradas > 0 || indevidas > 0) process.exit(1);
