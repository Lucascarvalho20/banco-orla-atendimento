import { describe, expect, it, vi } from 'vitest';
import { createOllamaChat, LanguageModelError } from './llm.js';

const ok = (body: unknown) =>
  vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json(body));

describe('createOllamaChat', () => {
  it('manda o modelo, as mensagens e os limites; devolve o texto e os tokens', async () => {
    const fetchFn = ok({
      message: { role: 'assistant', content: 'Olá!' },
      done_reason: 'stop',
      prompt_eval_count: 120,
      eval_count: 8,
    });
    const llm = createOllamaChat({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b',
      maxTokens: 200,
      fetchFn,
    });

    const reply = await llm.chat([{ role: 'user', content: 'oi' }]);

    expect(reply).toEqual({ text: 'Olá!', truncated: false, promptTokens: 120, outputTokens: 8 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(String(init!.body))).toMatchObject({
      model: 'llama3.1:8b',
      stream: false,
      messages: [{ role: 'user', content: 'oi' }],
      options: { num_predict: 200, temperature: 0 },
    });
  });

  it('avisa quando a resposta parou no limite de tamanho', async () => {
    const llm = createOllamaChat({
      baseUrl: 'http://x',
      model: 'm',
      fetchFn: ok({ message: { content: 'Texto cort' }, done_reason: 'length' }),
    });
    expect((await llm.chat([])).truncated).toBe(true);
  });

  it('erro de HTTP, rede ou formato vira LanguageModelError', async () => {
    const cases = [
      vi.fn(async () => new Response('falhou', { status: 500 })),
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
      vi.fn(async () => Response.json({ resposta: 'formato estranho' })),
    ];
    for (const fetchFn of cases) {
      const llm = createOllamaChat({ baseUrl: 'http://x', model: 'm', fetchFn });
      await expect(llm.chat([])).rejects.toBeInstanceOf(LanguageModelError);
    }
  });
});
