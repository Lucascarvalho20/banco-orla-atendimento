import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOPICS } from '@orla/shared';
import Link from 'next/link';
import { FaqAccordion } from './faq-accordion';

type FaqItem = { topic: string; question: string; answer: string };

function loadFaq(): FaqItem[] {
  const path = join(process.cwd(), '../../knowledge/faq.json');
  return JSON.parse(readFileSync(path, 'utf8')) as FaqItem[];
}

export default function Home() {
  const faq = loadFaq();
  const byTopic = TOPICS.map((t) => ({
    ...t,
    items: faq.filter((f) => f.topic === t.slug),
  })).filter((t) => t.items.length > 0);

  return (
    <div className="min-h-screen">
      <div className="bg-[linear-gradient(160deg,var(--orla-teal-deep)_0%,#134e4a_42%,transparent_42%)]">
        <header className="mx-auto flex max-w-3xl flex-wrap items-end justify-between gap-3 px-4 py-5 text-teal-50">
          <div className="min-w-0">
            <p className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Banco Orla
            </p>
            <p className="text-xs font-medium tracking-[0.18em] uppercase opacity-80">
              Central de dúvidas
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <Link
              className="underline decoration-teal-200/50 underline-offset-4"
              href="/atendimento"
            >
              Atendimento
            </Link>
            <Link className="underline decoration-teal-200/50 underline-offset-4" href="/atendente">
              Área do atendente
            </Link>
          </nav>
        </header>

        <main className="mx-auto max-w-3xl px-4 pb-16">
          <section className="orla-rise mb-12 max-w-xl text-teal-50">
            <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
              Tire dúvidas antes de falar com a gente
            </h1>
            <p className="orla-rise-delay mt-3 text-sm leading-relaxed text-teal-100/90 sm:text-base">
              FAQ do Banco Orla (projeto de portfólio fictício). Se a resposta não aparecer aqui,
              inicie o chat: a IA tenta ajudar e, se precisar, você entra na fila de um atendente
              humano.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/atendimento"
                className="rounded-md bg-[var(--orla-sand)] px-4 py-2.5 text-sm font-semibold text-[var(--orla-ink)] transition hover:brightness-105"
              >
                Abrir atendimento ao vivo
              </Link>
              <a
                href="#faq"
                className="rounded-md border border-teal-100/40 px-4 py-2.5 text-sm text-teal-50 transition hover:bg-white/5"
              >
                Ver FAQ
              </a>
            </div>
          </section>

          <section
            id="faq"
            className="rounded-xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_12px_40px_-24px_rgba(15,61,62,0.45)] sm:p-7"
          >
            <h2 className="font-display text-2xl font-semibold text-slate-900">
              Perguntas frequentes
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Respostas oficiais da base de conhecimento do demo. Clique para expandir.
            </p>
            <div className="mt-6 flex flex-col gap-8">
              {byTopic.map((group) => (
                <div key={group.slug}>
                  <h3 className="mb-3 text-sm font-semibold tracking-wide text-teal-800 uppercase">
                    {group.name}
                  </h3>
                  <FaqAccordion items={group.items} />
                </div>
              ))}
            </div>
          </section>

          <p className="mt-8 text-center text-xs text-slate-500">
            Portfólio fictício. Inspirado em fluxos de atendimento com triagem e fila humana — tema
            banco digital para não expor sistemas reais.
          </p>
        </main>
      </div>
    </div>
  );
}
