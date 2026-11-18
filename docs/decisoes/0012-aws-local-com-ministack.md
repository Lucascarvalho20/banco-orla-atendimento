# 0012 — Serviços AWS rodando localmente com MiniStack

**Status:** aceito

## Contexto

As vagas que o Lucas mira pedem Lambda, S3, CloudWatch, SQS/SNS/EventBridge. O projeto precisa
mostrar isso funcionando **sem conta AWS paga** e com um comando (`docker compose up`).

## Opções

1. **AWS real (free tier)** — exige cartão, risco de cobrança, e quem clonar precisa de conta.
2. **LocalStack** — o mais conhecido, mas desde 23/03/2026 exige conta + _auth token_ até no plano
   gratuito (uso não comercial). Quem clonar o projeto também precisaria.
3. **Floci** (MIT) — muitos serviços, mas a Lambda exige montar `/var/run/docker.sock` no container,
   o que dá a ele controle total do Docker da máquina (risco de segurança).
4. **MiniStack** (MIT) — sem conta nem token; S3, SQS, SNS, EventBridge, Lambda (Node via
   subprocesso, **sem** `docker.sock`), CloudWatch Logs/Metrics; porta 4566.
5. Ferramentas oficiais por serviço (DynamoDB Local, SAM CLI...) — várias peças para instalar.

## Decisão

MiniStack, com **versão fixada** no `docker-compose.yml` e escutando só em `127.0.0.1`. O código usa
o **AWS SDK v3 oficial**; o endereço vem de `AWS_ENDPOINT_URL`.

## Consequências

- ✅ `docker compose up` e tudo funciona; nenhuma credencial real.
- ✅ Trocar para a AWS real = remover `AWS_ENDPOINT_URL` e usar credenciais/IAM reais.
- ⚠️ Projeto novo, comunidade pequena: emulador ≠ AWS (IAM não é aplicado de verdade, por exemplo).
  Documentamos as diferenças no estudo e não confiamos no emulador para testar permissões.
- ⚠️ Imagem de terceiro: fixar versão e revisar antes de atualizar (mesma regra das skills).
