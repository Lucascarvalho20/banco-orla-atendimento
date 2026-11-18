// Envia os documentos de knowledge/docs/ para o bucket. Cada upload dispara a ingestão.
// Uso: pnpm kb:upload                       (todos)
//      pnpm kb:upload <arquivo> <chave>     (um só; útil para testar a DLQ)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { env, log, repoPath, s3 } from './aws.js';

async function put(file: string, key: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.KB_BUCKET,
      Key: key,
      Body: readFileSync(file),
      ContentType: 'text/markdown; charset=utf-8',
    }),
  );
  log(`↑ s3://${env.KB_BUCKET}/${key}`);
}

const [file, key] = process.argv.slice(2);
if (file && key) {
  await put(file, key);
} else {
  const root = repoPath('knowledge/docs');
  for (const topic of readdirSync(root)) {
    for (const name of readdirSync(join(root, topic)).filter((n) => n.endsWith('.md'))) {
      await put(join(root, topic, name), `docs/${topic}/${name}`);
    }
  }
}
log('A ingestão roda em segundo plano. Acompanhe com: pnpm kb:status');
