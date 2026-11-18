# AGENTS.md — regras para qualquer IA que trabalhe neste repositório

Projeto de portfólio do Lucas: **atendimento em tempo real do Banco Orla (fictício)** com IA.
Briefing completo: `docs/briefing-original.md` + ajustes em `docs/plano.md`.

## Como trabalhar com o Lucas

- Fale sempre em **português do Brasil**, direto e simples.
- **Modo professor:** antes de cada tarefa, explique em poucas linhas o que vai fazer e por quê.
- **Passos pequenos**, uma funcionalidade por vez, uma branch e um PR por etapa.
- **Modo explicação (escolha do Lucas):** a IA escreve todo o código; **sem `TODO(eu)` nem
  exercícios obrigatórios**. Em compensação, todo trecho importante (SQL, transações, eventos do
  socket, chunking, prompt, testes) ganha explicação **linha a linha** no estudo da etapa, mais
  "como explicar na entrevista". Registrar em `docs/uso-de-ia.md` que o código foi gerado pela IA.
- Todo estudo de etapa tem uma seção **"E se fossem 100 mil pessoas?"** (100 → 1 mil → 10 mil → 100
  mil) e as escolhas novas entram no banco "por que X e não Y" de `docs/arquitetura-e-escala.md` (público).
- Ao fim de cada etapa: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, mostrando o
  resultado. Corrigir antes de seguir.
- Toda etapa gera `docs/estudo/NN-nome.md` (o que, por quê, conceitos, alternativas, como quebra em
  produção, 3 perguntas pleno + 2 sênior com resposta, explicação linha a linha do código-chave).
- **`docs/estudo/` é outro repositório, privado** (`orla-atendimento-estudo`), clonado dentro desta
  pasta e ignorado pelo Git deste. Commit e push dele são feitos **lá dentro**
  (`git -C docs/estudo ...`). Nunca mover conteúdo do estudo para fora dessa pasta.
- **Antes de tornar este repositório público:** o histórico antigo (commits e PRs #1–#8) contém
  `docs/estudo/`. Publicar a partir de um repositório **novo** com o histórico limpo
  (`git filter-repo --invert-paths --path docs/estudo` + `--replace-text` trocando "tribunal" por
  "órgão público"), nunca mudando a visibilidade deste.
- **Origem do projeto (como contar):** "inspirado no sistema de chat que eu **usava como atendente**
  no estágio num **órgão público**; construí minha versão do zero, com tema fictício". Nunca dizer
  ou escrever que o sistema foi desenvolvido no estágio, nem citar o nome do órgão ou do sistema dele.
- Decisão de arquitetura nova = ADR em `docs/decisoes/NNNN-titulo.md`.
- Registrar em `docs/uso-de-ia.md` o que a IA gerou e o que o Lucas escreveu/revisou.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`).

## Regras de segurança (inegociáveis)

1. **Nunca** commitar segredo. Segredos só em `.env` (ignorado pelo Git); exemplos em `.env.example`.
2. **Nunca** logar CPF, senha, token, número de cartão ou cookie. O logger mascara esses campos.
3. CPF só é guardado como **HMAC-SHA256 com segredo** + 2 últimos dígitos para exibição.
4. A IA do produto (Llama) é um **usuário não confiável**:
   - Não tem acesso ao banco operacional. O usuário de banco `ai_reader` só tem `SELECT` em `kb_*`.
   - Só pode chamar as **4 ferramentas** do ADR 0008. Ferramenta nova exige ADR aprovado pelo Lucas.
   - IDs de sessão/conversa vêm do servidor, **nunca** do texto do modelo.
   - Autorização é feita no código, nunca pelo modelo.
5. A IA **nunca pede** senha, código de token, CVV ou número completo de cartão, e a guarda de saída
   bloqueia esses padrões mesmo que o cliente os digite.
6. Texto do usuário e da IA nunca vira HTML (sem `dangerouslySetInnerHTML`). Links só de domínios
   da lista permitida.
7. Serviços locais escutam só em `127.0.0.1`. CORS restrito a `WEB_ORIGIN`.
8. Se o Lucas pedir algo que enfraquece a segurança ou pula fundamentos, avise e proponha o caminho certo.

## Stack e comandos

- Monorepo **pnpm + Turborepo**, TypeScript `strict` (TS 6 — ver ADR 0011).
- `apps/web` (Next.js), `apps/realtime` (Fastify + Socket.IO), `packages/shared` (Zod), `packages/db`
  (Drizzle), `packages/ai` (FAQ, RAG, guardas, avaliação).
- Infra local: `node scripts/gerar-env.mjs` (cria `.env` com segredos aleatórios) →
  `docker compose up -d` (Postgres + pgvector em `127.0.0.1:55432`; a 5432 da máquina do Lucas é de
  um Postgres nativo) → `pnpm db:migrate && pnpm db:seed`. IA: Ollama no Windows (`llama3.1:8b`,
  `nomic-embed-text`).
- AWS **só emulada** (MiniStack, ADR 0012) via `AWS_ENDPOINT_URL`. Nunca usar credenciais AWS reais
  nem rodar `terraform apply` contra a AWS de verdade.
- `pnpm dev | lint | typecheck | test | build | format:check`. Testes do `packages/db` sobem um
  Postgres real com Testcontainers (Docker precisa estar aberto).
- Vagas-alvo e mapa de tecnologias: `docs/estudo/vagas.md` (repositório privado).

## Skills do projeto

Em `.cursor/skills/` (auditadas, ver `SOURCES.md`): `llm-security` (OWASP LLM — consultar em toda
mudança em `packages/ai`), `evaluate-rag` (avaliação de recuperação/geração),
`hybrid-search-implementation` (pgvector + tsvector + RRF).
