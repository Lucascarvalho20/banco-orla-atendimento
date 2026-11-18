import { describe, expect, it } from 'vitest';
import {
  ingestDocument,
  InvalidDocumentError,
  type KnowledgeStore,
  MAX_DOCUMENT_BYTES,
  parseKnowledgeKey,
  sha256,
} from './ingest.js';
import { fakeEmbedder } from './test-helpers.js';

const markdown = '# Cartão\n\n## Fatura\n\nFecha 7 dias antes do vencimento.\n';

function memoryStore() {
  const docs = new Map<string, { hash: string; version: number; chunks: unknown[] }>();
  const store: KnowledgeStore = {
    async getDocumentHash(sourcePath) {
      return docs.get(sourcePath)?.hash ?? null;
    },
    async saveDocument({ sourcePath, contentHash, chunks }) {
      const current = docs.get(sourcePath);
      if (current?.hash === contentHash) return { version: current.version, changed: false };
      const version = (current?.version ?? 0) + 1;
      docs.set(sourcePath, { hash: contentHash, version, chunks });
      return { version, changed: true };
    },
  };
  return { store, docs };
}

describe('parseKnowledgeKey', () => {
  it('aceita docs/<assunto>/<nome>.md', () => {
    expect(parseKnowledgeKey('docs/pix/limites-e-horarios.md')).toEqual({
      topic: 'pix',
      sourcePath: 'pix/limites-e-horarios.md',
    });
  });

  it.each([
    'docs/../pix/a.md',
    'docs/pix/../../segredo.md',
    'docs/pix/A.md',
    'docs/pix/com espaco.md',
    'docs/pix/a.txt',
    'docs/inexistente/a.md',
    'outra-pasta/pix/a.md',
    'docs/pix/sub/a.md',
  ])('recusa %s', (key) => {
    expect(parseKnowledgeKey(key)).toBeNull();
  });
});

describe('ingestDocument', () => {
  it('divide, gera vetores (como documento) e grava', async () => {
    const { embedder, calls } = fakeEmbedder();
    const { store, docs } = memoryStore();
    const result = await ingestDocument(
      { key: 'docs/cartao/fatura.md', markdown },
      { embedder, store },
    );
    expect(result).toEqual({
      status: 'ingested',
      sourcePath: 'cartao/fatura.md',
      version: 1,
      chunks: 1,
    });
    expect(calls).toEqual([
      { kind: 'document', texts: ['Cartão › Fatura\nFecha 7 dias antes do vencimento.'] },
    ]);
    expect(docs.get('cartao/fatura.md')?.hash).toBe(sha256(markdown));
  });

  it('documento igual ao já ingerido: não gasta embedding de novo', async () => {
    const { embedder, calls } = fakeEmbedder();
    const { store } = memoryStore();
    const input = { key: 'docs/cartao/fatura.md', markdown };
    await ingestDocument(input, { embedder, store });
    const second = await ingestDocument(input, { embedder, store });
    expect(second).toEqual({ status: 'unchanged', sourcePath: 'cartao/fatura.md' });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['caminho inválido', { key: 'docs/../x.md', markdown }],
    ['sem título', { key: 'docs/pix/a.md', markdown: 'Texto sem título.' }],
    ['sem conteúdo', { key: 'docs/pix/a.md', markdown: '# Título\n\n> só aviso\n' }],
    ['grande demais', { key: 'docs/pix/a.md', markdown: `# T\n${'x'.repeat(MAX_DOCUMENT_BYTES)}` }],
  ])('recusa documento %s (vai para a DLQ)', async (_, input) => {
    const { embedder, calls } = fakeEmbedder();
    const { store } = memoryStore();
    await expect(ingestDocument(input, { embedder, store })).rejects.toThrow(InvalidDocumentError);
    expect(calls).toHaveLength(0);
  });
});
