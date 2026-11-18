import { z } from 'zod';

export const TOPICS = [
  { slug: 'acesso', name: 'Acesso ao app e senha' },
  { slug: 'cadastro', name: 'Abertura de conta e cadastro' },
  { slug: 'pix', name: 'Pix e transferências' },
  { slug: 'cartao', name: 'Cartão de crédito e débito' },
  { slug: 'golpes', name: 'Segurança e golpes' },
  { slug: 'outro', name: 'Outro assunto' },
] as const;

export type TopicSlug = (typeof TOPICS)[number]['slug'];

export const topicSlugSchema = z.enum(TOPICS.map((t) => t.slug) as [TopicSlug, ...TopicSlug[]]);
