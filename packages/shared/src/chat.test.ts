import { describe, expect, it } from 'vitest';
import { enviarSchema, mergeMessages, type ChatMessage } from './chat.js';

const msg = (seq: number, body = `m${seq}`): ChatMessage => ({
  seq,
  clientMsgId: null,
  sender: 'customer',
  body,
  createdAt: '2026-11-14T12:00:00.000Z',
});

describe('mergeMessages', () => {
  it('não duplica a mesma mensagem recebida duas vezes', () => {
    expect(mergeMessages([msg(1), msg(2)], [msg(2), msg(3)]).map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('ordena pela seq do servidor, não pela ordem de chegada', () => {
    expect(mergeMessages([msg(3)], [msg(1), msg(2)]).map((m) => m.seq)).toEqual([1, 2, 3]);
  });
});

describe('enviarSchema', () => {
  const id = '7d9f0c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

  it('aceita mensagem normal e tira espaços das pontas', () => {
    expect(enviarSchema.parse({ clientMsgId: id, body: '  oi  ' }).body).toBe('oi');
  });

  it('recusa vazia, longa demais e id que não é UUID', () => {
    expect(enviarSchema.safeParse({ clientMsgId: id, body: '   ' }).success).toBe(false);
    expect(enviarSchema.safeParse({ clientMsgId: id, body: 'a'.repeat(1001) }).success).toBe(false);
    expect(enviarSchema.safeParse({ clientMsgId: '1', body: 'oi' }).success).toBe(false);
  });
});
