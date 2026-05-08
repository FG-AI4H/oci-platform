import { Logger } from '@nestjs/common';

/**
 * Email notification surface (#130). Today the platform doesn't yet have
 * a wired SMTP / SES integration, so every notifier writes to the
 * structured log instead of the actual outbox. A regulator-tier audit
 * needs the *intent* to be auditable; the wire is queued separately
 * (see `for-operators/email.md` — TODO when SES lands).
 *
 * Two implementations:
 *   - `LogEmailNotifier` (default) — pino-friendly structured warn+info.
 *     Unblocks the renewal cron without bringing SES into PR #130.
 *   - Future: `SesEmailNotifier` once an SES verified-domain CDK
 *     construct lands. The `EmailNotifier` interface is the seam.
 */

export interface EmailNotificationInput {
  to: string;
  subject: string;
  body: string;
  /** Free-form metadata for audit / observability. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface EmailNotifier {
  send(input: EmailNotificationInput): Promise<{ delivered: boolean; messageId: string | null }>;
}

/**
 * Stub notifier. Logs every send at INFO with the metadata bag, returns
 * a fake message id. The renewal cron's audit log records the result so
 * stamping `expiryNoticeSentAt` is meaningful even before real SES.
 */
export class LogEmailNotifier implements EmailNotifier {
  private readonly logger = new Logger('LogEmailNotifier');

  async send(
    input: EmailNotificationInput,
  ): Promise<{ delivered: boolean; messageId: string | null }> {
    this.logger.log(
      `email-stub to=${input.to} subject="${input.subject.slice(0, 80)}" metadata=${JSON.stringify(
        input.metadata ?? {},
      )}`,
    );
    // Body is logged at DEBUG to keep INFO scannable.
    this.logger.debug(`email-body:\n${input.body}`);
    return { delivered: true, messageId: `log-stub:${Date.now()}` };
  }
}
