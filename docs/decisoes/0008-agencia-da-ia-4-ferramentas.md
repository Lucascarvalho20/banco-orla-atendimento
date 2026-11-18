# 0008 — Agência da IA: 4 ferramentas fixas e autorização no código

**Status:** aceito (as ferramentas entram na V2; na V1 a IA não chama ferramenta nenhuma)

## Contexto

Num banco, o pior cenário é a IA **agir**: fazer Pix, mostrar saldo de outra pessoa, desbloquear
cartão. Pedir ao modelo "não faça isso" não é uma barreira — injeção de prompt contorna.

## Decisão

A IA só pode chamar estas funções do nosso servidor, com argumentos validados por Zod:

| Ferramenta                           | O que faz                                       | Por que é segura                                  |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------- |
| `buscar_base(pergunta)`              | Busca híbrida na base                           | Lê só `kb_*` (públicas) com o usuário `ai_reader` |
| `simular_limite_pix(valor, horario)` | Diz se o valor cabe no limite padrão do horário | Regra fixa em código; não lê conta nenhuma        |
| `status_da_fila()`                   | Posição e tempo estimado da sessão atual        | ID da sessão vem do servidor, nunca do LLM        |
| `chamar_atendente(resumo, assunto)`  | Coloca a **própria** conversa na fila           | Só muda o estado da própria conversa              |

**Não existem** ferramentas de saldo, extrato, transferência, cartão, SQL, usuários, admin, e-mail ou
internet. A IA não consegue fazer o que nenhuma ferramenta faz. Máximo de 4 passos por pergunta.

## Consequências

- ✅ "Faça um Pix para mim" é impossível por construção, não por obediência do modelo.
- ✅ Testes de ataque verificam que nenhuma ferramenta fora da lista é chamada.
- ⚠️ A IA não resolve casos que exigem a conta do cliente → vão para o atendente humano (é o correto).
