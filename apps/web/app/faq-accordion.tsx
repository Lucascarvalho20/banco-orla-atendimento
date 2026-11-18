'use client';

export function FaqAccordion({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
      {items.map((item) => (
        <details key={item.question} className="group px-3 py-1 open:bg-[var(--orla-foam)]">
          <summary className="cursor-pointer list-none py-2.5 text-sm font-medium text-slate-900 marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-start justify-between gap-3">
              {item.question}
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-teal-700/30 text-teal-800 transition group-open:rotate-45"
              >
                +
              </span>
            </span>
          </summary>
          <p className="pb-3 text-sm leading-relaxed text-slate-600">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
