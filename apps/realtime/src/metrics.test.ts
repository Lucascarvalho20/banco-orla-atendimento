import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createMetrics } from './metrics.js';
import { memoryStores, testEnv } from './test/memory-stores.js';

describe('/metrics', () => {
  it('expõe o formato Prometheus e conta requisições HTTP', async () => {
    const metrics = createMetrics();
    const mem = memoryStores();
    const app = await buildApp(testEnv, {
      sessions: mem.sessionStore,
      chat: mem.chatStore,
      metrics,
    });
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('orla_http_requests_total');
    expect(res.body).toContain('orla_assistant_answers_total');
    expect(res.body).toContain('/health');
    await app.close();
  });
});
