import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CreateDuaSigningRequest,
  CreateDuaSigningRequestResponse,
  DocusealWebhookEvent,
  DuaSignatureStatus,
  DuaSignatureSummary,
  ListDuaSignaturesResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { AccessRequestRepository } from '../access-request/access-request.repository.js';
import { DuaTemplateService } from '../dua-template/dua-template.service.js';
import { PassportIssuerService } from '../passport-issuer/passport-issuer.service.js';
import { DocusealClient } from './docuseal-client.js';
import { DuaSigningRepository, type DuaSignatureRow } from './dua-signing.repository.js';

/**
 * AdES DUA signing service (#128, ADR-0003 Decision 5).
 *
 * Three responsibilities:
 *   1. Mint a DocuSeal signing envelope for an approved AR — render
 *      the DUA via the template engine, hash it, push to DocuSeal,
 *      persist the row.
 *   2. Read state — caller's own signatures + admin lookups.
 *   3. Handle the DocuSeal completion webhook — stamp `SIGNED`, mint
 *      an `AcceptedTermsAndPolicies` GA4GH visa pointing at the
 *      signed PDF URL.
 *
 * The client is constructed from env at boot. When unset, signing
 * endpoints return 503 ("DocuSeal not configured"); webhook returns
 * 503 too (a malicious external call to the webhook with no client
 * configured can't even pass HMAC validation since there's no
 * secret to validate against).
 */
@Injectable()
export class DuaSigningService {
  private readonly logger = new Logger(DuaSigningService.name);
  private readonly client: DocusealClient | null;

