import { MAX_DOCUMENT_BYTES } from '@orla/ai';
import { describe, expect, it, vi } from 'vitest';
import { createS3Reader } from './s3.js';

describe('createS3Reader', () => {
  it('lê o conteúdo do objeto como texto', async () => {
    const send = vi.fn(async (_command: unknown) => ({
      ContentLength: 5,
      Body: { transformToString: async () => '# Pix' },
    }));
    const read = createS3Reader({ send } as never, 'orla-kb');
    expect(await read('docs/pix/a.md')).toBe('# Pix');
    expect(send.mock.calls[0]![0]).toMatchObject({
      input: { Bucket: 'orla-kb', Key: 'docs/pix/a.md' },
    });
  });

  it('recusa arquivo grande demais sem baixar o conteúdo', async () => {
    const transformToString = vi.fn();
    const send = vi.fn(async () => ({
      ContentLength: MAX_DOCUMENT_BYTES + 1,
      Body: { transformToString },
    }));
    const read = createS3Reader({ send } as never, 'orla-kb');
    await expect(read('docs/pix/a.md')).rejects.toThrow('maior que');
    expect(transformToString).not.toHaveBeenCalled();
  });
});
