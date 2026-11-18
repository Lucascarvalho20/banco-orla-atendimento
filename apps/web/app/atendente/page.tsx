import Link from 'next/link';
import { AtendenteApp } from './atendente-app';

export default function AtendentePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-4 py-8">
      <nav className="flex flex-wrap gap-3 text-sm">
        <Link className="text-slate-600 underline" href="/">
          Central de dúvidas
        </Link>
        <Link className="text-slate-600 underline" href="/atendimento">
          Atendimento
        </Link>
        <Link className="font-medium text-teal-800 underline" href="/atendente">
          Painel do atendente
        </Link>
      </nav>

      <header className="border-b border-slate-200/80 pb-4">
        <p className="text-sm font-medium tracking-wide text-teal-800 uppercase">Banco Orla</p>
        <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight text-[var(--orla-ink)]">
          Mesa de atendimento
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Fila com cards expansíveis, preferencial, chat da equipe e papéis atendente/supervisor.
          Demo: <code className="rounded bg-slate-100 px-1">ana@bancoorla.example</code> ·
          supervisor <code className="rounded bg-slate-100 px-1">sofia@bancoorla.example</code> ·
          senha <code className="rounded bg-slate-100 px-1">atendente-demo</code>
        </p>
      </header>

      <AtendenteApp />
    </main>
  );
}
