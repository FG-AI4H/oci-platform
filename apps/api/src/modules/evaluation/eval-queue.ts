import { Injectable, Logger } from '@nestjs/common';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SealedRunMessageSchema, type SealedRunMessage } from '@oci/shared-types';
import { resolveSealedRunTimeoutSec, sealedRunCallbackUrl } from './sealed-run.js';

/**
 * Publisher for `oci-eval-submissions-{env}` — the one cross-service boundary
 * of the evaluation surface (SQS; BullMQ stays in-process, CLAUDE.md rule 9 /
 * ADR-0017).
 *
 * Configuration (WP2 wires all of it onto the API task definition):
 *   - `OCI_EVAL_QUEUE_URL`        the queue to publish to. **Unset disables the
 *                                 CONTAINER path**: `missingConfig()` is
 *                                 non-empty and the service answers 503 at
 *                                 request time rather than enqueueing into the
 *                                 void.
 *   - `OCI_API_URL`               absolute base URL of this API, used to build
 *                                 the worker's outbox `callbackUrl`. Same name
 *                                 the worker uses for the same value
 *                                 (`apps/worker-eval/README.md`).
 *   - `OCI_EVAL_RUN_TIMEOUT_SEC`  optional override of the run timeout, which
 *                                 must stay below the queue's visibility
 *                                 timeout (contract §2).
 *   - `SQS_ENDPOINT`              localstack, mirroring `S3_ENDPOINT` in the
 *                                 storage module's client.
 *
 * Shaped like `S3ClientProvider`: a thin, injectable wrapper that resolves its
 * mode once at boot so the service layer never reads `process.env`.
 */
@Injectable()
export class EvalQueueProvider {
  private readonly logger = new Logger(EvalQueueProvider.name);

  private readonly client: SQSClient | undefined;
  public readonly queueUrl: string | undefined;
  public readonly apiBaseUrl: string | undefined;
  /** Hard wall-clock cap dispatched with every sealed run, in seconds. */
  public readonly runTimeoutSec: number;

  constructor() {
    const region = process.env.AWS_REGION ?? 'eu-central-1';
    const endpoint = process.env.SQS_ENDPOINT;
    this.queueUrl = emptyToUndefined(process.env.OCI_EVAL_QUEUE_URL);
    this.apiBaseUrl = emptyToUndefined(process.env.OCI_API_URL);
    this.runTimeoutSec = resolveSealedRunTimeoutSec(process.env.OCI_EVAL_RUN_TIMEOUT_SEC);

    if (!this.queueUrl) {
      // Not an error: dev environments that only exercise Mode 1 run without
      // a queue. The CONTAINER path refuses loudly per request instead.
      this.client = undefined;
      this.logger.warn(
        'OCI_EVAL_QUEUE_URL not set — sealed-container submissions (Mode 2) will be refused with 503',
      );
      return;
    }

    if (endpoint) {
      // localstack. Static credentials so signing matches its expectations.
      this.client = new SQSClient({
        endpoint,
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        },
      });
      this.logger.warn(`SQS client targeting ${endpoint} (dev) — queue ${this.queueUrl}`);
    } else {
      // Real AWS — region only; credentials come from the Fargate task role.
      this.client = new SQSClient({ region });
      this.logger.log(`SQS client targeting AWS in ${region} — queue ${this.queueUrl}`);
    }
  }

  /**
   * Names of the env vars the CONTAINER path needs and does not have. Empty
   * means dispatch is possible. The service turns a non-empty list into a 503
   * naming the gap — a submission must never be accepted with no way to reach a
   * worker.
   */
  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.queueUrl || !this.client) missing.push('OCI_EVAL_QUEUE_URL');
    if (!this.apiBaseUrl) missing.push('OCI_API_URL');
    return missing;
  }

  /** Absolute outbox URL the worker POSTs its result to. */
  callbackUrlFor(submissionId: string): string {
    if (!this.apiBaseUrl) {
      throw new Error('OCI_API_URL is not configured; cannot build a sealed-run callback URL');
    }
    return sealedRunCallbackUrl(this.apiBaseUrl, submissionId);
  }

  /**
   * Validate against the wire contract, then publish. Validating our own
   * message before it leaves is cheap insurance against the worker's Pydantic
   * mirror rejecting it after a redrive — drift between the two is the likeliest
   * source of a silently skipped control (contract §2).
   */
  async publish(message: SealedRunMessage): Promise<void> {
    const parsed = SealedRunMessageSchema.parse(message);
    if (!this.client || !this.queueUrl) {
      throw new Error('OCI_EVAL_QUEUE_URL is not configured; cannot publish a sealed run');
    }
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(parsed),
      }),
    );
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
