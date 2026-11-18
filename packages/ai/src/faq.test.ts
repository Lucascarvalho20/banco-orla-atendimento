import { describe, expect, it } from 'vitest';
import { embedFaq, faqFileSchema, findFaqAnswer } from './faq.js';
import { fakeEmbedder } from './test-helpers.js';

const candidate = (similarity: number) => ({
  question: 'Qual o limite do Pix à noite?',
  answer: 'R$ 1.000.',
  similarity,
});

describe('findFaqAnswer', () => {
  it('responde pela FAQ quando a pergunta é parecida o bastante', async () => {
    const { embedder, calls } = fakeEmbedder();
    const result = await findFaqAnswer('limite pix noite', {
      embedder,
      findClosest: async () => candidate(0.91),
    });
    expect(result?.answer).toBe('R$ 1.000.');
    expect(calls[0]).toEqual({ kind: 'query', texts: ['limite pix noite'] });
  });

  it('abaixo do limite de similaridade: sem resposta pronta', async () => {
    const { embedder } = fakeEmbedder();
    const result = await findFaqAnswer('quero um empréstimo', {
      embedder,
      findClosest: async () => candidate(0.55),
    });
    expect(result).toBeNull();
  });

  it('FAQ vazia: sem resposta pronta', async () => {
    const { embedder } = fakeEmbedder();
    expect(await findFaqAnswer('oi', { embedder, findClosest: async () => null })).toBeNull();
  });
});

describe('arquivo da FAQ', () => {
  it('recusa assunto inexistente e resposta vazia', () => {
    expect(
      faqFileSchema.safeParse([{ topic: 'x', question: 'Pergunta?', answer: '' }]).success,
    ).toBe(false);
  });

  it('gera o vetor da pergunta com o mesmo prefixo da pergunta do cliente', async () => {
    const { embedder, calls } = fakeEmbedder();
    const items = faqFileSchema.parse([
      { topic: 'pix', question: 'Qual o limite?', answer: 'R$ 1.000 à noite.' },
    ]);
    const [item] = await embedFaq(items, embedder);
    expect(item!.embedding).toHaveLength(768);
    expect(calls[0]!.kind).toBe('query');
  });
});
