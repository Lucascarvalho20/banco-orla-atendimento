/**
 * Bateria de red team (Etapa 7 / ADR 0009).
 * Fonte: evals/ataques.json — o CI falha se algum ataque passar.
 * As guardas são código determinístico: não dependem do modelo.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkOutput,
  detectInjection,
  maskSensitiveData,
  type InjectionKind,
  type OutputIssue,
  type SensitiveKind,
} from './guards.js';
import { RAG_PROMPT_LEAK_SOURCE } from './rag.js';

type Entrada = { id: string; texto: string; espera: InjectionKind };
type Saida = { id: string; texto: string; espera: OutputIssue };
type Mascarar = { id: string; texto: string; contem: string; tipo: SensitiveKind };

const batery = JSON.parse(
  readFileSync(new URL('../../../evals/ataques.json', import.meta.url), 'utf8'),
) as {
  entrada: Entrada[];
  saida: Saida[];
  mascarar: Mascarar[];
  legitimos: string[];
};

describe('red team — evals/ataques.json', () => {
  it('tem pelo menos 30 ataques (entrada + saída + mascarar)', () => {
    const total = batery.entrada.length + batery.saida.length + batery.mascarar.length;
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it.each(batery.entrada.map((a) => [a.id, a.texto, a.espera] as const))(
    'entrada %s bloqueada',
    (_id, texto, espera) => {
      expect(detectInjection(texto)).toBe(espera);
    },
  );

  it.each(batery.saida.map((a) => [a.id, a.texto, a.espera] as const))(
    'saída %s barrada (LLM fake obediente ainda é bloqueado)',
    (_id, texto, espera) => {
      expect(checkOutput(texto, { leakSources: [RAG_PROMPT_LEAK_SOURCE] })).toBe(espera);
    },
  );

  it.each(batery.mascarar.map((a) => [a.id, a.texto, a.contem, a.tipo] as const))(
    'mascarar %s',
    (_id, texto, contem, tipo) => {
      const { text, found } = maskSensitiveData(texto);
      expect(text).toContain(contem);
      expect(found).toContain(tipo);
    },
  );

  it.each(batery.legitimos.map((t, i) => [`L${String(i + 1).padStart(2, '0')}`, t] as const))(
    'legítimo %s passa',
    (_id, texto) => {
      expect(detectInjection(texto)).toBeNull();
      // Orientação contra golpe tem "nunca pede senha" — a saída deve permitir com negação.
      if (texto.includes('nunca pede')) {
        expect(checkOutput(texto, { leakSources: [RAG_PROMPT_LEAK_SOURCE] })).toBeNull();
      }
    },
  );
});
