# 0011 — TypeScript 6 em vez do 7

**Status:** aceito (revisar quando o typescript-eslint suportar o TS 7)

## Contexto

Ao instalar "a última versão", veio o **TypeScript 7**, o compilador reescrito em Go (muito mais
rápido). O `typescript-eslint` 8 falhou: `typescript-eslint does not support TS 7.0`, porque ele
depende da API JavaScript do compilador, que o TS 7 não expõe do mesmo jeito.

## Opções

1. TS 7 sem lint com tipos — perde regras importantes.
2. TS 7 para `tsc` e TS 6 lado a lado para o ESLint — funciona, mas dois compiladores confundem.
3. **Fixar TS 6** (`^6`) até o ecossistema acompanhar.

## Decisão

`typescript@^6`. Dependabot ignora atualização de versão principal do TypeScript.

## Consequências

- ✅ Lint, Next.js e Vitest funcionando.
- ⚠️ Perdemos a velocidade do TS 7 (irrelevante neste tamanho de projeto).
- 📚 Lição: "última versão" ≠ "versão compatível". Em projeto real, fixe versões e atualize com teste.
