// Cria (ou atualiza) toda a ingestão na AWS local. Pode rodar quantas vezes quiser.
//   S3 (orla-kb) --evento--> SQS (orla-ingestao) --lote--> Lambda --> pgvector
//                                  └─ 3 falhas --> SQS (orla-ingestao-dlq)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  GetFunctionCommand,
  ListEventSourceMappingsCommand,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketNotificationConfigurationCommand,
} from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { databaseUrlForRole } from '@orla/db';
import { DLQ, env, FUNCTION, lambda, log, QUEUE, repoPath, s3, sqs } from './aws.js';

const LAMBDA_TIMEOUT_S = 30;
// A AWS recomenda visibilidade ≥ 6× o timeout da Lambda: senão a mensagem "reaparece" na fila
// enquanto a primeira execução ainda está rodando, e é processada duas vezes.
const VISIBILITY_S = Number(process.env.INGEST_VISIBILITY_SECONDS ?? LAMBDA_TIMEOUT_S * 6);
const MAX_RECEIVE = 3;

async function queueArn(url: string) {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }),
  );
  return Attributes!.QueueArn!;
}

// 1. Bucket
try {
  await s3.send(new HeadBucketCommand({ Bucket: env.KB_BUCKET }));
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: env.KB_BUCKET }));
}
log(`✓ bucket s3://${env.KB_BUCKET}`);

// 2. Filas: DLQ primeiro (a principal aponta para ela)
const dlq = await sqs.send(
  new CreateQueueCommand({
    QueueName: DLQ,
    Attributes: { MessageRetentionPeriod: String(14 * 24 * 3600) },
  }),
);
const dlqArn = await queueArn(dlq.QueueUrl!);
const main = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE }));
const mainArn = await queueArn(main.QueueUrl!);
await sqs.send(
  new SetQueueAttributesCommand({
    QueueUrl: main.QueueUrl!,
    Attributes: {
      VisibilityTimeout: String(VISIBILITY_S),
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: MAX_RECEIVE }),
      // Só o S3, e só deste bucket, pode mandar mensagem para a fila (na AWS real é obrigatório).
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 's3.amazonaws.com' },
            Action: 'sqs:SendMessage',
            Resource: mainArn,
            Condition: { ArnEquals: { 'aws:SourceArn': `arn:aws:s3:::${env.KB_BUCKET}` } },
          },
        ],
      }),
    },
  }),
);
log(`✓ fila ${QUEUE} (visibilidade ${VISIBILITY_S}s, ${MAX_RECEIVE} tentativas) → DLQ ${DLQ}`);

// 3. Evento do S3 → fila: só arquivos .md dentro de docs/
await s3.send(
  new PutBucketNotificationConfigurationCommand({
    Bucket: env.KB_BUCKET,
    NotificationConfiguration: {
      QueueConfigurations: [
        {
          QueueArn: mainArn,
          Events: ['s3:ObjectCreated:*'],
          Filter: {
            Key: {
              FilterRules: [
                { Name: 'prefix', Value: 'docs/' },
                { Name: 'suffix', Value: '.md' },
              ],
            },
          },
        },
      ],
    },
  }),
);
log('✓ notificação: s3:ObjectCreated (docs/*.md) → fila');

// 4. Lambda
execFileSync(process.execPath, [repoPath('apps/ingest/scripts/build-lambda.mjs')], {
  stdio: 'inherit',
});
const zip = readFileSync(repoPath('apps/ingest/dist/function.zip'));
const lambdaEnv = {
  KB_BUCKET: env.KB_BUCKET,
  // Dentro do Docker: "postgres" é o nome do serviço no docker-compose.
  KB_WRITER_DATABASE_URL: databaseUrlForRole(
    env.DATABASE_URL,
    'kb_writer',
    env.KB_WRITER_PASSWORD,
    'postgres:5432',
  ),
  // Ollama roda no Windows (GPU); de dentro do container, a máquina é host.docker.internal.
  OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
  OLLAMA_EMBED_MODEL: env.OLLAMA_EMBED_MODEL,
  AWS_ENDPOINT_URL: 'http://localhost:4566',
};
const config = {
  FunctionName: FUNCTION,
  Runtime: 'nodejs22.x' as const,
  Handler: 'index.handler',
  Timeout: LAMBDA_TIMEOUT_S,
  MemorySize: 256,
  Environment: { Variables: lambdaEnv },
};

let exists = true;
try {
  await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION }));
} catch (error) {
  if (!(error instanceof ResourceNotFoundException)) throw error;
  exists = false;
}
if (exists) {
  await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: FUNCTION, ZipFile: zip }));
  await lambda.send(new UpdateFunctionConfigurationCommand(config));
} else {
  await lambda.send(
    new CreateFunctionCommand({
      ...config,
      // Papel (IAM) com o mínimo: ler deste bucket e consumir desta fila. O emulador não aplica
      // IAM; a política equivalente para a AWS real está no estudo 05 e virá no Terraform.
      Role: 'arn:aws:iam::000000000000:role/orla-ingestao-lambda',
      Code: { ZipFile: zip },
    }),
  );
}
log(`✓ Lambda ${FUNCTION} (${config.Runtime}, timeout ${LAMBDA_TIMEOUT_S}s)`);

// 5. Fila → Lambda (em lotes, com falha parcial)
const { EventSourceMappings = [] } = await lambda.send(
  new ListEventSourceMappingsCommand({ FunctionName: FUNCTION, EventSourceArn: mainArn }),
);
if (EventSourceMappings.length === 0) {
  await lambda.send(
    new CreateEventSourceMappingCommand({
      FunctionName: FUNCTION,
      EventSourceArn: mainArn,
      BatchSize: 5,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      // No máximo 2 Lambdas ao mesmo tempo: 2 × pool de 2 conexões ≤ limite do kb_writer (5).
      ScalingConfig: { MaximumConcurrency: 2 },
    }),
  );
}
log('✓ mapeamento fila → Lambda (lotes de 5, falha parcial, no máximo 2 em paralelo)');
log('\nPronto. Envie os documentos com: pnpm kb:upload');
