import type { Metadata } from 'next';
import { Fraunces, Source_Sans_3 } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-orla-display',
  display: 'swap',
});

const sans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-orla-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Banco Orla — Central de dúvidas',
  description:
    'Portfólio fictício: FAQ, atendimento com IA (RAG) e fila humana com painel do atendente.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
