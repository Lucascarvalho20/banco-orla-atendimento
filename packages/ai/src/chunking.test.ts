import { describe, expect, it } from 'vitest';
import { chunkMarkdown, estimateTokens } from './chunking.js';

const doc = `# Pix: limites

> Documento fictício.

Introdução do documento.

## Limite noturno

Das 20h às 6h o limite é R$ 1.000.

## Pix agendado

Pode ser agendado com até 60 dias.

Cancelamento até 23h59 do dia anterior.
`;

describe('chunkMarkdown', () => {
  it('um trecho por seção, com o caminho "Título › Seção"', () => {
    expect(chunkMarkdown(doc).map((c) => c.section)).toEqual([
      'Pix: limites',
      'Pix: limites › Limite noturno',
      'Pix: limites › Pix agendado',
    ]);
  });

  it('não leva o aviso em citação (>) para a base', () => {
    expect(chunkMarkdown(doc).some((c) => c.content.includes('fictício'))).toBe(false);
  });

  it('junta parágrafos da mesma seção enquanto cabem no limite', () => {
    const agendado = chunkMarkdown(doc).at(-1)!;
    expect(agendado.content).toBe(
      'Pode ser agendado com até 60 dias.\n\nCancelamento até 23h59 do dia anterior.',
    );
  });

  it('seção grande vira vários trechos, nenhum acima do limite', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i}. `.repeat(10));
    const chunks = chunkMarkdown(`# T\n\n## S\n\n${paragraphs.join('\n\n')}`, { maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.tokens <= 100)).toBe(true);
    // Nada se perde: todo parágrafo aparece em algum trecho.
    const all = chunks.map((c) => c.content).join('\n\n');
    for (const p of paragraphs) expect(all).toContain(p.trim());
  });

  it('parágrafo sem quebra nenhuma é cortado no tamanho (último recurso)', () => {
    const chunks = chunkMarkdown(`# T\n\n${'x'.repeat(2000)}`, { maxTokens: 100 });
    expect(chunks).toHaveLength(5);
    expect(chunks.every((c) => c.tokens <= 100)).toBe(true);
  });

  it('documento vazio não gera trechos', () => {
    expect(chunkMarkdown('# Só o título\n')).toEqual([]);
  });

  it('estimateTokens ≈ 4 caracteres por token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
