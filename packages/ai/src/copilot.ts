import { checkOutput } from './guards.js';
import type { LanguageModel, LlmMessage } from './llm.js';

/**
 * Copiloto do atendente (V2): sugere texto; nada é enviado sem o humano clicar.
 */
export async function suggestAgentReply(input: {
  llm: LanguageModel;
  topicName: string;
  customerName: string;
  history: { sender: string; body: string }[];
  triageSummary?: string | null;
}): Promise<{ ok: true; suggestion: string } | { ok: false; reason: 'blocked' | 'empty' }> {
  const hist = input.history
    .slice(-12)
    .map((m) => `${m.sender}: ${m.body}`)
    .join('\n');

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `Você é copiloto de um atendente do Banco Orla (fictício).
Sugira UMA resposta curta e educada em português para o atendente editar e enviar.
Não invente saldo, não peça senha/token/CVV/cartão, não diga que já executou ação.
Assunto: ${input.topicName}. Cliente: ${input.customerName}.`,
    },
    {
      role: 'user',
      content: `${input.triageSummary ? `Triagem:\n${input.triageSummary}\n\n` : ''}Histórico:\n${hist}\n\nSugira a próxima mensagem do atendente:`,
    },
  ];

  const reply = await input.llm.chat(messages);
  const text = reply.text.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (checkOutput(text)) return { ok: false, reason: 'blocked' };
  return { ok: true, suggestion: text.slice(0, 1000) };
}
