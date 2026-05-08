import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccessRequestRepository } from '../access-request/access-request.repository.js';
import { EmailNotifier } from './email-notifier.js';

export const EMAIL_NOTIFIER = Symbol('EmailNotifier');

/**
 * Renewal cron service (#130, ADR-0003 Phase 2).
 *
 * Runs daily — see `RenewalScheduler`. Two responsibilities:
 *   1. **Pre-expiry notice** — email APPROVED rows whose `expiresAt`
 *      is within 30 days. De-duped on `expiryNoticeSentAt` so the
 *      daily cron doesn't spam.
 *   2. **Auto-revoke** — flip APPROVED → REVOKED on rows whose
 *      `expiresAt` has already passed. Audit-noted as system-driven.
 *
 * The window is configurable via `OCI_RENEWAL_NOTICE_DAYS` (default 30).
 * Validity itself is set on the APPROVED transition in the access-request
 * repo (`OCI_ACCESS_GRANT_VALIDITY_DAYS`, default 365).
 *
 * Today the email surface is a log-only stub (`LogEmailNotifier`); when
 * SES lands the `EmailNotifier` token gets re-bound and this code runs
 * unchanged.
 */
@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(
    @Inject(AccessRequestRepository) private readonly repo: AccessRequestRepository,
    @Inject(EMAIL_NOTIFIER) private readonly notifier: EmailNotifier,
  ) {}

  /**
   * One pass of the cron — meant to be called by the scheduler. Idempotent
   * over a single day (the de-dup guard is `expiryNoticeSentAt`).
   */
  async runOnce(): Promise<{
    noticesSent: number;
    autoRevoked: number;
    errors: number;
  }> {
    const noticeDays = Number(process.env.OCI_RENEWAL_NOTICE_DAYS ?? '30');
    let noticesSent = 0;
    let autoRevoked = 0;
    let errors = 0;

    // Pre-expiry notices.
    const upcoming = await this.repo.findApprovedNearExpiry({ withinDays: noticeDays });
    this.logger.log(`renewal: ${upcoming.length} APPROVED rows within ${noticeDays}d of expiry`);
    for (const row of upcoming) {
      try {
        await this.notifier.send({
          // We don't yet have a User-table email lookup wired (see
          // identity-context.ts). Stub with the requester id; the real
          // SES integration will resolve to address.
          to: `requester:${row.requesterId}`,
          subject: 'Your OCI Platform access expires in 30 days',
          body: this.buildNoticeBody(row),
          metadata: {
            accessRequestId: row.id,
            datasetId: row.datasetId,
            expiresAt: row.expiresAt.toISOString(),
            kind: 'renewal-notice',
          },
        });
        await this.repo.markExpiryNoticeSent(row.id);
        noticesSent += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(
          `renewal: failed to notify ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Auto-revoke.
    const expired = await this.repo.findExpired();
    this.logger.log(`renewal: ${expired.length} APPROVED rows past expiry — auto-revoking`);
    for (const row of expired) {
      try {
        await this.repo.autoRevokeExpired(row.id);
        // Best-effort: tell the requester we revoked.
        await this.notifier.send({
          to: `requester:${row.requesterId}`,
          subject: 'Your OCI Platform access has expired',
          body: this.buildRevokedBody(row),
          metadata: {
            accessRequestId: row.id,
            datasetId: row.datasetId,
            expiresAt: row.expiresAt.toISOString(),
            kind: 'auto-revoke-notice',
          },
        });
        autoRevoked += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(
          `renewal: failed to auto-revoke ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `renewal: pass complete — noticesSent=${noticesSent} autoRevoked=${autoRevoked} errors=${errors}`,
    );
    return { noticesSent, autoRevoked, errors };
  }

  private buildNoticeBody(row: { id: string; datasetId: string; expiresAt: Date }): string {
    return [
      'Your access to a dataset on the OCI Platform expires in 30 days.',
      '',
      `Access request: ${row.id}`,
      `Dataset: ${row.datasetId}`,
      `Expires: ${row.expiresAt.toISOString()}`,
      '',
      'To extend, sign in and review the request — you will be prompted to update your Intended Data Use statement.',
      'If you no longer need access, no action is required; the grant will auto-revoke on the expiry date.',
    ].join('\n');
  }

  private buildRevokedBody(row: { id: string; datasetId: string; expiresAt: Date }): string {
    return [
      'Your access to a dataset on the OCI Platform has been auto-revoked because the validity window expired.',
      '',
      `Access request: ${row.id}`,
      `Dataset: ${row.datasetId}`,
      `Expired: ${row.expiresAt.toISOString()}`,
      '',
      'You can file a fresh request at any time.',
    ].join('\n');
  }
}
