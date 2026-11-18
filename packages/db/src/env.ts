import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  AI_READER_PASSWORD: z.string().min(16),
  KB_WRITER_PASSWORD: z.string().min(16),
});

export function loadDbEnv(source: NodeJS.ProcessEnv = process.env) {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // Sem .env local (CI/container): as variáveis vêm do ambiente.
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${fields}`);
  }
  return parsed.data;
}
