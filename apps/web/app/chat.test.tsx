import type { ChatMessage } from '@orla/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Chat } from './chat';
import type { ChatClient } from './chat-client';

type Handler = (...args: unknown[]) => void;
type ServerFn = (event: string, data: Record<string, unknown>) => unknown;

/** Conexão de mentira: o teste decide quando conecta, cai e o que o "servidor" responde. */
class FakeSocket {
  connected = false;
  sent: { event: string; data: Record<string, unknown> }[] = [];
  private handlers = new Map<string, Set<Handler>>();
  constructor(public server: ServerFn) {}

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  timeout() {
    return this;
  }
  async emitWithAck(event: string, data: Record<string, unknown>) {
    this.sent.push({ event, data });
    return this.server(event, data);
  }
  disconnect() {
    this.connected = false;
  }

  fire(event: string, ...args: unknown[]) {
    act(() => this.handlers.get(event)?.forEach((fn) => fn(...args)));
  }
  goOnline() {
    this.connected = true;
    this.fire('connect');
  }
  goOffline() {
    this.connected = false;
    this.fire('disconnect');
  }
}

const welcome: ChatMessage = {
  seq: 1,
  clientMsgId: null,
  sender: 'system',
  body: 'Olá, Ana Lima! Conte sua dúvida sobre Pix e transferências.',
  createdAt: '2026-11-14T12:00:00.000Z',
};

/** "Servidor" simples: devolve as boas-vindas e numera as mensagens. */
function simpleServer(): ServerFn {
  let seq = 1;
  return (event, data) =>
    event === 'conversa:entrar'
      ? { ok: true, messages: [welcome].filter((m) => m.seq > (data.afterSeq as number)) }
      : { ok: true, seq: ++seq, duplicate: false, body: data.body };
}

function setup(server: ServerFn = simpleServer()) {
  const socket = new FakeSocket(server);
  render(<Chat topic="pix" connect={() => socket as unknown as ChatClient} />);
  return { socket, user: userEvent.setup() };
}

const log = () => screen.getByRole('log');

async function enviar(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('Mensagem'), text);
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
}

