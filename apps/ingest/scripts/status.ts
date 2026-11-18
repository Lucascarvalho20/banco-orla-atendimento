// Mostra o estado da ingestão: mensagens nas filas e documentos/trechos no banco.
import { GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { databaseUrlForRole } from '@orla/db';
import pg from 'pg';
import { DLQ, env, log, QUEUE, sqs } from './aws.js';

for (const name of [QUEUE, DLQ]) {
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
  const { Attributes = {} } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  log(
    `${name.padEnd(18)} esperando: ${Attributes.ApproximateNumberOfMessages ?? '?'}  ` +
      `em processamento: ${Attributes.ApproximateNumberOfMessagesNotVisible ?? '?'}`,
  );
}

const pool = new pg.Pool({
  connectionString: databaseUrlForRole(env.DATABASE_URL, 'kb_writer', env.KB_WRITER_PASSWORD),
  max: 1,
});
try {
  const { rows } = await pool.query<{ source_path: string; version: number; chunks: number }>(
    `SELECT d.source_path, d.version, count(c.id)::int AS chunks
       FROM kb_documents d LEFT JOIN kb_chunks c ON c.document_id = d.id
      GROUP BY d.id ORDER BY d.source_path`,
  );
  log('\ndocumento                               versão  trechos');
  for (const r of rows)
    log(`${r.source_path.padEnd(40)} ${String(r.version).padStart(6)}  ${r.chunks}`);
  const { rows: faq } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM faq`);
  log(`\nFAQ: ${faq[0]!.n} perguntas`);
} finally {
  await pool.end();
}
