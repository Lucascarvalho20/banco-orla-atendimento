import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { hashCpf, SESSION_COOKIE } from './sessions.js';
import { memoryStores, testEnv as env } from './test/memory-stores.js';

const CPF = '529.982.247-25';
const entrada = { name: 'Ana Lima', cpf: CPF, topic: 'pix' };

let app: FastifyInstance;
let saved: ReturnType<typeof memoryStores>['sessions'];

beforeEach(async () => {
  const mem = memoryStores();
  saved = mem.sessions;
  app = await buildApp(env, { sessions: mem.sessionStore, chat: mem.chatStore });
});
afterEach(async () => {
  await app.close();
});

const criarSessao = (payload: unknown = entrada) =>
  app.inject({ method: 'POST', url: '/sessions', payload: payload as object });

describe('GET /health', () => {
  it('responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('envia cabeçalhos de segurança', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('só libera CORS para a origem do front', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    const evil = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://site-malicioso.example' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://site-malicioso.example');
  });
});

describe('POST /sessions', () => {
  it('cria a sessão e devolve só nome e 2 últimos dígitos', async () => {
    const res = await criarSessao();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ displayName: 'Ana Lima', cpfLast2: '25', topic: 'pix' });
    expect(res.body).not.toContain('52998224725');
  });

  it('grava o HMAC do CPF, nunca o CPF', async () => {
    await criarSessao();
    expect(saved[0]!.cpfHash).toBe(hashCpf('52998224725', env.CPF_HMAC_SECRET));
    expect(saved[0]!.cpfHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toContain('52998224725');
  });

  it('entrega a sessão num cookie httpOnly, SameSite=Lax e assinado', async () => {
    const res = await criarSessao();
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.value).toContain(`${saved[0]!.id}.`); // valor + "." + assinatura
  });

  it('recusa CPF inválido sem ecoar o que foi enviado', async () => {
    const res = await criarSessao({ ...entrada, cpf: '529.982.247-26' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'dados_invalidos',
      issues: [{ field: 'cpf', message: 'CPF inválido. Confira os números.' }],
    });
    expect(res.body).not.toContain('529');
    expect(saved).toHaveLength(0);
  });

  it('limita a 5 tentativas por minuto (anti-robô)', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await criarSessao()).statusCode);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

describe('GET /sessions/me', () => {
  it('reconhece a sessão pelo cookie', async () => {
    const created = await criarSessao();
    const cookie = created.cookies.find((c) => c.name === SESSION_COOKIE)!;
    const res = await app.inject({
      method: 'GET',
      url: '/sessions/me',
      cookies: { [SESSION_COOKIE]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ displayName: 'Ana Lima', cpfLast2: '25' });
  });

  it('recusa cookie adulterado (trocar o id quebra a assinatura)', async () => {
    const created = await criarSessao();
    const cookie = created.cookies.find((c) => c.name === SESSION_COOKIE)!;
    const forged = `${randomUUID()}.${cookie.value.split('.').pop()}`;
    const res = await app.inject({
      method: 'GET',
      url: '/sessions/me',
      cookies: { [SESSION_COOKIE]: forged },
    });
    expect(res.statusCode).toBe(401);
  });

  it('recusa sem cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('loadEnv', () => {
  it('falha quando falta variável obrigatória, sem mostrar valores', () => {
    expect(() => loadEnv({ WEB_ORIGIN: 'http://localhost:3000' })).toThrow(
      /DATABASE_URL, AI_READER_PASSWORD, CPF_HMAC_SECRET, SESSION_SECRET/,
    );
  });

  it('recusa segredo curto', () => {
    expect(() =>
      loadEnv({
        WEB_ORIGIN: 'http://localhost:3000',
        DATABASE_URL: env.DATABASE_URL,
        CPF_HMAC_SECRET: env.CPF_HMAC_SECRET,
        SESSION_SECRET: 'curto',
      }),
    ).toThrow(/SESSION_SECRET/);
  });
});
