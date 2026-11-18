# 0003 — Serviço Node separado para WebSocket

**Status:** aceito

## Contexto

O chat precisa de conexão persistente (mensagens, "digitando…", oferta de 30 s para o atendente).

## Opções

1. Tudo dentro do Next.js (route handlers).
2. **Serviço separado** `apps/realtime` com Fastify + Socket.IO.
3. Serviço gerenciado (Pusher, Ably).

## Decisão

Serviço separado com Fastify + Socket.IO.

## Consequências

- ✅ Plataformas serverless (Vercel etc.) não mantêm WebSocket aberto; um processo Node longo sim.
- ✅ Socket.IO dá reconexão, _rooms_ e _ack_ prontos.
- ✅ O temporizador de 30 s da oferta roda no **servidor** (o cliente não pode burlar).
- ⚠️ Dois processos para subir e um CORS a configurar (restrito a `WEB_ORIGIN`).
- ⚠️ Escalar para várias instâncias exige o _adapter_ Redis do Socket.IO (V2).
