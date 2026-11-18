// Configuração comum dos scripts que falam com a "AWS" local (MiniStack).
import { fileURLToPath } from 'node:url';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';

export const repoPath = (relative: string) =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

try {
  process.loadEnvFile(repoPath('.env'));
} catch {
  // Sem .env: as variáveis vêm do ambiente.
}

const envSchema = z.object({
  AWS_ENDPOINT_URL: z.url(),
  AWS_REGION: z.string().default('us-east-1'),
  KB_BUCKET: z.string().default('orla-kb'),
  DATABASE_URL: z.string(),
  POSTGRES_DB: z.string(),
  KB_WRITER_PASSWORD: z.string().min(16),
  OLLAMA_BASE_URL: z.url(),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${fields}`);
}
export const env = parsed.data;

// Trava de segurança: estes scripts criam filas, buckets e funções. Apontar para a AWS de verdade
// por engano criaria recursos (e custo) numa conta real. Só o emulador local é aceito.
const { hostname } = new URL(env.AWS_ENDPOINT_URL);
if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
  throw new Error(`AWS_ENDPOINT_URL precisa ser o MiniStack local (recebido: ${hostname}).`);
}

const common = { endpoint: env.AWS_ENDPOINT_URL, region: env.AWS_REGION };
export const s3 = new S3Client({ ...common, forcePathStyle: true });
export const sqs = new SQSClient(common);
export const lambda = new LambdaClient(common);

export const QUEUE = 'orla-ingestao';
export const DLQ = 'orla-ingestao-dlq';
export const FUNCTION = 'orla-ingestao';

export const log = (text: string) => process.stdout.write(`${text}\n`);
