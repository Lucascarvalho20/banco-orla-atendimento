import {
  AGENT_SYSTEM_PROMPT,
  executeToolCall,
  MAX_AGENT_STEPS,
  parseToolCall,
  type ToolHandlers,
} from './agent-tools.js';
import { checkOutput } from './guards.js';
import type { LanguageModel, LlmMessage } from './llm.js';

export type AgentTurnResult =
  | { kind: 'answered'; body: string; steps: number; toolsUsed: string[] }
  | { kind: 'not_found'; steps: number; toolsUsed: string[] }
  | { kind: 'blocked'; steps: number; toolsUsed: string[] };

/**
 * Loop do agente (ADR 0008): no máximo 4 ferramentas; IDs/autorização nos handlers do servidor.
 */
export async function runAgentTurn(input: {
  question: string;
  llm: LanguageModel;
  tools: ToolHandlers;
  maxSteps?: number;
}): Promise<AgentTurnResult> {
  const maxSteps = input.maxSteps ?? MAX_AGENT_STEPS;
  const toolsUsed: string[] = [];
  const messages: LlmMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: input.question },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const reply = await input.llm.chat(messages);
    const call = parseToolCall(reply.text);
    if (!call) {
      const issue = checkOutput(reply.text);
      if (issue) return { kind: 'blocked', steps: step + 1, toolsUsed };
      const body = reply.text.trim();
      if (!body) return { kind: 'not_found', steps: step + 1, toolsUsed };
      return { kind: 'answered', body, steps: step + 1, toolsUsed };
    }

    toolsUsed.push(call.name);
    const executed = await executeToolCall(call, input.tools);
    messages.push({ role: 'assistant', content: reply.text.trim() });
    messages.push({
      role: 'user',
      content: executed.ok
        ? `Resultado da ferramenta ${call.name}:\n${executed.result}`
        : `Ferramenta ${call.name} falhou (${executed.error}). Responda ao cliente sem inventar dados.`,
    });
  }

  return { kind: 'not_found', steps: maxSteps, toolsUsed };
}
