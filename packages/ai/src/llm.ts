import { z } from 'zod';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmReply {
  text: string;
  /** A resposta parou no limite de tamanho (`num_predict`): pode estar cortada no meio. */
  truncated: boolean;
  promptTokens: number | null;
  outputTokens: number | null;
}

/** Gera texto a partir de mensagens (ADR 0007). Nos testes, uma versão falsa cumpre o contrato. */
export interface LanguageModel {
  readonly model: string;
  chat(messages: LlmMessage[]): Promise<LlmReply>;
}

export class LanguageModelError extends Error {
  override name = 'LanguageModelError';
}

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().int().optional(),
  eval_count: z.number().int().optional(),
});

export interface OllamaChatOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** Máximo de tokens na resposta (custo e tempo de GPU — OWASP LLM10). */
  maxTokens?: number;
  /** 0 = mesma pergunta, mesma resposta (atendimento previsível e avaliação reproduzível). */
  temperature?: number;
  /** Tamanho do contexto (prompt + trechos + resposta). */
  contextTokens?: number;
  fetchFn?: typeof fetch;
}

/** Llama (ou outro modelo) pelo Ollama local: `POST /api/chat`, sem streaming. */
export function createOllamaChat(options: OllamaChatOptions): LanguageModel {
  const {
    baseUrl,
    model,
    timeoutMs = 30_000,
    maxTokens = 350,
    temperature = 0,
    contextTokens = 4096,
    fetchFn = fetch,
  } = options;

  return {
    model,
    async chat(messages) {
      let response: Response;
      try {
        response = await fetchFn(new URL('/api/chat', baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: { temperature, num_predict: maxTokens, num_ctx: contextTokens },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new LanguageModelError('Ollama indisponível ou lento demais', { cause: error });
      }
      if (!response.ok) throw new LanguageModelError(`Ollama respondeu HTTP ${response.status}`);

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) throw new LanguageModelError('Resposta do Ollama em formato inesperado');
      return {
        text: parsed.data.message.content,
        truncated: parsed.data.done_reason === 'length',
        promptTokens: parsed.data.prompt_eval_count ?? null,
        outputTokens: parsed.data.eval_count ?? null,
      };
    },
  };
}
