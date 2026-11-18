import { describe, expect, it } from 'vitest';
import { entradaSchema, formatCpf, isValidCpf, normalizeCpf } from './cpf.js';

// CPFs de exemplo, válidos só pela conta (gerados para testes, não pertencem a ninguém conhecido).
const VALIDO = '529.982.247-25';
const VALIDO_2 = '11144477735';

describe('isValidCpf', () => {
  it('aceita CPF válido com ou sem pontuação', () => {
    expect(isValidCpf(VALIDO)).toBe(true);
    expect(isValidCpf(VALIDO_2)).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('11144477734')).toBe(false);
  });

  it('recusa todos os dígitos iguais, tamanho errado e letras', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('abc')).toBe(false);
  });
});

describe('normalizeCpf e formatCpf', () => {
  it('normaliza e formata', () => {
    expect(normalizeCpf(VALIDO)).toBe('52998224725');
    expect(formatCpf('52998224725')).toBe(VALIDO);
    expect(formatCpf('5299')).toBe('529.9');
  });
});

describe('entradaSchema', () => {
  it('aceita entrada válida e devolve o CPF só com dígitos', () => {
    const r = entradaSchema.parse({
      name: '  Ana Lima ',
      cpf: VALIDO,
      topic: 'pix',
      preferential: false,
    });
    expect(r).toEqual({
      name: 'Ana Lima',
      cpf: '52998224725',
      topic: 'pix',
      preferential: false,
    });
  });

  it('recusa nome com símbolos (ex.: tentativa de HTML)', () => {
    const r = entradaSchema.safeParse({ name: '<script>', cpf: VALIDO, topic: 'pix' });
    expect(r.success).toBe(false);
  });

  it('recusa assunto que não existe', () => {
    const r = entradaSchema.safeParse({ name: 'Ana', cpf: VALIDO, topic: 'admin' });
    expect(r.success).toBe(false);
  });
});
