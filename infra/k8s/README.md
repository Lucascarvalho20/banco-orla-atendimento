# Kubernetes local (kind) — Etapa 12

Manifestos mínimos para subir o **realtime** + **web** apontando para Postgres/Mongo
no host (ou em outro namespace). Não substitui o `docker compose` do dia a dia.

## Pré-requisitos

- [kind](https://kind.sigs.k8s.io/) + kubectl
- Imagens locais buildadas (ex.: `orla-web:dev`, `orla-realtime:dev`)

## Cluster

```bash
kind create cluster --name orla
# carregar imagens no kind (exemplo):
# kind load docker-image orla-web:dev --name orla
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f realtime.yaml
kubectl apply -f web.yaml
kubectl -n orla get pods
```

Os segredos **não** vão no Git: crie um Secret local:

```bash
kubectl -n orla create secret generic orla-secrets \
  --from-literal=DATABASE_URL='postgres://...' \
  --from-literal=SESSION_SECRET='...' \
  --from-literal=CPF_HMAC_SECRET='...' \
  --from-literal=AI_READER_PASSWORD='...'
```

## Por que kind e não EKS?

Demo de entrevista / lab: mesmo YAML, outro destino. Em produção trocaria o endpoint
do banco e o Ingress; o processo de deploy fica igual.
