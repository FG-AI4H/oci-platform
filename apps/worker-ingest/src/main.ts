import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'eu-central-1' });
const QUEUE_URL = process.env.SQS_INGEST_QUEUE_URL;

async function processMessage(body: string) {
  // TODO Phase B: parse Croissant manifest, validate via @oci/croissant,
  //   write to Postgres via @oci/database, refresh Glue catalog.
  logger.info({ size: body.length }, 'received-message');
}

async function poll() {
  if (!QUEUE_URL) throw new Error('SQS_INGEST_QUEUE_URL not set');
  for (;;) {
    const out = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 60,
      }),
    );
    for (const msg of out.Messages ?? []) {
      try {
        await processMessage(msg.Body ?? '');
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle! }),
        );
      } catch (err) {
        logger.error({ err }, 'message-processing-failed');
      }
    }
  }
}

poll().catch((err) => {
  logger.fatal({ err }, 'worker-fatal');
  process.exit(1);
});
