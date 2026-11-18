# 0007 — Provedor de LLM e de embeddings atrás de interface

**Status:** aceito

## Contexto

Queremos custo zero agora (Ollama local), mas talvez uma demo pública (Groq) ou um modelo mais forte
(Claude) depois.

## Opções

1. Usar o SDK de um provedor direto no código — rápido, mas acopla tudo a ele.
2. **Interfaces próprias** `LLMProvider` (`chat`, `stream`) e `EmbeddingProvider` (`embed`), com uma
   implementação por provedor, escolhida por `LLM_PROVIDER` no `.env`.
3. Framework (LangChain) — abstrai, mas adiciona muita dependência e esconde o que acontece.

## Decisão

Interfaces próprias, pequenas. Implementação inicial: `OllamaProvider` (HTTP direto na API do Ollama).
Nos testes: `FakeProvider` determinístico.

## Por que Ollama (e não API paga)

- **Grátis** e **local**: nenhuma pergunta do cliente sai da máquina (bom para LGPD).
- A RTX 4080 roda o `llama3.1:8b` com folga; resposta em segundos.
- Mesma API HTTP em qualquer SO; fácil de trocar depois.
- Limitação: modelo de 8B é menos capaz que modelos grandes → compensamos com FAQ pronta, RAG com
  limiar de confiança e guardas determinísticas.

## Consequências

- ✅ Trocar de modelo = mudar variável de ambiente.
- ✅ Testes do CI não dependem de GPU nem de rede (usam o fake).
- ⚠️ A dimensão do embedding fica fixa no schema (768 do `nomic-embed-text`); trocar de modelo de
  embedding exige reprocessar a base.
