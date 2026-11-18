import { z } from 'zod';

/**
 * As únicas ferramentas que a IA pode chamar (ADR 0008).
 * Autorização e IDs vêm do servidor — o modelo só escolhe nome + args validados.
 */
export const AGENT_TOOL_NAMES = [
  'buscar_base',
  'simular_limite_pix',
  'status_da_fila',
  'chamar_atendente',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const MAX_AGENT_STEPS = 4;

/** Limites padrão do Banco Orla (fictícios — espelham a base de conhecimento). */
export const PIX_LIMIT_DAY_CENTS = 5_000_00; // R$ 5.000
export const PIX_LIMIT_NIGHT_CENTS = 1_000_00; // R$ 1.000 (20h–6h)

export const buscarBaseArgs = z.object({
  pergunta: z.string().trim().min(3).max(500),
});

export const simularLimitePixArgs = z.object({
  valorReais: z.number().positive().max(100_000),
  /** Hora local 0–23; se omitida, usa agora. */
  hora: z.number().int().min(0).max(23).optional(),
});

export const statusDaFilaArgs = z.object({});

export const chamarAtendenteArgs = z.object({
  resumo: z.string().trim().min(3).max(500),
  assunto: z.string().trim().min(2).max(80).optional(),
});

export type ToolHandlers = {
  buscar_base: (args: z.infer<typeof buscarBaseArgs>) => Promise<string>;
  simular_limite_pix: (args: z.infer<typeof simularLimitePixArgs>) => Promise<string>;
  status_da_fila: () => Promise<string>;
  chamar_atendente: (args: z.infer<typeof chamarAtendenteArgs>) => Promise<string>;
};

export function isNightHour(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

/** Regra fixa em código — não lê conta nenhuma (ADR 0008). */
export function simulatePixLimit(valorReais: number, hour: number): string {
  const cents = Math.round(valorReais * 100);
  const night = isNightHour(hour);
  const limit = night ? PIX_LIMIT_NIGHT_CENTS : PIX_LIMIT_DAY_CENTS;
  const period = night ? 'noturno (20h–6h)' : 'diurno';
  const limitReais = (limit / 100).toFixed(2).replace('.', ',');
  if (cents <= limit) {
    return `Simulação: R$ ${valorReais.toFixed(2).replace('.', ',')} cabe no limite ${period} padrão de R$ ${limitReais}. Isso não consulta sua conta real.`;
  }
  return `Simulação: R$ ${valorReais.toFixed(2).replace('.', ',')} ultrapassa o limite ${period} padrão de R$ ${limitReais}. Ajuste em Pix › Meus limites (aumentos valem em 24 h) ou fale com um atendente.`;
}

export type ToolCall = { name: AgentToolName; args: Record<string, unknown> };

const toolCallLine =
  /^\s*FERRAMENTA:\s*(buscar_base|simular_limite_pix|status_da_fila|chamar_atendente)\s*(\{.*\})\s*$/s;

/**
 * Protocolo simples (sem function-calling nativo do Ollama): o modelo responde
 * `FERRAMENTA: nome {...}` ou texto final ao cliente.
 */
export function parseToolCall(text: string): ToolCall | null {
  const match = text.trim().match(toolCallLine);
  if (!match) return null;
  const name = match[1] as AgentToolName;
  try {
    const args = JSON.parse(match[2]!) as Record<string, unknown>;
    return { name, args };
  } catch {
    return null;
  }
}

export async function executeToolCall(
  call: ToolCall,
  handlers: ToolHandlers,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  try {
    switch (call.name) {
      case 'buscar_base': {
        const args = buscarBaseArgs.parse(call.args);
        return { ok: true, result: await handlers.buscar_base(args) };
      }
      case 'simular_limite_pix': {
        const args = simularLimitePixArgs.parse(call.args);
        return { ok: true, result: await handlers.simular_limite_pix(args) };
      }
      case 'status_da_fila': {
        statusDaFilaArgs.parse(call.args);
        return { ok: true, result: await handlers.status_da_fila() };
      }
      case 'chamar_atendente': {
        const args = chamarAtendenteArgs.parse(call.args);
        return { ok: true, result: await handlers.chamar_atendente(args) };
      }
      default:
        return { ok: false, error: 'ferramenta_desconhecida' };
    }
  } catch {
    return { ok: false, error: 'args_invalidos' };
  }
}

export const AGENT_SYSTEM_PROMPT = `Você é o assistente do Banco Orla (banco digital fictício).
Só pode usar estas ferramentas, no máximo ${MAX_AGENT_STEPS} vezes por pergunta:

- buscar_base: {"pergunta":"..."} — busca na base pública
- simular_limite_pix: {"valorReais":100,"hora":22} — simula limite Pix (não lê conta)
- status_da_fila: {} — posição da fila desta sessão
- chamar_atendente: {"resumo":"..."} — coloca ESTA conversa na fila humana

Formato para chamar: uma linha exatamente assim
FERRAMENTA: nome {"chave":"valor"}

Quando tiver a resposta final ao cliente, escreva só o texto (sem FERRAMENTA).
Nunca peça senha, token, CVV ou cartão. Nunca invente saldo ou faça Pix.`;
