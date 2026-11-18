# Arquitetura e escala: "por que X e não Y?" e "e se fossem 100 mil pessoas?"

> Guia transversal (vale para o projeto todo). É atualizado a cada etapa.
> Os números de capacidade são **estimativas de ordem de grandeza** para raciocinar em entrevista,
> não medições — dizer isso em voz alta conta pontos.

## 1. Como responder "por que você escolheu X e não Y?"

Use sempre os 5 passos (cabe em 30 segundos):

1. **Contexto** — "Era um projeto local, sem custo, para até ~100 pessoas ao mesmo tempo."
2. **Opções** — "Considerei X e Y."
3. **Critério** — "O que mais pesava era Z (custo, segurança, simplicidade, prazo)."
4. **Escolha** — "Por isso X."
5. **Quando eu mudaria** — "Se tivesse W (escala, equipe, orçamento), eu iria de Y."

O passo 5 é o que mais impressiona: mostra que você não tem "ferramenta favorita", tem **critério**.
Toda decisão grande do projeto está registrada em `docs/decisoes/` (ADRs) exatamente nesse formato.

## 2. Banco de perguntas "por que X e não Y?"

| Pergunta                                                                 | Resposta curta                                                                                                                                                                         | Quando eu mudaria                                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **PostgreSQL e não MongoDB** para o principal?                           | Dados relacionais (sessão → conversa → mensagens → atendente), transações, `SKIP LOCKED` para a fila, pgvector para busca: **um banco faz tudo**                                       | Volume enorme de mensagens/traces com esquema variável → Mongo/DynamoDB só para isso (V2)    |
| **pgvector e não Pinecone/Weaviate**?                                    | Base pequena; mesmo banco = mesma transação, mesmo backup, mesma permissão (RLS no `ai_reader`); grátis                                                                                | Milhões de vetores com latência crítica, ou time dedicado de busca                           |
| **Ollama local e não API da OpenAI**?                                    | Custo zero, dado não sai da máquina (LGPD), roda offline; a IA está atrás de uma interface (ADR 0007)                                                                                  | Produção com muitos usuários: API gerenciada (escala e qualidade) — troca só o "adaptador"   |
| **RAG e não fine-tuning**?                                               | O conhecimento muda (regras do Pix); no RAG basta trocar o documento, e a resposta **cita a fonte**. Fine-tuning é caro, desatualiza e não cita                                        | Para mudar o **estilo/formato** da resposta, não o conhecimento                              |
| **Fastify e não Express/NestJS**?                                        | Mais rápido que Express, validação e logs (pino) nativos, plugins de segurança oficiais; Nest é ótimo mas traz muita estrutura para um serviço pequeno                                 | Time grande, muitos módulos e padrão corporativo → Nest                                      |
| **Socket.IO e não WebSocket puro**?                                      | Já traz confirmação, salas, reconexão e adaptador Redis                                                                                                                                | Precisando de desempenho máximo com protocolo próprio, ou clientes que não usam a lib        |
| **Cookie de sessão e não JWT**?                                          | `httpOnly` protege de XSS; revogável apagando a linha no banco                                                                                                                         | Comunicação entre serviços (máquina ↔ máquina) → JWT                                         |
| **Monorepo e não um repositório por app**?                               | Front e back compartilham validação e tipos: mudou o contrato, o typecheck acusa nos dois                                                                                              | Times independentes com ciclos de deploy diferentes                                          |
| **Drizzle e não Prisma**?                                                | SQL visível, tipos sem gerador pesado, bom com pgvector/RLS/SQL puro                                                                                                                   | Time que prefere abstração maior e ferramentas visuais do Prisma                             |
| **Fila com `SKIP LOCKED` e não SQS/Redis** para atendentes?              | A fila está no mesmo banco das conversas: atribuir conversa e mudar status na **mesma transação**                                                                                      | Volume muito alto ou consumidores em vários sistemas → fila dedicada                         |
| **SQS + Lambda** para ingerir documentos (Etapa 5)?                      | Processamento demorado e assíncrono: o upload não espera; falha vai para DLQ; escala sozinho                                                                                           | Se fossem poucos documentos por mês, um script simples bastaria (e eu diria isso)            |
| **Fila entre o S3 e a Lambda** e não S3 → Lambda direto?                 | A fila guarda o pedido, controla tentativas e paralelismo (2 Lambdas = no máximo 4 conexões no banco) e manda o que falhou para a DLQ                                                  | Evento raro e sem risco de sobrecarregar ninguém → direto é mais simples                     |
| **Hash do conteúdo** e não "processou esta mensagem?" para não duplicar? | A SQS pode entregar a mesma mensagem duas vezes, e o mesmo arquivo pode ser reenviado: o hash cobre os dois casos, sem tabela extra de mensagens                                       | Processamento com efeito externo (cobrança, e-mail) → guardar o id da operação               |
| **FAQ por vetores** e não por palavras-chave?                            | "quanto posso mandar de pix de noite?" e "limite do Pix noturno" não têm quase nenhuma palavra igual, mas o mesmo significado                                                          | Termos exatos (código de erro, número de protocolo) → busca de texto (a Etapa 6 usa as duas) |
| **Busca híbrida** se empatou com a vetorial na medição?                  | Com 29 trechos, empatou (Recall@5 1,00 nas duas). Mantive porque siglas e números exatos ("MED", "R$ 1.000") são o ponto fraco do vetor e crescem com a base; o custo é uma CTE a mais | Se a medição numa base grande mostrar que não ajuda, tiro — e digo que medi                  |
| **Código conferindo a resposta** e não só um prompt bem escrito?         | Prompt é pedido, não garantia: com um prompt mais solto, o Llama 8B inventou 2 de 6 respostas fora do assunto. Citação, números e fidelidade são checados no código                    | Modelo muito maior e avaliado → algumas checagens viram alarme em vez de bloqueio            |
| **"Não sei" em vez de responder com o melhor trecho**?                   | Num banco, regra inventada com confiança gera prejuízo e reclamação; "não sei" leva ao atendente                                                                                       | Assunto de baixo risco (ex.: dica de uso do app) → aceitar mais respostas                    |
| **Temperatura 0** e não a padrão?                                        | Mesma pergunta, mesma resposta: dá para reproduzir um bug e comparar versões do prompt na avaliação                                                                                    | Texto criativo (marketing) → temperatura maior                                               |
| **Sem streaming** (resposta inteira de uma vez)?                         | As checagens precisam do texto completo antes de mostrar; mostrar aos poucos e depois "desmostrar" seria pior. O "digitando…" cobre a espera (~0,6 s)                                  | Respostas longas (> 3 s) → streaming com checagem por frase                                  |
| **Limite 0,8 na FAQ** e não mais baixo?                                  | Calibrado com 30 perguntas: com 0,8, zero respostas erradas. Num banco, resposta errada é pior que "não sei"                                                                           | Com mais perguntas reais de clientes, recalibrar (`pnpm eval:faq`)                           |
| **Usuário de banco próprio para a ingestão** (`kb_writer`)?              | Menor privilégio: se a Lambda for invadida, ela só alcança a base de conhecimento, nunca conversas ou sessões                                                                          | Nunca juntaria; na AWS real ainda somaria uma IAM Role só com `s3:GetObject` no bucket       |
| **HMAC e não criptografia** para o CPF?                                  | Não preciso do CPF de volta, só reconhecer o cliente; HMAC é irreversível sem o segredo                                                                                                | Se a regra de negócio exigisse mostrar o CPF completo → criptografia com chave em KMS        |
| **Vitest e não Jest**?                                                   | Mesma API, mais rápido, nativo de TypeScript/ESM                                                                                                                                       | Projeto legado já em Jest → manter Jest                                                      |
| **MiniStack e não LocalStack**?                                          | LocalStack passou a exigir conta/token; MiniStack é aberto e roda a Lambda sem acesso ao Docker da máquina                                                                             | Empresa que já usa LocalStack Pro                                                            |
| **Next.js e não React puro (Vite)**?                                     | Rotas, build otimizado e cabeçalhos de segurança prontos                                                                                                                               | Página única simples, sem SEO → Vite basta                                                   |
| **Guardas em código e não só no prompt**?                                | Prompt é pedido, não garantia. OWASP LLM01/02/05/07: o CI precisa provar a defesa com 40+ ataques, mesmo com LLM fake obediente                                                        | Nunca só prompt; em produção ainda somaria WAF/rate limit na borda                           |
| **Mascarar no servidor e não só avisar o cliente**?                      | Minimização (LGPD): o valor sensível não fica no banco, no histórico do atendente nem no log                                                                                           | Nunca; aviso sozinho não impede vazamento                                                    |
| **Recusar injeção sem chamar o modelo**?                                 | Economiza GPU, não dá chance do modelo "negociar" com o atacante, resposta previsível                                                                                                  | Classificador ML extra em escala muito grande, **além** das regex                            |
| **JSON de ataques no repo e não planilha manual**?                       | Toda PR roda a bateria; regressão de guarda quebra o CI                                                                                                                                | Red team humano periódico para achar casos novos que ainda não estão no arquivo              |
| **`SKIP LOCKED` e não lock otimista** na fila?                           | Zero duplicidade sem o segundo atendente ficar esperando; prova com 50 ofertas paralelas                                                                                               | Fila externa (SQS) quando o Postgres deixar de ser o lugar certo do estado                   |
| **scrypt do Node e não argon2** na senha do atendente?                   | Mesma classe de KDF; sem compilação nativa no Windows/CI                                                                                                                               | Empresa padroniza argon2id → troco e mantenho o mesmo fluxo de cookie                        |

