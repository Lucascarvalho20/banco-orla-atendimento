# 0006 — pgvector + busca híbrida (vs. banco vetorial dedicado)

**Status:** aceito

## Contexto

O RAG precisa achar os trechos certos da base. Perguntas de banco têm termos exatos ("MED",
"limite noturno", "TED", "R$ 1.000") e também paráfrases ("meu dinheiro não chegou" = Pix não caiu).

## Opções

1. Só busca vetorial — entende sinônimos, mas erra termos exatos e siglas.
2. Só busca textual (`tsvector`) — acerta termos exatos, erra paráfrases.
3. **Híbrida** no mesmo Postgres: `pgvector` (cosseno, índice HNSW) + `tsvector` em português (GIN),
   combinadas por **Reciprocal Rank Fusion (RRF)**.
4. Banco vetorial dedicado (Pinecone, Qdrant) — mais um serviço, custo, e sincronização com o Postgres.

## Decisão

Híbrida com RRF no próprio Postgres. Top 5 trechos. Filtro `status = 'publicado'` na query.

## Consequências

- ✅ Um banco só; filtros e permissões (`ai_reader`) em SQL.
- ✅ RRF não precisa calibrar escalas diferentes de score (usa só a posição no ranking).
- ⚠️ Para milhões de trechos, um banco dedicado pode ganhar em latência — não é o nosso caso
  (dezenas de documentos).
- 📏 Medido na Etapa 6 (`pnpm eval:busca`, 24 perguntas): vetor e híbrida empataram (Recall@5 1,00;
  MRR 0,87 e 0,86); só texto ficou em Recall@5 0,92 e MRR 0,74. Com 29 trechos, a busca por texto
  não acrescentou acertos; mantivemos a híbrida como rede de segurança para siglas e números
  exatos, que aparecem mais conforme a base cresce.
