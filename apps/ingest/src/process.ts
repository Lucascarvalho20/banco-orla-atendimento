import { InvalidDocumentError, type IngestResult } from '@orla/ai';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { z } from 'zod';
import { describeError, type Logger } from './log.js';

export interface ProcessDeps {
  /** Único bucket aceito: evento de outro bucket é recusado. */
  bucket: string;
  getObject(key: string): Promise<string>;
  ingest(key: string, markdown: string): Promise<IngestResult>;
  log: Logger;
}

// O corpo da mensagem é o evento que o S3 mandou para a fila. Validado como qualquer entrada.
const s3EventSchema = z.object({
  Records: z.array(
    z.object({
      eventName: z.string(),
      s3: z.object({
        bucket: z.object({ name: z.string() }),
        object: z.object({ key: z.string().max(1024) }),
      }),
    }),
  ),
});
// Ao configurar a notificação, o S3 manda um evento de teste. Não é erro.
const testEventSchema = z.object({ Event: z.literal('s3:TestEvent') });

/**
 * Processa um lote da fila. Cada mensagem é independente: as que falham voltam para a fila
 * (`batchItemFailures`) e, depois de 3 tentativas, vão para a DLQ. As que deram certo não são
 * reprocessadas.
 */
export async function processSqsEvent(
  event: SQSEvent,
  deps: ProcessDeps,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    try {
      await processRecord(record, deps);
    } catch (error) {
      deps.log.error('falha ao processar mensagem', {
        messageId: record.messageId,
        attempt: Number(record.attributes.ApproximateReceiveCount),
        error: describeError(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

async function processRecord(record: SQSRecord, deps: ProcessDeps) {
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch {
    throw new InvalidDocumentError('Mensagem não é JSON');
  }
  if (testEventSchema.safeParse(body).success) {
    deps.log.info('evento de teste do S3 ignorado', { messageId: record.messageId });
    return;
  }
  const parsed = s3EventSchema.safeParse(body);
  if (!parsed.success) throw new InvalidDocumentError('Mensagem não é um evento do S3');

  for (const s3Record of parsed.data.Records) {
    if (!s3Record.eventName.startsWith('ObjectCreated:')) continue;
    if (s3Record.s3.bucket.name !== deps.bucket) {
      throw new InvalidDocumentError('Evento de um bucket não esperado');
    }
    // No evento do S3 a chave vem codificada como em URL (espaço vira "+").
    const key = decodeURIComponent(s3Record.s3.object.key.replace(/\+/g, ' '));
    const markdown = await deps.getObject(key);
    const result = await deps.ingest(key, markdown);
    deps.log.info('documento processado', { messageId: record.messageId, key, ...result });
  }
}
