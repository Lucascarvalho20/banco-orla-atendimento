import Link from 'next/link';
import { Atendimento } from '../atendimento';

export default function AtendimentoPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <nav className="flex gap-3 text-sm">
        <Link className="text-slate-600 underline" href="/">
          Central de dúvidas
        </Link>
        <Link className="font-medium text-teal-800 underline" href="/atendimento">
          Atendimento
        </Link>
        <Link className="text-slate-600 underline" href="/atendente">
          Atendente
        </Link>
      </nav>

      <header>
        <p className="text-sm font-medium tracking-wide text-teal-800 uppercase">Banco Orla</p>
        <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight text-[var(--orla-ink)]">
          Fale com a Orla
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Informe nome, CPF e assunto. A IA responde o que puder; se precisar, peça um atendente e
          entre na fila (FIFO — quem chega primeiro, com preferencial na frente).
        </p>
      </header>

      <Atendimento />

      <p className="rounded-lg border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Projeto de portfólio <strong>fictício</strong>. O Banco Orla não existe e nenhum dado real é
        usado. Nunca envie senha, token ou número completo de cartão.
      </p>
    </main>
  );
}
