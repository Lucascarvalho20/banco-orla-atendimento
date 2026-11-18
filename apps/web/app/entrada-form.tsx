'use client';

import { entradaSchema, formatCpf, TOPICS, type TopicSlug } from '@orla/shared';
import { useState, type FormEvent } from 'react';

type Field = 'name' | 'cpf' | 'topic';
type Errors = Partial<Record<Field, string>>;
type Status = { kind: 'idle' | 'sending' } | { kind: 'error'; message: string };

export interface StartedSession {
  displayName: string;
  cpfLast2: string;
  topic: TopicSlug;
  preferential: boolean;
}

const GENERIC_ERROR = 'Não foi possível iniciar o atendimento. Tente de novo em instantes.';

function toErrors(issues: { field?: string; path?: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const field = (issue.field ?? String(issue.path?.[0] ?? '')) as Field;
    errors[field] ??= issue.message;
  }
  return errors;
}

export function EntradaForm({
  apiUrl,
  onStart,
}: {
  apiUrl: string;
  onStart: (session: StartedSession) => void;
}) {
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [topic, setTopic] = useState('');
  const [preferential, setPreferential] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  /** Ao editar um campo, o erro antigo dele some (senão parece que a correção não funcionou). */
  function edit(field: Field, setter: (value: string) => void, value: string) {
    setter(value);
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = entradaSchema.safeParse({ name, cpf, topic, preferential });
    if (!parsed.success) {
      setErrors(toErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setStatus({ kind: 'sending' });

    try {
      const res = await fetch(`${apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { displayName: string; cpfLast2: string };
        onStart({
          displayName: body.displayName,
          cpfLast2: body.cpfLast2,
          topic: parsed.data.topic,
          preferential: parsed.data.preferential,
        });
      } else if (res.status === 400) {
        const body = (await res.json()) as { issues: { field: string; message: string }[] };
        setErrors(toErrors(body.issues));
        setStatus({ kind: 'idle' });
      } else if (res.status === 429) {
        setStatus({
          kind: 'error',
          message: 'Muitas tentativas. Aguarde 1 minuto e tente de novo.',
        });
      } else {
        setStatus({ kind: 'error', message: GENERIC_ERROR });
      }
    } catch {
      setStatus({ kind: 'error', message: GENERIC_ERROR });
    }
  }

  const fieldClass =
    'rounded-md border border-slate-300 px-3 py-2 aria-[invalid=true]:border-red-500';

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">
          Nome
        </label>
        <input
          id="name"
          autoComplete="given-name"
          maxLength={60}
          value={name}
          onChange={(e) => edit('name', setName, e.target.value)}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'name-error' : undefined}
          className={fieldClass}
        />
        {errors.name && (
          <p id="name-error" className="text-sm text-red-700">
            {errors.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="cpf" className="text-sm font-medium">
          CPF
        </label>
        <input
          id="cpf"
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          value={cpf}
          onChange={(e) => edit('cpf', setCpf, formatCpf(e.target.value))}
          aria-invalid={Boolean(errors.cpf)}
          aria-describedby={errors.cpf ? 'cpf-error' : undefined}
          className={fieldClass}
        />
        {errors.cpf && (
          <p id="cpf-error" className="text-sm text-red-700">
            {errors.cpf}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="topic" className="text-sm font-medium">
          Assunto
        </label>
        <select
          id="topic"
          value={topic}
          onChange={(e) => edit('topic', setTopic, e.target.value)}
          aria-invalid={Boolean(errors.topic)}
          aria-describedby={errors.topic ? 'topic-error' : undefined}
          className={fieldClass}
        >
          <option value="">Escolha um assunto</option>
          {TOPICS.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>
        {errors.topic && (
          <p id="topic-error" className="text-sm text-red-700">
            Escolha um assunto.
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={preferential}
          onChange={(e) => setPreferential(e.target.checked)}
          // Autofill do browser pode marcar o checkbox antes da hidratação e gerar mismatch.
          suppressHydrationWarning
        />
        <span>
          Atendimento <strong>preferencial</strong> (idoso, PCD, gestante ou similar — como a fila
          preferencial do banco)
        </span>
      </label>

      {status.kind === 'error' && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {status.message}
        </p>
      )}

      <button
        type="submit"
        disabled={status.kind === 'sending'}
        className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {status.kind === 'sending' ? 'Entrando…' : 'Iniciar atendimento'}
      </button>
    </form>
  );
}
