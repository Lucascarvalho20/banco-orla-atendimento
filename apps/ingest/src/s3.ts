import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { InvalidDocumentError, MAX_DOCUMENT_BYTES } from '@orla/ai';

/**
 * Lê um documento do bucket. Confere o tamanho ANTES de baixar o conteúdo: um arquivo de 2 GB
 * estouraria a memória da Lambda.
 */
export function createS3Reader(client: Pick<S3Client, 'send'>, bucket: string) {
  return async (key: string): Promise<string> => {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if ((object.ContentLength ?? 0) > MAX_DOCUMENT_BYTES) {
      throw new InvalidDocumentError(`Documento maior que ${MAX_DOCUMENT_BYTES} bytes`);
    }
    if (!object.Body) throw new InvalidDocumentError('Objeto sem conteúdo');
    return object.Body.transformToString('utf-8');
  };
}
