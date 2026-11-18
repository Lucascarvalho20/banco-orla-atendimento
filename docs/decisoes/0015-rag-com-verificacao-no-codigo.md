# 0015 — RAG com verificação no código (o modelo propõe, o código confere)

**Status:** aceito

## Contexto

Depois da FAQ (ADR 0014), sobram perguntas que os documentos respondem mas nenhuma resposta pronta
cobre ("dá pra programar um Pix pra semana que vem?"). Um modelo local de 8B (`llama3.1:8b`) consegue
redigir a resposta a partir dos trechos, mas **inventa** com alguma frequência: num banco, uma
resposta errada dita com confiança é pior que "não sei".

Medimos antes de decidir (`pnpm eval:busca`, `pnpm eval:rag`, 24 perguntas da base + 6 fora do
assunto):

- A **similaridade sozinha não separa** pergunta da base de pergunta fora do assunto: a pior
  pergunta da base teve 0,61 no melhor trecho; a melhor pergunta fora do assunto, 0,675.
- Com um prompt mais "solto", o modelo respondeu 2 de 6 perguntas fora do assunto com regras que
  não estão em documento nenhum.

## Opções

1. **Confiar no prompt** ("responda só com base nos trechos") — barato, mas o prompt é um pedido,
   não uma garantia. Foi exatamente o que falhou na medição.
2. **Limite alto de similaridade** antes de chamar o modelo — rejeita pergunta fora do assunto, mas
   também perguntas legítimas (as faixas se sobrepõem).
3. **Modelo maior ou API paga** — melhor qualidade, mas fora da restrição do projeto (tudo local e
   grátis) e ainda sem garantia.
4. **O modelo propõe, o código confere** — o modelo decide se os trechos respondem, mas a resposta só
   chega ao cliente se passar por verificações determinísticas.

## Decisão

Opção 4, com a busca híbrida da ADR 0006 (vetor + texto em português, RRF, top 5, só documentos
publicados, lidos pelo `ai_reader`). A resposta do modelo passa por, nesta ordem:

1. **Pré-filtro barato**: melhor trecho abaixo de 0,5 → "não sei" sem chamar o modelo.
2. **Recusa**: o marcador `SEM_RESPOSTA` ou frases como "não há informações" → "não sei".
3. **Citações**: cada resposta precisa citar `[n]` de um trecho que existe; sem citação válida →
   "não sei". As fontes mostradas ao cliente vêm do código, nunca do texto do modelo.
4. **Números**: todo número da resposta (prazo, valor, horário) precisa aparecer num trecho
   fornecido.
5. **Fidelidade**: a resposta, em vetor, precisa ser parecida (≥ 0,75) com algum trecho que cita.
   Calibrado: respostas corretas ficaram entre 0,79 e 0,94; a inventada, em 0,735.

Também: trechos e pergunta vão entre delimitadores (`<trechos>`, `<pergunta>`) que são removidos do
conteúdo antes; temperatura 0; no máximo 350 tokens de saída; resposta cortada em 1000 caracteres;
Markdown removido. Cada chamada grava um **trace** (`ai_traces`) só com números e ids — sem o texto
da pergunta nem da resposta — e a versão do prompt (`rag-v3`). Cada conversa pode fazer até **15**
perguntas aos documentos (a FAQ continua sem limite).

## Consequências

- ✅ Resultado medido: 23 de 24 perguntas da base respondidas com a fonte certa, 6 de 6 perguntas
  fora do assunto com "não sei", **0 respostas inventadas**, mediana de 0,6 s por resposta (RTX 4080).
- ✅ No navegador, o caso do seguro se repetiu: o modelo inventou "não vendemos seguro" e a checagem
  de fidelidade barrou (trace com `reason: unsupported_answer`, `grounding: 0.735`).
- ✅ Cada "não sei" tem um motivo registrado: dá para saber se faltou documento, se o modelo recusou
  ou se o código barrou.
- ⚠️ Uma resposta da base saiu com o conteúdo certo mas a **citação trocada** (boleto citando o
  documento de fatura). As verificações não pegam isso; um reranker ou modelo maior pegaria.
- ⚠️ Os limites (0,5 e 0,75) foram calibrados com poucos casos. Com perguntas reais, recalibrar.
- ⚠️ A checagem de fidelidade custa mais uma chamada de vetores por resposta (~30 ms).
- ⚠️ "Não sei" ainda só pede para reformular; o encaminhamento para um atendente é da Etapa 8.
