'use client';

import { useCallback, useState } from 'react';
import { Chat } from './chat';
import { createChatClient } from './chat-client';
import { EntradaForm, type StartedSession } from './entrada-form';
import { useRealtimeUrl } from './realtime-url';

export function Atendimento() {
  const apiUrl = useRealtimeUrl();
  const [session, setSession] = useState<StartedSession | null>(null);
  const connect = useCallback(() => createChatClient(apiUrl), [apiUrl]);

  if (!session) return <EntradaForm apiUrl={apiUrl} onStart={setSession} />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">
        Atendimento de <strong>{session.displayName}</strong> · CPF final •••-{session.cpfLast2}
        {session.preferential ? ' · preferencial' : ''}
      </p>
      <Chat topic={session.topic} preferential={session.preferential} connect={connect} />
    </div>
  );
}