## 3. "E se fossem 100 mil pessoas?" — o sistema inteiro

### O desenho hoje (até ~100 pessoas)

```
Navegador ──HTTP/WebSocket──▶ realtime (1 instância) ──▶ PostgreSQL (1)
                                    │
                                    └──▶ Ollama (1 GPU)
```

### Onde cada parte "quebra" primeiro

| Peça                   | Limite aproximado                                                     | Por quê                                                               |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **IA (Ollama, 1 GPU)** | **Primeira a quebrar**: poucas respostas sendo geradas ao mesmo tempo | Gerar texto é caro; cada resposta leva segundos de GPU                |
| Servidor realtime      | Milhares de conexões abertas por instância                            | Conexão parada custa pouca memória; o custo é o trabalho por mensagem |
| PostgreSQL             | Milhares de escritas simples por segundo numa máquina boa             | Mensagens são escritas pequenas; índices certos ajudam                |
| Atendentes humanos     | O limite real do negócio                                              | Por isso a IA + FAQ resolvem antes da fila                            |

### Escada de crescimento

| Pessoas simultâneas | O que muda                                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **100**             | Como está. Um de cada.                                                                                                                                                                                                                                                                                                                 |
| **1.000**           | **FAQ e cache** na frente da IA (pergunta repetida não gasta GPU). Fila para pedidos à IA com limite de concorrência. Métricas e alarmes (Etapa 9).                                                                                                                                                                                    |
| **10.000**          | **2+ instâncias** do realtime atrás de balanceador + **Redis** (broadcast entre instâncias). **PgBouncer** (pool de conexões). IA via **API gerenciada** ou várias GPUs. Banco com réplica de leitura e backup automático. Deploy sem queda (graceful shutdown + várias instâncias).                                                   |
| **100.000**         | Mensagens/traces num banco de escrita rápida (**Mongo/DynamoDB**) ou gravação via **fila (SQS)**. Eventos (**EventBridge**) para métricas e relatórios fora do caminho principal. **Kubernetes/autoescala** por número de conexões. Vários datacenters/zonas (Multi-AZ). Limites por cliente e proteção contra "manada" de reconexões. |