  constructor(
    @Inject(DuaSigningRepository) private readonly repo: DuaSigningRepository,
    @Inject(AccessRequestRepository) private readonly arRepo: AccessRequestRepository,
    @Inject(DuaTemplateService) private readonly template: DuaTemplateService,
    @Inject(PassportIssuerService) private readonly passportIssuer: PassportIssuerService,
  ) {
    this.client = DocusealClient.fromEnv();
    if (!this.client) {
      this.logger.warn(
        'DocuSeal not configured — set OCI_DOCUSEAL_BASE_URL + OCI_DOCUSEAL_API_TOKEN + OCI_DOCUSEAL_WEBHOOK_SECRET to enable AdES DUA signing.',
      );
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async createSigningRequest(
    body: CreateDuaSigningRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<CreateDuaSigningRequestResponse> {
    requireUser(user);
    if (!this.client) {
      throw new ServiceUnavailableException('DocuSeal not configured on this deployment.');
    }
    const ar = await this.arRepo.findByIdWithDataset(body.accessRequestId);
    if (!ar) throw new NotFoundException(`access request "${body.accessRequestId}" not found`);

    const callerId = subToUuid(user.sub);
    const isRequester = ar.requesterId === callerId;
    const isHost = ar.dataset.hostId === callerId;
    const isAdmin = ((user['cognito:groups'] ?? []) as string[]).includes('admin');
    if (!isRequester && !isHost && !isAdmin) {
      throw new ForbiddenException(
        'only the requester, host, or an admin can start a DUA signing request',
      );
    }
    if (ar.status !== 'APPROVED') {
      throw new BadRequestException(
        `access request "${body.accessRequestId}" must be APPROVED before signing — current status: ${ar.status}`,
      );
    }

    const existing = await this.repo.findPendingForAccessRequest(body.accessRequestId);
    if (existing) {
      // Idempotent — return the in-flight envelope. Re-rendering and
      // re-pushing to DocuSeal would invalidate the signer URL the
      // requester may already be on.
      this.logger.log(
        `Reusing in-flight DUA signing request ${existing.id} for AR ${body.accessRequestId}`,
      );
      return { signature: toSummary(existing) };
    }

    const intendedUse =
      ar.attestations?.projectDescription ??
      ar.justification ??
      'See access-request justification.';
    const preview = await this.template.preview({
      datasetSlug: ar.dataset.slug,
      audience: body.audience,
      intendedUse,
      requesterName: body.signerName,
      requesterInstitution: ar.attestations?.institution,
    });
    const documentSha256 = createHash('sha256').update(preview.markdown, 'utf8').digest('hex');

    let submissionId: string | null = null;
    let signerUrl: string | null = null;
    try {
      const result = await this.client.createSubmission({
        name: `DUA — ${ar.dataset.slug} — ${body.accessRequestId}`,
        bodyMarkdown: preview.markdown,
        signerEmail: body.signerEmail,
        signerName: body.signerName,
      });
      submissionId = result.id;
      signerUrl = result.signerUrl;
    } catch (err) {
      this.logger.error(
        `DocuSeal createSubmission failed for AR ${body.accessRequestId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException(
        'DocuSeal signing envelope could not be created. The DUA was not persisted; retry once the issuer is reachable.',
      );
    }

    const row = await this.repo.create({
      userId: ar.requesterId,
      accessRequestId: body.accessRequestId,
      documentText: preview.markdown,
      documentSha256,
      docusealSubmissionId: submissionId,
      signerUrl,
    });
    return { signature: toSummary(row) };
  }

  async listMine(user: CognitoAccessTokenPayload): Promise<ListDuaSignaturesResponse> {
    requireUser(user);
    const rows = await this.repo.listForUser(subToUuid(user.sub));
    return { items: rows.map(toSummary) };
  }

  async getMine(user: CognitoAccessTokenPayload, id: string): Promise<DuaSignatureSummary> {
    requireUser(user);
    const row = await this.repo.findForUser(subToUuid(user.sub), id);
    if (!row) throw new NotFoundException('DUA signature not found.');
    return toSummary(row);
  }

  /**
   * DocuSeal webhook handler. The controller has already validated
   * the HMAC; this method trusts the parsed event and reconciles
   * platform state.
   *
   * On `form.completed`:
   *   - Mark row SIGNED, stamp the PDF URL.
   *   - Mint an `AcceptedTermsAndPolicies` GA4GH visa pointing at the
   *     signed PDF URL (best-effort; failure logged, doesn't block).
   *
   * On `form.declined` / `form.expired`:
   *   - Mark row with the matching status. No visa mint.
   *
   * Unknown event types are no-ops (returns 200 so DocuSeal doesn't
   * retry forever).
   */
  async handleWebhook(event: DocusealWebhookEvent): Promise<{ acknowledged: boolean }> {
    const submissionId = String(event.data.id);
    const row = await this.repo.findBySubmissionId(submissionId);
    if (!row) {
      this.logger.warn(
        `DocuSeal webhook for unknown submission ${submissionId} (${event.event_type}) — ignoring.`,
      );
      return { acknowledged: true };
    }
    if (row.status !== 'PENDING') {
      this.logger.log(
        `DocuSeal webhook for ${submissionId} (${event.event_type}) — already in status ${row.status}, ignoring.`,
      );
      return { acknowledged: true };
    }

    switch (event.event_type) {
      case 'form.completed':
      case 'submission.completed': {
        const pdfUrl = event.data.documents?.find((d) => d.url)?.url ?? null;
        const signed = await this.repo.markSigned(row.id, pdfUrl);
        // Mint visa — best-effort.
        try {
          await this.passportIssuer.issueVisa({
            userId: signed.userId,
            visaType: 'AcceptedTermsAndPolicies',
            value: pdfUrl ?? `dua://${signed.id}`,
            source: process.env.OCI_PASSPORT_ISSUER_URL ?? 'https://oci.ai4h.net',
            validForDays: 365 * 5,
            contextType: 'dua_signature',
            contextRef: signed.id,
          });
        } catch (err) {
          this.logger.warn(
            `Visa mint after DUA sign failed for ${signed.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        this.logger.log(`DUA signature ${signed.id} marked SIGNED.`);
        return { acknowledged: true };
      }
      case 'form.declined':
      case 'submission.declined': {
        await this.repo.markDeclined(row.id);
        return { acknowledged: true };
      }
      case 'form.expired':
      case 'submission.expired': {
        await this.repo.markExpired(row.id);
        return { acknowledged: true };
      }
      default:
        this.logger.log(`DocuSeal webhook event ${event.event_type} — no handler, ignoring.`);
        return { acknowledged: true };
    }
  }
}

function requireUser(user: CognitoAccessTokenPayload | undefined): void {
  if (!user?.sub) throw new ForbiddenException('authentication required');
}

function toSummary(row: DuaSignatureRow): DuaSignatureSummary {
  return {
    id: row.id,
    accessRequestId: row.accessRequestId,
    status: row.status as DuaSignatureStatus,
    documentSha256: row.documentSha256,
    signerUrl: row.signerUrl,
    signedPdfUrl: row.signedPdfUrl,
    createdAt: row.createdAt.toISOString(),
    signedAt: row.signedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
  };
}

const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

function subToUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  const nsBytes = Buffer.from(SUB_NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(sub, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
