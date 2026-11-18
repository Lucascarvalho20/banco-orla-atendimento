# 0005 — Sessão anônima com CPF em HMAC (LGPD)

**Status:** aceito

## Contexto

O cliente entra só com nome + CPF, sem senha. CPF é dado pessoal (LGPD): precisamos reconhecer a
mesma pessoa (limite de uso, histórico) sem guardar o CPF.

## Opções

1. Guardar o CPF em texto — vazamento = dano direto. ❌
2. `SHA-256(cpf)` — **inseguro**: só existem ~10⁹ CPFs válidos; dá para gerar todos e reverter o hash
   em minutos (ataque de dicionário).
3. **HMAC-SHA256(cpf, segredo)** — sem o segredo, não dá para montar o dicionário.
4. Criptografia reversível (AES) — só se precisássemos ler o CPF de volta; não precisamos.

## Decisão

`cpf_hash = HMAC-SHA256(cpf_normalizado, CPF_HMAC_SECRET)` + `cpf_last2` para exibição. Sessão é um
token assinado de curta duração (30 min). O CPF nunca vai para log, URL nem para a IA.

## Consequências

- ✅ Vazamento do banco sem o segredo não expõe CPFs.
- ⚠️ Perder/rotacionar o segredo quebra o reconhecimento de sessões antigas (aceitável: são curtas).
- ⚠️ Projeto fictício: validamos só os dígitos verificadores, não consultamos a Receita.
