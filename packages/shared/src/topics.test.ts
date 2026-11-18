import { describe, expect, it } from 'vitest';
import { TOPICS, topicSlugSchema } from './topics.js';

describe('topicSlugSchema', () => {
  it('aceita todos os assuntos cadastrados', () => {
    for (const topic of TOPICS) {
      expect(topicSlugSchema.parse(topic.slug)).toBe(topic.slug);
    }
  });

  it('rejeita assunto desconhecido', () => {
    expect(topicSlugSchema.safeParse('admin').success).toBe(false);
  });
});
