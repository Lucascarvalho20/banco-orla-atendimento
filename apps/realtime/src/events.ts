import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

export type OrlaDomainEvent =
  | {
      type: 'conversation.queued';
      conversationId: string;
      position: number;
      at: string;
    }
  | {
      type: 'conversation.accepted';
      conversationId: string;
      agentId: string;
      at: string;
    }
  | {
      type: 'conversation.closed';
      conversationId: string;
      agentId: string | null;
      at: string;
    };

export interface EventPublisher {
  publish(event: OrlaDomainEvent): Promise<void>;
}

/** No-op quando EventBridge/SNS não estão configurados (V1 / CI). */
export const noopEventPublisher: EventPublisher = {
  async publish() {},
};

/**
 * Publica no EventBridge (bus orla) e espelha no SNS (tópico orla-eventos).
 * Endpoint = MiniStack local (ADR 0012). Sem credenciais reais.
 */
export function createAwsEventPublisher(opts: {
  endpoint: string;
  region: string;
  eventBusName: string;
  snsTopicArn: string;
}): EventPublisher {
  const common = {
    endpoint: opts.endpoint,
    region: opts.region,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
  const eb = new EventBridgeClient(common);
  const sns = new SNSClient(common);

  return {
    async publish(event) {
      const detail = JSON.stringify(event);
      await eb.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: opts.eventBusName,
              Source: 'orla.atendimento',
              DetailType: event.type,
              Detail: detail,
            },
          ],
        }),
      );
      await sns.send(
        new PublishCommand({
          TopicArn: opts.snsTopicArn,
          Message: detail,
          Subject: event.type,
        }),
      );
    },
  };
}
