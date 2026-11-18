# 0014 — Ingestão assíncrona (S3 → SQS → Lambda) e FAQ por similaridade

**Status:** aceito

## Contexto

A IA só pode responder com base em documentos aprovados. Esses documentos mudam (limites, golpes
novos), então precisamos de um jeito de **publicar um documento e ele entrar na busca sozinho**,
sem derrubar o chat e sem reprocessar o que não mudou. Também queremos que as perguntas mais comuns
sejam respondidas **sem chamar o modelo de linguagem** (rápido, grátis, sem inventar).

## Opções

1. **Script manual** que lê a pasta e grava no banco — simples, mas alguém precisa lembrar de rodar,
   e uma falha no meio deixa a base pela metade.
2. **Ingestão dentro do servidor do chat** — o mesmo processo que atende clientes faria trabalho
   pesado (gerar vetores); um documento grande deixaria o chat lento.
3. **S3 → SQS (+DLQ) → Lambda** — o upload dispara um evento; a fila guarda o pedido até a Lambda
   processar; o que falhar 3 vezes vai para a DLQ para alguém olhar.
4. **S3 → Lambda direto** (sem fila) — menos peças, mas a Lambda recebe o evento uma vez só: sem
   controle de tentativas, de paralelismo nem lugar para guardar o que falhou.

Para a FAQ: comparar **palavras** (busca de texto) ou comparar **significado** (vetores).

## Decisão

- Opção 3, emulada com o MiniStack (ADR 0012). A fila tem visibilidade de 180 s (6 × o tempo máximo
  da Lambda), `maxReceiveCount` 3, lotes de 5, **falha parcial do lote** (só a mensagem com problema
  volta para a fila) e no máximo 2 Lambdas em paralelo.
- **Idempotência pelo conteúdo**: o documento guarda o sha256 do texto; se o mesmo arquivo chegar de
  novo (reenvio, fila entregando duas vezes), nada é recalculado. Em uma só transação, a versão só
  sobe quando o hash muda (`ON CONFLICT ... DO UPDATE ... WHERE hash <> novo_hash`).
- **Usuário de banco próprio (`kb_writer`)**: escreve só nas tabelas da base de conhecimento, com no
  máximo 5 conexões e consultas de no máximo 30 s. Mesmo que a Lambda seja comprometida, ela não
  consegue ler nem alterar conversas ou sessões.
- **FAQ por vetores** (pergunta do cliente × pergunta da FAQ), com similaridade mínima **0,8**,
  calibrada com 30 perguntas de teste (`pnpm eval:faq`): nenhuma resposta errada. Abaixo disso, o
  cliente é avisado; na Etapa 6, a pergunta segue para a busca nos documentos (RAG).
- O chat responde **depois** de confirmar a mensagem do cliente, numa fila por conexão (as respostas
  saem na ordem das perguntas). Se o Ollama cair, o cliente recebe um aviso e a mensagem dele não se
  perde.

## Consequências

- ✅ Publicar documento = enviar o arquivo ao bucket. Reenvio não custa nada.
- ✅ Documento com defeito não trava a fila: vai para a DLQ com o motivo registrado em log JSON.
- ✅ A FAQ responde sem o modelo de linguagem: a resposta é exatamente o texto aprovado.
- ⚠️ A ingestão é **eventualmente consistente**: entre o upload e o trecho aparecer na busca passam
  alguns segundos. Para uma base de conhecimento, isso é aceitável.
- ⚠️ A FAQ prefere **não responder** a responder errado (7 de 30 perguntas de teste ficaram sem
  resposta pronta). A Etapa 6 cobre esses casos com RAG.
- ⚠️ Apagar um arquivo do bucket ainda não remove os trechos do banco (fica para quando houver
  painel de administração).
- ⚠️ No MiniStack o IAM não é aplicado: a política de menor privilégio da Lambda está documentada
  no estudo, mas só seria testada de verdade na AWS.
