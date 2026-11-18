import { z } from 'zod';
import { topicSlugSchema } from './topics.js';

/** Remove pontos, traço e espaços: "529.982.247-25" → "52998224725". */
export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Valida os 11 dígitos e os 2 dígitos verificadores (algoritmo da Receita Federal). */
export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  // "111.111.111-11" passa na conta, mas não é um CPF válido.
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = [...cpf].map(Number);
  const checkDigit = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += digits[i]! * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
}

/** "52998224725" → "529.982.247-25" (para exibir enquanto a pessoa digita). */
export function formatCpf(value: string): string {
  const d = normalizeCpf(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** Prioridade na fila humana: preferencial (idoso/PCD etc.) passa na frente; empate = FIFO. */
export const QUEUE_PRIORITY_NORMAL = 0;
export const QUEUE_PRIORITY_PREFERENTIAL = 10;

/** Formulário de entrada do cliente: a mesma regra no navegador e no servidor. */
export const entradaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Informe seu nome.')
    .max(60, 'Use no máximo 60 caracteres.')
    .regex(/^[\p{L}' -]+$/u, 'Use apenas letras e espaços.'),
  cpf: z
    .string()
    .max(20)
    .transform(normalizeCpf)
    .refine(isValidCpf, 'CPF inválido. Confira os números.'),
  topic: topicSlugSchema,
  /** Atendimento preferencial (fila de banco: idoso, PCD, gestante…). */
  preferential: z.boolean().default(false),
});

export type Entrada = z.infer<typeof entradaSchema>;
