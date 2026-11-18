'use client';

import { MAX_MESSAGE_LENGTH, mergeMessages, type ChatMessage, type TopicSlug } from '@orla/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatClient } from './chat-client';

const ACK_TIMEOUT_MS = 5_000;

interface Pending {
  clientMsgId: string;
  body: string;
  error?: string;
}

const ERRORS: Record<string, string> = {
  muitas_mensagens: 'Muitas mensagens seguidas. Aguarde alguns segundos.',
  dados_invalidos: 'Mensagem inválida.',
};

export function Chat({
  topic,
  preferential = false,
  connect,
}: {
  topic: TopicSlug;
  preferential?: boolean;
  connect: () => ChatClient;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [queueStatus, setQueueStatus] = useState<'ai' | 'queued' | 'offered' | 'active'>('ai');
  const [askingHuman, setAskingHuman] = useState(false);
  const socketRef = useRef<ChatClient | null>(null);
  const lastSeq = useRef(0);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;

  function merge(incoming: ChatMessage[]) {
    setMessages((current) => {
      const next = mergeMessages(current, incoming);
      lastSeq.current = next.at(-1)?.seq ?? 0;
      return next;
    });
  }

  /** Envia (ou reenvia) uma mensagem pendente. Mesmo clientMsgId = o servidor não duplica. */
  async function deliver(p: Pending) {
    const socket = socketRef.current;
    if (!socket?.connected) return; // fica pendente; reenvia quando reconectar
    try {
      const res = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('mensagem:enviar', { clientMsgId: p.clientMsgId, body: p.body });
      if (res.ok) {
        merge([
          {
            seq: res.seq,
            clientMsgId: p.clientMsgId,
            sender: 'customer',
            // O servidor devolve o texto gravado: CPF, cartão e senha já aparecem escondidos.
            body: res.body,
            createdAt: new Date().toISOString(),
          },
        ]);
        setPending((list) => list.filter((x) => x.clientMsgId !== p.clientMsgId));
      } else {
        const error = ERRORS[res.error] ?? 'Não foi possível enviar.';
        setPending((list) =>
          list.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, error } : x)),
        );
      }
    } catch {
      // Sem resposta em 5 s: continua pendente e é reenviada na reconexão.
    }
  }

  useEffect(() => {
    const socket = connect();
    socketRef.current = socket;

    const onConnect = async () => {
      setOnline(true);
      try {
        // afterSeq: na reconexão, o servidor manda só o que esta aba ainda não viu.
        const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('conversa:entrar', {
          topic,
          afterSeq: lastSeq.current,
          preferential,
        });
        if (res.ok) merge(res.messages);
      } catch {
        return;
      }
      for (const p of pendingRef.current) if (!p.error) await deliver(p);
    };
    const onDisconnect = () => {
      setOnline(false);
      // O "desliga" pode se perder com a conexão; a resposta chega pela reconexão.
      setTyping(false);
    };
    const onMessage = (message: ChatMessage) => merge([message]);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const onFila = (data: { status: 'queued' | 'offered' | 'active' }) => {
      setQueueStatus(data.status);
    };
    socket.on('mensagem:nova', onMessage);
    socket.on('assistente:digitando', setTyping);
    socket.on('fila:atualizada', onFila);
    if (socket.connected) void onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('mensagem:nova', onMessage);
      socket.off('assistente:digitando', setTyping);
      socket.off('fila:atualizada', onFila);
      socket.disconnect();
    };
    // `connect` precisa ser estável (useCallback no pai): se mudar, a conexão é refeita.
  }, [connect, topic, preferential]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    const p: Pending = { clientMsgId: crypto.randomUUID(), body };
    setPending((list) => [...list, p]);
    setText('');
    void deliver(p);
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Chat de atendimento">
      <p className="text-xs text-slate-500" role="status">
        {online ? 'Conectado' : 'Reconectando…'}
      </p>

      <ol role="log" aria-live="polite" className="flex min-h-64 flex-col gap-2">
        {messages.map((m) => (
          <li
            key={m.seq}
            className={
              m.sender === 'customer'
                ? 'self-end rounded-lg bg-teal-700 px-3 py-2 text-white'
                : 'self-start rounded-lg bg-white px-3 py-2 shadow-sm'
            }
          >
            {m.sender === 'ai' && (
              // O cliente precisa saber quando fala com uma máquina (transparência da IA).
              <span className="block text-xs font-medium text-teal-800">Assistente virtual</span>
            )}
            {m.body}
            {m.sources && (
              <span className="mt-1 block text-xs text-slate-500">
                Fonte: {m.sources.map((s) => `${s.title} (${s.section})`).join('; ')}
              </span>
            )}
          </li>
        ))}
        {pending.map((p) => (
          <li
            key={p.clientMsgId}
            className="self-end rounded-lg bg-teal-700/60 px-3 py-2 text-white"
            aria-label={p.error ? 'Mensagem não enviada' : 'Mensagem enviando'}
          >
            {p.body}
            <span className="block text-xs">{p.error ?? 'enviando…'}</span>
          </li>
        ))}
      </ol>
      {typing && (
        <p className="text-xs text-slate-500" aria-live="polite">
          Assistente virtual digitando…
        </p>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="mensagem" className="sr-only">
          Mensagem
        </label>
        <input
          id="mensagem"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_MESSAGE_LENGTH}
          autoComplete="off"
          placeholder="Escreva sua dúvida"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2"
        />
        <button type="submit" className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white">
          Enviar
        </button>
      </form>
      {queueStatus === 'ai' ? (
        <button
          type="button"
          disabled={askingHuman || !online}
          onClick={async () => {
            const socket = socketRef.current;
            if (!socket?.connected) return;
            setAskingHuman(true);
            try {
              const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('fila:pedir');
              if (res.ok) setQueueStatus('queued');
            } finally {
              setAskingHuman(false);
            }
          }}
          className="self-start text-sm font-medium text-teal-800 underline disabled:opacity-50"
        >
          {askingHuman ? 'Pedindo atendente…' : 'Falar com atendente'}
        </button>
      ) : (
        <p className="text-sm text-teal-900" role="status">
          {queueStatus === 'queued' && 'Na fila de um atendente humano…'}
          {queueStatus === 'offered' && 'Um atendente está recebendo sua conversa…'}
          {queueStatus === 'active' && 'Você está conversando com um atendente.'}
        </p>
      )}
      <p className="text-xs text-slate-500">
        Nunca envie senha, código do token ou número completo do cartão.
      </p>
    </section>
  );
}