### Conta de guardanapo (treine fazer em voz alta)

> 100.000 pessoas conectadas, cada uma manda **1 mensagem a cada 30 s**
> → 100.000 ÷ 30 ≈ **3.300 mensagens/s** para gravar.
> Se **30%** precisam da IA (o resto a FAQ resolve) → **~1.000 pedidos/s** à IA.
> Uma resposta leva ~3 s → ~3.000 respostas sendo geradas **ao mesmo tempo**.
> Detalhe que entrevistador gosta: até a FAQ usa a GPU — cada pergunta vira um vetor (~30 ms).
> 3.300/s × 30 ms ≈ 100 s de GPU por segundo → ~100 chamadas simultâneas só de vetor. Barato perto
> de gerar texto, mas pede **cache por pergunta repetida** e um serviço de vetores separado.
> Conclusão: o gargalo é a IA, não o banco. Prioridade: FAQ/cache, depois API gerenciada com
> limite de taxa, e **degradar com elegância** (fila humana quando a IA estiver saturada).

## 4. "Como não ter quedas?" — disponibilidade

| Problema                          | Proteção                                                              | Onde no projeto                                               |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Deploy derruba conexões           | Desligamento gracioso + várias instâncias                             | Etapa 1 (feito), V2                                           |
| Uma instância trava               | Health check (`/health`) + orquestrador reinicia                      | Etapa 1 (feito), Etapa 12 (Kubernetes)                        |
| IA lenta ou fora                  | **Timeout** + resposta de reserva ("vou te passar para um atendente") | Etapas 5 e 6 (feito: timeouts de 8 s e 30 s + aviso), Etapa 8 |
| Documento com defeito na ingestão | 3 tentativas e depois **DLQ**; falha parcial do lote                  | Etapa 5 (feito)                                               |
| Pico de tráfego / robô            | Rate limit por IP e por conexão                                       | Etapas 3 e 4 (feito)                                          |
| Banco cai                         | Réplica + failover automático (RDS Multi-AZ), backup                  | Discussão (fora do escopo local)                              |
| Mensagem perdida na queda         | `ack` + reenvio + idempotência                                        | Etapa 4 (feito)                                               |
| Documento quebrado na ingestão    | Retry + DLQ, sem travar a fila                                        | Etapa 5                                                       |
| Ninguém percebe o problema        | Métricas + alarmes + logs com ID de correlação                        | Etapa 9                                                       |

**Frase para a entrevista:** _"Não dá para nunca cair; dá para cair **pouco**, **perceber rápido** e
**degradar com elegância**. No meu projeto, se a IA cai, o cliente vai para a fila humana em vez de
ver erro."_

## 5. Perguntas que costumam vir em seguida

1. **"Qual é o gargalo do seu sistema?"** — A IA (GPU). Mostre a conta de guardanapo.
2. **"Como você saberia que está ficando lento?"** — Métricas de latência por etapa (busca × geração),
   tamanho da fila, taxa de erro; alarme quando passar do limite (Etapa 9).
3. **"O que você faria primeiro com mais orçamento?"** — Observabilidade e uma segunda instância
   (eliminar ponto único de falha) antes de qualquer otimização.
4. **"E o custo?"** — Cache/FAQ reduz chamadas de IA; medir custo por conversa (cada trace guarda
   tokens de entrada e saída); limite de 15 perguntas aos documentos por conversa (Etapa 6).
