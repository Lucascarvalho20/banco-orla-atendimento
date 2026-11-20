'use client';

import type {
  AgentQueueItem,
  AgentTeamChatMessage,
  AgentTeamMember,
  ChatMessage,
  CustomerProfile,
} from '@orla/shared';
import { QUEUE_PRIORITY_PREFERENTIAL } from '@orla/shared';
import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useRealtimeUrl } from '../realtime-url';

type AgentInfo = { id: string; name: string; email: string; role: 'agent' | 'supervisor' };

function waitLabel(queuedAt: string | null, nowMs = Date.now()): string {
  if (!queuedAt) return '—';
  const min = Math.max(0, Math.floor((nowMs - new Date(queuedAt).getTime()) / 60_000));
  if (min < 1) return 'menos de 1 min';
  return min === 1 ? '1 min' : `${min} min`;
}

function isPreferential(item: AgentQueueItem): boolean {
  return item.priority >= QUEUE_PRIORITY_PREFERENTIAL;
}

export function AtendenteApp() {
  const apiUrl = useRealtimeUrl();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [email, setEmail] = useState('ana@bancoorla.example');
  const [password, setPassword] = useState('atendente-demo');
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [offer, setOffer] = useState<AgentQueueItem | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [team, setTeam] = useState<AgentTeamMember[]>([]);
  const [queued, setQueued] = useState<AgentQueueItem[]>([]);
  const [actives, setActives] = useState<AgentQueueItem[]>([]);
  const [active, setActive] = useState<AgentQueueItem | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [teamChat, setTeamChat] = useState<AgentTeamChatMessage[]>([]);
  const [teamText, setTeamText] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const refreshDesk = useCallback(async (s: Socket) => {
    try {
      const res = await s.timeout(8_000).emitWithAck('mesa:estado');
      if (!res.ok) {
        setError('Não foi possível carregar a mesa. Tente sair e entrar de novo.');
        return;
      }
      setTeam(res.team);
      setQueued(res.queued);
      setActives(res.active);
      setQueuedCount(res.queuedCount);
    } catch {
      setError('Conexão com a mesa falhou. Confira se o realtime está no ar.');
    }
  }, []);

  const loadTeamChat = useCallback(async (s: Socket) => {
    const res = await s.emitWithAck('equipe:historico');
    if (res.ok) setTeamChat(res.messages);
  }, []);

  const login = async () => {
    setError(null);
    const res = await fetch(`${apiUrl}/agents/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('Login inválido. Use o e-mail demo e a senha atendente-demo.');
      return;
    }
    const body = (await res.json()) as AgentInfo;
    setAgent(body);
    // Presença real vem do banco (último login pode ter ficado online).
    const me = await fetch(`${apiUrl}/agents/me`, { credentials: 'include' });
    if (me.ok) {
      const info = (await me.json()) as { presence?: string };
      setOnline(info.presence === 'online');
    }
  };

  const logout = async () => {
    if (socket && online) {
      await socket.emitWithAck('presenca', { status: 'offline' }).catch(() => undefined);
    }
    socket?.disconnect();
    setSocket(null);
    await fetch(`${apiUrl}/agents/logout`, { method: 'POST', credentials: 'include' });
    setAgent(null);
    setOnline(false);
    setOffer(null);
    setActive(null);
    setProfile(null);
    setTeamChat([]);
  };

  const connectSocket = useCallback(() => {
    const s = io(`${apiUrl}/agent`, {
      withCredentials: true,
      transports: ['websocket'],
    });
    s.on('connect', () => {
      setError(null);
      void refreshDesk(s);
      void loadTeamChat(s);
    });
    s.on('connect_error', () => {
      setError('Falha ao conectar na mesa (cookie/login). Saia e entre de novo.');
    });
    s.on('fila:oferta', (item: AgentQueueItem) => setOffer(item));
    s.on('fila:oferta_expirada', () => setOffer(null));
    s.on('mensagem:nova', (m: ChatMessage) => setMessages((list) => [...list, m]));
    s.on('equipe:mensagem', (m: AgentTeamChatMessage) => setTeamChat((list) => [...list, m]));
    s.on('equipe:estado', (payload: { team: AgentTeamMember[] }) => setTeam(payload.team));
    s.on('mesa:atualizada', () => void refreshDesk(s));
    setSocket(s);
    return s;
  }, [apiUrl, refreshDesk, loadTeamChat]);

  useEffect(() => {
    if (!agent) return;
    const s = connectSocket();
    const timer = setInterval(() => void refreshDesk(s), 8_000);
    return () => {
      clearInterval(timer);
      s.disconnect();
    };
  }, [agent, connectSocket, refreshDesk]);

  const setPresence = async (status: 'online' | 'offline') => {
    if (!socket) return;
    const res = await socket.emitWithAck('presenca', { status });
    if (res.ok) {
      setOnline(status === 'online');
      await refreshDesk(socket);
    }
  };

  const nextOffer = async () => {
    if (!socket) return;
    setError(null);
    const res = await socket.emitWithAck('fila:proxima');
    if (res.ok) {
      setQueuedCount(res.queued);
      setOffer(res.offer);
      if (!res.offer) setError('Nenhuma pendência na fila agora.');
      await refreshDesk(socket);
    }
  };

  const openConversation = async (conversationId: string) => {
    if (!socket) return;
    const res = await socket.emitWithAck('mesa:abrir', { conversationId });
    if (!res.ok) {
      setError('Não foi possível abrir a conversa.');
      return;
    }
    setActive(res.conversation);
    setMessages(res.messages);
    setProfile(res.profile);
    setCanWrite(res.canWrite);
    setOffer(null);
    setError(null);
  };

  const claimPending = async (conversationId: string) => {
    if (!socket) return;
    if (!online) {
      setError('Fique online antes de atender uma pendência.');
      return;
    }
    setError(null);
    const res = await socket.emitWithAck('fila:pegar', { conversationId });
    if (!res.ok) {
      setError(
        res.error === 'atendente_indisponivel'
          ? 'Você precisa estar online e com vaga livre.'
          : 'Essa pendência já foi pega por outro atendente.',
      );
      await refreshDesk(socket);
      return;
    }
    setActive(res.conversation);
    setMessages(res.messages);
    setProfile({
      displayName: res.conversation.displayName,
      cpfLast2: res.conversation.cpfLast2,
      topicSlug: res.conversation.topicSlug,
      topicName: res.conversation.topicName,
      conversationStatus: 'active',
      aiSummary: res.conversation.aiSummary,
      agentName: agent?.name ?? null,
    });
    setCanWrite(true);
    setOffer(null);
    await refreshDesk(socket);
  };

  const accept = async () => {
    if (!socket || !offer) return;
    const res = await socket.emitWithAck('fila:aceitar', { conversationId: offer.id });
    if (res.ok) {
      setActive(res.conversation);
      setMessages(res.messages);
      setProfile({
        displayName: res.conversation.displayName,
        cpfLast2: res.conversation.cpfLast2,
        topicSlug: res.conversation.topicSlug,
        topicName: res.conversation.topicName,
        conversationStatus: 'active',
        aiSummary: res.conversation.aiSummary,
        agentName: agent?.name ?? null,
      });
      setCanWrite(true);
      setOffer(null);
      await refreshDesk(socket);
    }
  };

  const decline = async () => {
    if (!socket || !offer) return;
    await socket.emitWithAck('fila:recusar', { conversationId: offer.id });
    setOffer(null);
    await refreshDesk(socket);
  };

  const send = async () => {
    if (!socket || !active || !text.trim() || !canWrite) return;
    const body = text.trim();
    setText('');
    const res = await socket.emitWithAck('mensagem:enviar', {
      conversationId: active.id,
      clientMsgId: crypto.randomUUID(),
      body,
    });
    if (!res.ok) {
      setError(
        res.error === 'somente_leitura'
          ? 'Atendente normal só visualiza conversas de colegas.'
          : 'Falha ao enviar.',
      );
    }
  };

  const suggestCopilot = async () => {
    if (!socket || !active || !canWrite) return;
    setError(null);
    const res = await socket.emitWithAck('mesa:copiloto', { conversationId: active.id });
    if (!res.ok) {
      setError('Copiloto indisponível agora. Escreva a resposta manualmente.');
      return;
    }
    setText(res.suggestion);
  };

  const sendTeam = async () => {
    if (!socket || !teamText.trim()) return;
    const body = teamText.trim();
    setTeamText('');
    const res = await socket.emitWithAck('equipe:enviar', { body });
    if (!res.ok) {
      setError('Não foi possível enviar no chat da equipe.');
      return;
    }
    setTeamChat((list) =>
      list.some((m) => m.id === res.message.id) ? list : [...list, res.message],
    );
  };

  const close = async () => {
    if (!socket || !active || !canWrite) return;
    await socket.emitWithAck('fila:encerrar', { conversationId: active.id });
    setActive(null);
    setMessages([]);
    setProfile(null);
    setCanWrite(false);
    await refreshDesk(socket);
  };

  if (!agent) {
    return (
      <form
        className="flex max-w-sm flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void login();
        }}
      >
        <p className="font-display text-lg font-semibold text-[var(--orla-ink)]">Entrar na mesa</p>
        <label className="text-sm">
          E-mail
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="text-sm">
          Senha
          <input
            type="password"
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button type="submit" className="rounded-md bg-teal-800 px-4 py-2.5 font-medium text-white">
          Entrar no painel
        </button>
        <p className="text-xs leading-relaxed text-slate-500">
          Atendente: ana@bancoorla.example · Supervisor: sofia@bancoorla.example · senha:
          atendente-demo
        </p>
      </form>
    );
  }

  const isSupervisor = agent.role === 'supervisor';

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr_300px]">
      <aside className="flex flex-col gap-3 rounded-md border bg-white p-3 text-sm">
        <div>
          <strong>{agent.name}</strong>
          <span className="ml-1 text-xs text-slate-500">
            ({isSupervisor ? 'supervisor' : 'atendente'})
          </span>
          <p className="mt-1 text-xs">
            Status:{' '}
            <span className={online ? 'font-medium text-teal-700' : 'text-slate-500'}>
              {online ? 'online' : 'offline'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border px-2 py-1"
            onClick={() => void setPresence(online ? 'offline' : 'online')}
          >
            {online ? 'Ficar offline' : 'Ficar online'}
          </button>
          <button
            type="button"
            className="rounded-md border px-2 py-1"
            onClick={() => void logout()}
          >
            Sair
          </button>
        </div>
        <p className="text-slate-500">Pendências: {queuedCount}</p>

        <h2 className="mt-2 font-medium">Equipe online</h2>
        <ul className="flex flex-col gap-1">
          {team.map((m) => (
            <li key={m.id} className="flex justify-between gap-2">
              <span>
                {m.name}
                {m.role === 'supervisor' ? ' ★' : ''}
              </span>
              <span className={m.status === 'online' ? 'text-teal-700' : 'text-slate-400'}>
                {m.status}
                {m.activeCount > 0 ? ` · ${m.activeCount}` : ''}
              </span>
            </li>
          ))}
        </ul>

        <h2 className="mt-3 font-medium">Chat da equipe</h2>
        <ol className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border bg-slate-50 p-2 text-xs">
          {teamChat.length === 0 && <li className="text-slate-500">Nenhuma mensagem ainda.</li>}
          {teamChat.map((m) => (
            <li key={m.id}>
              <strong>{m.fromName}:</strong> {m.body}
            </li>
          ))}
        </ol>
        <div className="flex gap-1">
          <input
            className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
            value={teamText}
            onChange={(e) => setTeamText(e.target.value)}
            placeholder="Falar com a equipe"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendTeam();
            }}
          />
          <button
            type="button"
            className="rounded bg-slate-800 px-2 py-1 text-xs text-white"
            onClick={() => void sendTeam()}
          >
            Enviar
          </button>
        </div>
      </aside>

      <section className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {online && (
          <div className="flex flex-col gap-2 rounded-md border bg-white p-4">
            <button
              type="button"
              className="self-start rounded-md bg-teal-700 px-3 py-2 text-white"
              onClick={() => void nextOffer()}
            >
              Próxima da fila
            </button>
            {offer && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium">
                  Oferta · {offer.displayName} · {offer.topicName} (30 s)
                </p>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">
                  {offer.aiSummary}
                </pre>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded bg-teal-700 px-3 py-1 text-white"
                    onClick={() => void accept()}
                  >
                    Aceitar
                  </button>
                  <button
                    type="button"
                    className="rounded border px-3 py-1"
                    onClick={() => void decline()}
                  >
                    Recusar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {active && (
          <section
            className="flex flex-col gap-3 rounded-md border bg-white p-4"
            aria-label="Conversa ativa"
          >
            <header className="text-sm">
              <strong>{active.displayName}</strong> · CPF final •••-{active.cpfLast2} ·{' '}
              {active.topicName}
              {!canWrite && (
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  somente leitura
                </span>
              )}
              {isSupervisor && canWrite && active.agentId && active.agentId !== agent.id && (
                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  supervisão · {active.agentName}
                </span>
              )}
            </header>
            <ol className="flex max-h-[28rem] min-h-64 flex-col gap-2 overflow-y-auto scroll-smooth">
              {messages.length === 0 && (
                <li className="text-sm text-slate-500">
                  Nenhuma mensagem nesta conversa (ou o histórico ainda não sincronizou).
                </li>
              )}
              {messages.map((m) => (
                <li
                  key={m.seq}
                  className={
                    m.sender === 'agent'
                      ? 'self-end rounded bg-teal-700 px-3 py-2 text-white'
                      : 'self-start rounded bg-slate-100 px-3 py-2'
                  }
                >
                  <span className="block text-xs opacity-70">{m.sender}</span>
                  {m.body}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <input
                className="min-w-0 flex-1 rounded border px-3 py-2 disabled:bg-slate-50"
                value={text}
                disabled={!canWrite}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  canWrite ? 'Responder ao cliente' : 'Só o dono ou supervisor pode enviar'
                }
              />
              <button
                type="button"
                className="rounded border border-teal-700 px-3 py-2 text-teal-900 disabled:opacity-50"
                disabled={!canWrite}
                onClick={() => void suggestCopilot()}
                title="A IA sugere; você edita e envia"
              >
                Copiloto
              </button>
              <button
                type="button"
                className="rounded bg-teal-700 px-3 py-2 text-white disabled:opacity-50"
                disabled={!canWrite}
                onClick={() => void send()}
              >
                Enviar
              </button>
              <button
                type="button"
                className="rounded border px-3 py-2 disabled:opacity-50"
                disabled={!canWrite}
                onClick={() => void close()}
              >
                Encerrar
              </button>
            </div>
          </section>
        )}
      </section>

      <aside className="flex flex-col gap-4 text-sm">
        {profile && (
          <div className="rounded-md border bg-white p-3">
            <h2 className="font-medium">Perfil do cliente</h2>
            <dl className="mt-2 space-y-1 text-slate-700">
              <div className="flex justify-between gap-2">
                <dt>Nome</dt>
                <dd>{profile.displayName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>CPF</dt>
                <dd>•••-{profile.cpfLast2}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Assunto</dt>
                <dd>{profile.topicName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Status</dt>
                <dd>{profile.conversationStatus}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Atendente</dt>
                <dd>{profile.agentName ?? '—'}</dd>
              </div>
            </dl>
            {profile.aiSummary && (
              <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
                {profile.aiSummary}
              </pre>
            )}
          </div>
        )}

        <div className="rounded-md border bg-white p-3">
          <h2 className="font-medium">Fila de espera ({queuedCount})</h2>
          <p className="mt-1 text-xs text-slate-500">
            Ordem: preferencial primeiro, depois quem entrou antes (FIFO). Clique no nome para
            expandir.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {queued.length === 0 && <li className="text-slate-500">Nenhuma na fila</li>}
            {queued.map((c, index) => (
              <li key={c.id}>
                <details className="rounded border border-slate-200 open:bg-slate-50">
                  <summary className="cursor-pointer list-none px-2 py-2 text-sm marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-teal-800 text-[10px] font-semibold text-white">
                          {index + 1}
                        </span>
                        <span className="truncate font-medium">{c.displayName}</span>
                        {isPreferential(c) && (
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                            preferencial
                          </span>
                        )}
                        {c.status === 'offered' && (
                          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-900">
                            reservado
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {waitLabel(c.queuedAt, nowMs)}
                      </span>
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-slate-100 px-2 py-2 text-xs text-slate-700">
                    <p>
                      <strong>Assunto:</strong> {c.topicName}
                    </p>
                    <p>
                      <strong>CPF:</strong> •••-{c.cpfLast2}
                    </p>
                    <p>
                      <strong>Status:</strong>{' '}
                      {c.status === 'offered' ? 'Oferecido a um atendente (30 s)' : 'Na fila'}
                    </p>
                    <p>
                      <strong>Na fila há:</strong> {waitLabel(c.queuedAt, nowMs)}
                    </p>
                    {c.aiSummary && (
                      <pre className="whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-slate-600">
                        {c.aiSummary}
                      </pre>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        className="rounded bg-teal-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                        disabled={!online}
                        onClick={() => void claimPending(c.id)}
                      >
                        Atender
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => void openConversation(c.id)}
                      >
                        Só ver
                      </button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border bg-white p-3">
          <h2 className="font-medium">Em atendimento</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {actives.length === 0 && <li className="text-slate-500">Nenhuma</li>}
            {actives.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left hover:bg-slate-50"
                  onClick={() => void openConversation(c.id)}
                >
                  {c.displayName}
                  <span className="block text-xs text-slate-500">
                    {c.agentName ?? '—'} · {c.topicName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            {isSupervisor
              ? 'Supervisor pode abrir e enviar em qualquer conversa ativa.'
              : 'Você pode visualizar as de colegas; só envia nas suas.'}
          </p>
        </div>
      </aside>
    </div>
  );
}
