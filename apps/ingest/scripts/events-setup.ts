/**
 * Cria EventBridge bus + regra → SNS (e fila de auditoria) no MiniStack.
 *   pnpm kb:events
 */
import {
  CreateEventBusCommand,
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
} from '@aws-sdk/client-eventbridge';
import { CreateTopicCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { env, log, sqs } from './aws.js';

const BUS = 'orla';
const TOPIC = 'orla-eventos';
const AUDIT_QUEUE = 'orla-eventos-audit';

const common = {
  endpoint: env.AWS_ENDPOINT_URL,
  region: env.AWS_REGION,
  // Chaves fixas do emulador (iguais ao .env.example) — nunca AWS real.
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
};

const eb = new EventBridgeClient(common);
const sns = new SNSClient(common);

try {
  await eb.send(new CreateEventBusCommand({ Name: BUS }));
} catch {
  // já existe
}
log(`✓ event bus ${BUS}`);

const topic = await sns.send(new CreateTopicCommand({ Name: TOPIC }));
const topicArn = topic.TopicArn!;
log(`✓ sns ${topicArn}`);

const queue = await sqs.send(new CreateQueueCommand({ QueueName: AUDIT_QUEUE }));
const qAttrs = await sqs.send(
  new GetQueueAttributesCommand({
    QueueUrl: queue.QueueUrl!,
    AttributeNames: ['QueueArn'],
  }),
);
const queueArn = qAttrs.Attributes!.QueueArn!;
await sns.send(
  new SubscribeCommand({
    TopicArn: topicArn,
    Protocol: 'sqs',
    Endpoint: queueArn,
  }),
);
log(`✓ sns → sqs ${AUDIT_QUEUE}`);

try {
  await eb.send(
    new PutRuleCommand({
      Name: 'orla-all-events',
      EventBusName: BUS,
      EventPattern: JSON.stringify({ source: ['orla.atendimento'] }),
      State: 'ENABLED',
    }),
  );
  await eb.send(
    new PutTargetsCommand({
      Rule: 'orla-all-events',
      EventBusName: BUS,
      Targets: [{ Id: 'sns', Arn: topicArn }],
    }),
  );
  log('✓ regra EventBridge → SNS');
} catch (error) {
  log(
    `! regra EventBridge parcial no emulador (${error instanceof Error ? error.message : 'erro'}); SNS ainda serve para publish direto`,
  );
}

log(`Exporte no .env: SNS_TOPIC_ARN=${topicArn}`);