describe('Chat', () => {
  it('ao conectar, mostra as boas-vindas', async () => {
    const { socket } = setup();
    socket.goOnline();
    expect(await within(log()).findByText(welcome.body)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Conectado');
  });

  it('mostra "enviando…" até o servidor confirmar', async () => {
    let confirm: (v: unknown) => void = () => {};
    const base = simpleServer();
    const { socket, user } = setup((event, data) =>
      event === 'mensagem:enviar' ? new Promise((r) => (confirm = r)) : base(event, data),
    );
    socket.goOnline();
    await within(log()).findByText(welcome.body);

    await enviar(user, 'Meu Pix não caiu');
    expect(screen.getByLabelText('Mensagem enviando')).toHaveTextContent('enviando…');

    await act(async () =>
      confirm({ ok: true, seq: 2, duplicate: false, body: 'Meu Pix não caiu' }),
    );
    expect(screen.queryByLabelText('Mensagem enviando')).not.toBeInTheDocument();
    expect(within(log()).getByText('Meu Pix não caiu')).toBeInTheDocument();
  });

  it('sem internet a mensagem espera; ao reconectar, reenvia com o MESMO id', async () => {
    const { socket, user } = setup();
    socket.goOnline();
    await within(log()).findByText(welcome.body);
    socket.goOffline();
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');

    await enviar(user, 'mensagem escrita offline');
    expect(socket.sent.filter((s) => s.event === 'mensagem:enviar')).toHaveLength(0);

    socket.goOnline();
    await within(log()).findByText('mensagem escrita offline');
    const entradas = socket.sent.filter((s) => s.event === 'conversa:entrar');
    expect(entradas.at(-1)!.data).toEqual({ topic: 'pix', afterSeq: 1, preferential: false }); // só pede o que falta
    expect(socket.sent.filter((s) => s.event === 'mensagem:enviar')).toHaveLength(1);
  });

  it('a mesma mensagem chegando pelo ack e pelo evento aparece uma vez só', async () => {
    const { socket, user } = setup();
    socket.goOnline();
    await within(log()).findByText(welcome.body);

    await enviar(user, 'oi');
    await within(log()).findByText('oi');
    const sent = socket.sent.find((s) => s.event === 'mensagem:enviar')!;
    socket.fire('mensagem:nova', {
      seq: 2,
      clientMsgId: sent.data.clientMsgId,
      sender: 'customer',
      body: 'oi',
      createdAt: welcome.createdAt,
    });
    expect(within(log()).getAllByText('oi')).toHaveLength(1);
  });

  it('avisa quando o servidor limita as mensagens', async () => {
    const base = simpleServer();
    const { socket, user } = setup((event, data) =>
      event === 'mensagem:enviar' ? { ok: false, error: 'muitas_mensagens' } : base(event, data),
    );
    socket.goOnline();
    await within(log()).findByText(welcome.body);

    await enviar(user, 'spam');
    expect(await screen.findByLabelText('Mensagem não enviada')).toHaveTextContent(
      'Aguarde alguns segundos',
    );
  });

  it('mensagem com HTML aparece como texto, nunca vira HTML', async () => {
    const { socket } = setup();
    socket.goOnline();
    socket.fire('mensagem:nova', {
      ...welcome,
      seq: 5,
      sender: 'agent',
      body: '<img src=x onerror=alert(1)>',
    });
    expect(await within(log()).findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('identifica a resposta da IA como "Assistente virtual"', async () => {
    const { socket } = setup();
    socket.goOnline();
    socket.fire('mensagem:nova', { ...welcome, seq: 2, sender: 'ai', body: 'Resposta da FAQ' });
    const item = (await within(log()).findByText('Resposta da FAQ')).closest('li')!;
    expect(item).toHaveTextContent('Assistente virtual');
    expect(within(log()).getAllByText('Assistente virtual')).toHaveLength(1);
  });

  it('depois de enviar, mostra o texto como o servidor gravou (dado sensível escondido)', async () => {
    const base = simpleServer();
    const { socket, user } = setup((event, data) =>
      event === 'mensagem:enviar'
        ? { ok: true, seq: 2, duplicate: false, body: 'meu cartão é [cartão oculto]' }
        : base(event, data),
    );
    socket.goOnline();
    await within(log()).findByText(welcome.body);

    await enviar(user, 'meu cartão é 4111 1111 1111 1111');
    expect(await within(log()).findByText('meu cartão é [cartão oculto]')).toBeInTheDocument();
    expect(within(log()).queryByText(/4111/)).not.toBeInTheDocument();
  });

  it('mostra a fonte da resposta tirada dos documentos', async () => {
    const { socket } = setup();
    socket.goOnline();
    socket.fire('mensagem:nova', {
      ...welcome,
      seq: 2,
      sender: 'ai',
      body: 'É de R$ 1.000.',
      sources: [{ title: 'Limites do Pix', section: 'Limite noturno' }],
    });
    const item = (await within(log()).findByText(/É de R\$ 1\.000\./)).closest('li')!;
    expect(item).toHaveTextContent('Fonte: Limites do Pix (Limite noturno)');
  });

  it('"digitando…" aparece enquanto o assistente prepara e some se a conexão cair', async () => {
    const { socket } = setup();
    socket.goOnline();
    await within(log()).findByText(welcome.body);
    const digitando = () => screen.queryByText('Assistente virtual digitando…');

    socket.fire('assistente:digitando', true);
    expect(digitando()).toBeInTheDocument();
    socket.fire('assistente:digitando', false);
    expect(digitando()).not.toBeInTheDocument();

    socket.fire('assistente:digitando', true);
    socket.goOffline();
    expect(digitando()).not.toBeInTheDocument();
  });
});
