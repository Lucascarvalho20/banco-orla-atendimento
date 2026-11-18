# ADR 0016 — Supervisor na mesa de atendimento

## Contexto

A fila (Etapa 8) já tinha o papel `supervisor` no schema e no seed (`sofia@…`), mas o painel
só mostrava a conversa do próprio atendente. Em operação real, o supervisor precisa ver a equipe,
a fila e entrar em conversas de colegas para ajudar — sem transferir a “posse” automaticamente.

## Decisão

1. **Mesa compartilhada** (eventos `mesa:estado` / `mesa:abrir`): qualquer atendente autenticado
   vê equipe (online/offline), fila pendente e conversas ativas, com perfil seguro do cliente
   (nome, últimos 2 dígitos do CPF, assunto, resumo — nunca CPF completo).
2. **Escrita:**
   - atendente (`agent`): envia só nas conversas em que é o `agent_id`;
   - supervisor: pode enviar (e encerrar) em qualquer conversa `active`; a mensagem ganha prefixo
     `[Supervisão · Nome]` quando não é o dono.
3. **Origem local:** CORS/WebSocket aceitam `localhost` e `127.0.0.1` como o mesmo front; o web
   resolve a URL do realtime pelo hostname da página (corrige “não foi possível iniciar”).
4. **Chat da equipe** (`agent_messages` + eventos `equipe:*`): atendentes conversam entre si sem
   misturar com o chat do cliente.
5. **Pegar pendência** (`fila:pegar`): da lista “Pendências” o atendente online assume um caso
   específico (assunto visível), sem depender só de “próxima da fila”.

## Consequências

- Demo mais crível para entrevista (dois logins, papéis diferentes).
- Sem “admin mágico”: autorização continua no servidor pelo `role` do cookie, não pelo cliente.
- Transferência formal de conversa continua fora do escopo (pode ser ADR futuro).
- URLs de uso: `http://127.0.0.1:3000` (cliente) e `http://127.0.0.1:3000/atendente` (painel).
  O GitHub hospeda o código; o app não abre pelo link do PR.
