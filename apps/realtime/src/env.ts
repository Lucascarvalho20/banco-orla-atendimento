import { FAQ_MIN_SIMILARITY } from '@orla/ai';
import { z } from 'zod';
import { RAG_MAX_PER_CONVERSATION } from './assistant.js';

const secret = z.string().min(32, 'precisa de pelo menos 32 caracteres');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'precisa ser uma URL postgres://'),
  // A busca da FAQ usa o usuário só-leitura da IA, não o dono do banco.
  AI_READER_PASSWORD: z.string().min(16),
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_CHAT_MODEL: z.string().default('llama3.1:8b'),
  RAG_MAX_PER_CONVERSATION: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(RAG_MAX_PER_CONVERSATION),
  FAQ_MIN_SIMILARITY: z.coerce.number().min(0.5).max(1).default(FAQ_MIN_SIMILARITY),
  CPF_HMAC_SECRET: secret,
  SESSION_SECRET: secret,
  SESSION_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(120),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Só o NOME das variáveis: o valor pode ser um segredo.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${fields}`);
  }
  return parsed.data;
}
