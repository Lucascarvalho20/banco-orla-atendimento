import { describe, expect, it } from 'vitest';
import { runAgentTurn } from './agent.js';
import { simulatePixLimit } from './agent-tools.js';
import type { LanguageModel } from './llm.js';

function scriptedLlm(replies: string[]): LanguageModel {
  let i = 0;
  return {
    model: 'test',
    async chat() {
      const text = replies[i] ?? 'Sem mais passos.';
      i += 1;
      return { text, truncated: false, promptTokens: 1, outputTokens: 1 };
    },
  };
}

describe('runAgentTurn', () => {
  it('executa ferramenta e devolve texto final', async () => {
    const result = await runAgentTurn({
      question: 'Posso Pix de 500 à noite?',
      llm: scriptedLlm([
        'FERRAMENTA: simular_limite_pix {"valorReais":500,"hora":22}',
        'À noite o limite padrão cobre R$ 500.',
      ]),
      tools: {
        buscar_base: async () => '',
        simular_limite_pix: async (a) => simulatePixLimit(a.valorReais, a.hora ?? 22),
        status_da_fila: async () => '',
        chamar_atendente: async () => '',
      },
    });
    expect(result).toMatchObject({
      kind: 'answered',
      toolsUsed: ['simular_limite_pix'],
    });
    if (result.kind === 'answered') expect(result.body).toMatch(/limite/);
  });

  it('não permite mais de 4 passos de ferramenta', async () => {
    const result = await runAgentTurn({
      question: 'teste',
      maxSteps: 2,
      llm: scriptedLlm([
        'FERRAMENTA: status_da_fila {}',
        'FERRAMENTA: status_da_fila {}',
        'nunca chega',
      ]),
      tools: {
        buscar_base: async () => 'a',
        simular_limite_pix: async () => 'b',
        status_da_fila: async () => 'fila vazia',
        chamar_atendente: async () => 'c',
      },
    });
    expect(result.kind).toBe('not_found');
    expect(result.toolsUsed).toEqual(['status_da_fila', 'status_da_fila']);
  });
});
