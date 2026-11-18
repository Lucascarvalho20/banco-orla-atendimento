import { describe, expect, it } from 'vitest';
import {
  executeToolCall,
  parseToolCall,
  simulatePixLimit,
  AGENT_TOOL_NAMES,
} from './agent-tools.js';

describe('agent-tools (ADR 0008)', () => {
  it('só reconhece as 4 ferramentas', () => {
    expect(AGENT_TOOL_NAMES).toEqual([
      'buscar_base',
      'simular_limite_pix',
      'status_da_fila',
      'chamar_atendente',
    ]);
  });

  it('parseia chamada no protocolo FERRAMENTA:', () => {
    expect(parseToolCall('FERRAMENTA: simular_limite_pix {"valorReais":500,"hora":22}')).toEqual({
      name: 'simular_limite_pix',
      args: { valorReais: 500, hora: 22 },
    });
    expect(parseToolCall('O limite noturno é R$ 1.000.')).toBeNull();
  });

  it('simula limite Pix sem ler conta', () => {
    expect(simulatePixLimit(500, 22)).toMatch(/cabe no limite noturno/);
    expect(simulatePixLimit(2000, 22)).toMatch(/ultrapassa o limite noturno/);
    expect(simulatePixLimit(2000, 10)).toMatch(/cabe no limite diurno/);
  });

  it('recusa ferramenta fora da lista / args inválidos', async () => {
    const handlers = {
      buscar_base: async () => 'ok',
      simular_limite_pix: async () => 'ok',
      status_da_fila: async () => 'ok',
      chamar_atendente: async () => 'ok',
    };
    const bad = await executeToolCall({ name: 'buscar_base', args: { pergunta: 'x' } }, handlers);
    expect(bad.ok).toBe(false);

    const ok = await executeToolCall(
      { name: 'simular_limite_pix', args: { valorReais: 100, hora: 21 } },
      {
        ...handlers,
        simular_limite_pix: async (a) => simulatePixLimit(a.valorReais, a.hora ?? 12),
      },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.result).toMatch(/Simulação/);
  });
});
