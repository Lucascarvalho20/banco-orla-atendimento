export interface Chunk {
  /** Onde o trecho está no documento, ex.: "Pix: limites e horários › Pix agendado". Vira a fonte citada. */
  section: string;
  content: string;
  tokens: number;
}

/**
 * Estimativa de tokens (~4 caracteres por token em português). Não precisa ser exata: serve
 * para manter os trechos num tamanho que cabe no prompt e no modelo de embedding.
 */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Divide um Markdown em trechos para a busca:
 * - cada seção `##` vira um ou mais trechos (um assunto por trecho = busca mais precisa);
 * - parágrafos são agrupados até `maxTokens`; parágrafo gigante é cortado por linhas/frases;
 * - linhas de citação (`>`) são avisos editoriais ("documento fictício") e não entram na base.
 */
export function chunkMarkdown(markdown: string, { maxTokens = 300 } = {}): Chunk[] {
  let title = '';
  let heading = '';
  let lines: string[] = [];
  const chunks: Chunk[] = [];

  const flush = () => {
    const section = heading ? `${title} › ${heading}` : title;
    const paragraphs = lines
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => splitLong(p, maxTokens));

    let current = '';
    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (current && estimateTokens(candidate) > maxTokens) {
        chunks.push({ section, content: current, tokens: estimateTokens(current) });
        current = paragraph;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push({ section, content: current, tokens: estimateTokens(current) });
    lines = [];
  };

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const h1 = /^#\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h1) {
      flush();
      title = h1[1]!.trim();
      heading = '';
    } else if (h2) {
      flush();
      heading = h2[1]!.trim();
    } else if (!line.startsWith('>')) {
      lines.push(line);
    }
  }
  flush();
  return chunks;
}

/** Corta um parágrafo maior que o limite: primeiro por linhas (listas), depois por frases. */
function splitLong(paragraph: string, maxTokens: number): string[] {
  if (estimateTokens(paragraph) <= maxTokens) return [paragraph];
  const byLine = paragraph.split('\n');
  const pieces = byLine.length > 1 ? byLine : paragraph.split(/(?<=[.!?])\s+/);
  if (pieces.length === 1) {
    // Sem quebra natural: corta no tamanho (último recurso).
    const size = maxTokens * 4;
    return Array.from({ length: Math.ceil(paragraph.length / size) }, (_, i) =>
      paragraph.slice(i * size, (i + 1) * size),
    );
  }
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current}\n${piece}` : piece;
    if (current && estimateTokens(candidate) > maxTokens) {
      out.push(...splitLong(current, maxTokens));
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(...splitLong(current, maxTokens));
  return out;
}
