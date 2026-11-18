# Plano do projeto (ajustes sobre o briefing original)

O briefing original (`briefing-original.md`) descrevia o **Protocola**, um portal fictício de
processos. Em 12/11/2026 decidimos trocar o tema para o **Banco Orla**, um banco digital
fictício (ver ADR 0010). **A arquitetura não muda**; só muda o conteúdo da base de conhecimento.

## Assuntos de atendimento

| Assunto                      | Exemplos de dúvidas/erros que a base cobre                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Acesso ao app e senha        | Senha bloqueada após tentativas, troca de celular, app não abre, biometria                                                                      |
| Abertura de conta e cadastro | Selfie rejeitada, documento ilegível, CPF irregular na Receita, menor de idade, atualizar endereço                                              |
| Pix e transferências         | Pix não caiu, limite noturno (20h–6h), chave já cadastrada em outro banco, Pix agendado, devolução por golpe (MED), TED fora do horário, boleto |
| Cartão                       | Compra recusada, cartão bloqueado, fatura, cartão virtual, limite                                                                               |
| Segurança e golpes           | Golpe do falso atendente, falsa central, link de phishing, como contestar                                                                       |
| Outro assunto                | Texto livre → IA tenta a base; se não souber, atendente                                                                                         |

## Decisões tomadas com o Lucas

| Tema        | Decisão                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escopo      | **V1 completa e testada** + V2 local (Redis, MongoDB, agente com 4 ferramentas, copiloto, painel do supervisor)                                                                     |
| AWS         | Serviços das vagas (S3, SQS+DLQ, Lambda, CloudWatch, EventBridge/SNS) **emulados com MiniStack** (ADR 0012), usando o SDK oficial; Terraform aplicado contra o emulador. Zero custo |
| NoSQL       | MongoDB (mensagens e traces na V2); DynamoDB só como comparação no estudo                                                                                                           |
| Observab.   | Logs estruturados + CloudWatch emulado + Prometheus/Grafana (ADR 0013)                                                                                                              |
| Vagas-alvo  | Software Engineer II / Fullstack Pleno — mapa no guia de estudo (repositório privado)                                                                                               |
| Custo       | Tudo grátis: Ollama local (GPU RTX 4080), Docker local                                                                                                                              |
| Código      | Modo explicação: a IA escreve o código e explica linha a linha no estudo (sem exercícios obrigatórios)                                                                              |
| Repositório | GitHub **privado** agora; público quando formos postar no LinkedIn                                                                                                                  |
| Modelos     | `llama3.1:8b` (respostas) e `nomic-embed-text` (embeddings, 768 dimensões)                                                                                                          |

## Etapas

| #   | Etapa                                                                                               | Tecnologias das vagas                         | Status                                       |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| 0   | Plano, revisão, AGENTS.md, ADRs                                                                     | Documentar decisões                           | ✅                                           |
| 1   | Monorepo, Docker Compose, CI                                                                        | Docker, Git/PR, testes                        | ✅                                           |
| 2   | Banco: schema, migrations, `ai_reader` com RLS, testes com Postgres real                            | SQL, PostgreSQL, testes de integração         | ✅                                           |
| 3   | Entrada do cliente (nome + CPF em HMAC) e sessão anônima; tela com React Testing Library            | API REST, segurança, RTL                      | ✅                                           |
| 4   | Chat em tempo real (Socket.IO, ack, seq, reconexão)                                                 | Node, eventos                                 | ✅                                           |
| 5   | Base de conhecimento fictícia + FAQ + **ingestão S3 → SQS (+DLQ) → Lambda** → pgvector              | **S3, SQS, Lambda**, processamento assíncrono | ✅                                           |
| 6   | RAG: busca híbrida + Llama com fonte + "não sei"                                                    | IA aplicada                                   | ✅                                           |
| 7   | Guardas de entrada/saída + 30 testes de ataque no CI + avaliação                                    | Qualidade/custo/falha da IA                   | ✅                                           |
| 8   | Fila `SKIP LOCKED` + painel do atendente + teste de concorrência                                    | SQL avançado, performance                     | ✅                                           |
| 9   | Observabilidade: logs → **CloudWatch**, métricas → Prometheus + **Grafana**, alarme, _runbook_      | **CloudWatch**, incidentes                    | ✅                                           |
| 10  | **Vitrine V1**: README + Central de dúvidas + demo local; post LinkedIn (Lucas)                     | —                                             | 🟡 README/demo prontos; post/vídeo com Lucas |
| 11  | V2: MongoDB (mensagens/traces), **EventBridge/SNS**, agente com 4 ferramentas, copiloto, supervisor | **NoSQL, EventBridge, SNS**                   | ✅ (supervisor já na V1; resto nesta etapa)  |
| 12  | Terraform contra o MiniStack + **Kubernetes local (kind)**                                          | **IaC, Kubernetes**                           | ✅ manifests + TF local                      |
| 13  | Vitrine final (V2)                                                                                  | —                                             | 🟡 README/flags; post LinkedIn com Lucas     |
