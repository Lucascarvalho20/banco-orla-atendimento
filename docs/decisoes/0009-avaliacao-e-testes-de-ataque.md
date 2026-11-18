# 0009 — Estratégia de avaliação e testes de ataque

**Status:** aceito

## Contexto

"Funcionou quando testei" não prova nada em IA: a mesma pergunta pode ter respostas diferentes, e
mudar prompt, modelo ou base pode piorar o que já funcionava.

## Decisão

1. **Testes de ataque (red team) determinísticos no CI** — `evals/ataques.json` com 30+ tentativas
   (pedir admin, pedir CPF/saldo de outra pessoa, "ignore suas instruções", "SYSTEM:", outro idioma,
   base64, pedir o prompt, pedir senha/token, link falso, HTML). Rodam contra as **guardas**
   (código determinístico). A saída simula um LLM _fake_ que obedece ao ataque — se a guarda
   segura mesmo assim, a defesa não depende do modelo. **Build falha** se algum passar.
2. **Avaliação de qualidade local** (com o Llama real, fora do CI) — `evals/perguntas.yaml` com ~50
   perguntas, resposta esperada e documento que deve ser citado. Métricas (skill `evaluate-rag`):
   Recall@5 e MRR da busca, fidelidade da resposta, recusa correta. Relatório Markdown versionado.
3. Prompts versionados; a versão vai no trace para comparar antes/depois.

## Consequências

- ✅ CI rápido, grátis e determinístico.
- ⚠️ A qualidade com o modelo real é medida localmente; resultados entram no README.
