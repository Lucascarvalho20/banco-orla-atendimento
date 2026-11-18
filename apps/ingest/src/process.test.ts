import { InvalidDocumentError, type IngestResult } from '@orla/ai';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './log.js';
import { processSqsEvent } from './process.js';

const s3Event = (key: string, bucket = 'orla-kb') =>
  JSON.stringify({
    Records: [
      { eventName: 'ObjectCreated:Put', s3: { bucket: { name: bucket }, object: { key } } },
    ],
  });

const record = (messageId: string, body: string) =>
  ({ messageId, body, attributes: { ApproximateReceiveCount: '1' } }) as unknown as SQSRecord;
const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records });

function setup(files: Record<string, string> = {}) {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  const log: Logger = {
    info: (msg, fields) => lines.push({ level: 'info', msg, ...(fields && { fields }) }),
    error: (msg, fields) => lines.push({ level: 'error', msg, ...(fields && { fields }) }),
  };
  const ingest = vi.fn(async (key: string): Promise<IngestResult> => ({
    status: 'ingested',
    sourcePath: key.slice('docs/'.length),
    version: 1,
    chunks: 3,
  }));
  const getObject = vi.fn(async (key: string) => {
    const content = files[key];
    if (content === undefined) throw new Error('NoSuchKey');
    return content;
  });
  return { deps: { bucket: 'orla-kb', getObject, ingest, log }, ingest, lines };
}

describe('processSqsEvent', () => {
  it('baixa o arquivo do evento e manda para a ingestão', async () => {
    const { deps, ingest } = setup({ 'docs/pix/limites.md': '# Pix' });
    const result = await processSqsEvent(event(record('m1', s3Event('docs/pix/limites.md'))), deps);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(ingest).toHaveBeenCalledWith('docs/pix/limites.md', '# Pix');
  });

  it('falha parcial: só a mensagem quebrada volta para a fila', async () => {
    const { deps } = setup({ 'docs/pix/bom.md': '# Bom' });
    deps.ingest.mockImplementationOnce(async () => {
      throw new InvalidDocumentError('Documento sem título');
    });
    const result = await processSqsEvent(
      event(
        record('quebrada', s3Event('docs/pix/bom.md')),
        record('boa', s3Event('docs/pix/bom.md')),
      ),
      deps,
    );
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'quebrada' }]);
  });

  it('ignora o evento de teste do S3 (sem falha)', async () => {
    const { deps, ingest } = setup();
    const body = JSON.stringify({ Event: 's3:TestEvent' });
    expect(await processSqsEvent(event(record('t', body)), deps)).toEqual({
      batchItemFailures: [],
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    ['não é JSON', 'isso não é json'],
    ['não é evento do S3', JSON.stringify({ qualquer: 'coisa' })],
    ['vem de outro bucket', s3Event('docs/pix/a.md', 'bucket-de-outra-pessoa')],
    ['arquivo não existe', s3Event('docs/pix/sumiu.md')],
  ])('mensagem que %s vira falha (retry e depois DLQ)', async (_, body) => {
    const { deps, ingest } = setup();
    const result = await processSqsEvent(event(record('x', body)), deps);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'x' }]);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('decodifica a chave como o S3 manda (+ e %XX)', async () => {
    const { deps, ingest } = setup({ 'docs/pix/a b.md': '# A' });
    await processSqsEvent(event(record('m', s3Event('docs/pix/a+b.md'))), deps);
    expect(ingest).toHaveBeenCalledWith('docs/pix/a b.md', '# A');
  });

  it('o log nunca leva o conteúdo do documento', async () => {
    const segredo = '# Documento\n\nconteúdo que não pode ir para o log';
    const { deps, lines } = setup({ 'docs/pix/a.md': segredo });
    await processSqsEvent(event(record('m', s3Event('docs/pix/a.md'))), deps);
    expect(JSON.stringify(lines)).not.toContain('não pode ir para o log');
    expect(lines).toContainEqual(expect.objectContaining({ msg: 'documento processado' }));
  });
});
