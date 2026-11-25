import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Thin DocuSeal REST client (#128).
 *
 * The platform runs DocuSeal's free edition. Every API route that builds
 * a document from our own content (`/api/submissions/html`, `/pdf`,
 * `/api/templates/html`, `/pdf`) is reserved for the Pro edition, so the
 * rendered DUA cannot travel to DocuSeal as a document. Instead the
 * signer signs a fixed signature page, a template made once in the
 * DocuSeal UI, whose read-only fields name the agreement, the access
 * request, the dataset and the SHA-256 of the rendered DUA text the
 * platform stores. ADR-0003, amendment of 18 November 2026.
 *
 *   - `POST /api/submissions` with `template_id` + `submitters[].values`
 *   - Webhook to a configured URL on `submission.completed` and friends
 *
 * Activation: env `OCI_DOCUSEAL_BASE_URL`, `OCI_DOCUSEAL_API_TOKEN`,
 * `OCI_DOCUSEAL_WEBHOOK_SECRET` and `OCI_DOCUSEAL_DUA_TEMPLATE_ID` must
 * all be set (`OCI_DOCUSEAL_DUA_ROLE` defaults to DocuSeal's "First
 * Party"). When any is unset, `fromEnv()` returns `null` and the signing
 * endpoints return 503; the rest of the platform keeps working.
 */

interface DocusealConfig {
  baseUrl: string;
  apiToken: string;
  webhookSecret: string;
  /** Id of the signature-page template in DocuSeal. */
  duaTemplateId: number;
  /** Signer role as named in that template. */
  duaRole: string;
}

/**
 * Field names on the signature-page template. They must match the
 * template exactly: DocuSeal fills fields by name.
 */
export const DUA_PAGE_FIELDS = {
  agreement: 'Agreement',
  accessRequest: 'Access request',
  dataset: 'Dataset',
  textSha256: 'Text SHA-256',
  fullText: 'Full text',
} as const;

export interface CreateSubmissionInput {
  /** Which agreement, e.g. the template variant and any addendum. */
  agreement: string;
  /** Access request the DUA belongs to; also sent as DocuSeal's external id. */
  accessRequestId: string;
  /** Dataset slug. */
  dataset: string;
  /** SHA-256 (hex) of the rendered DUA text the platform stores. */
  documentSha256: string;
  /** Where the full text can be read. */
  fullTextRef: string;
  /** Signer email (requester). */
  signerEmail: string;
  /** Signer display name. */
  signerName: string;
  /** Optional reply-to address — usually the host institution. */
  replyTo?: string;
}

export interface CreateSubmissionResult {
  /** DocuSeal submission id (what the webhook reports as `data.id`). */
  id: string;
  /** Signer URL — where the requester goes to actually sign. */
  signerUrl: string;
}

export class DocusealClient {
  private readonly logger = new Logger(DocusealClient.name);

  /** Returns the configured client, or `null` when env isn't set up. */
  static fromEnv(): DocusealClient | null {
    const baseUrl = process.env.OCI_DOCUSEAL_BASE_URL;
    const apiToken = process.env.OCI_DOCUSEAL_API_TOKEN;
    const webhookSecret = process.env.OCI_DOCUSEAL_WEBHOOK_SECRET;
    const templateId = Number(process.env.OCI_DOCUSEAL_DUA_TEMPLATE_ID);
    if (!baseUrl || !apiToken || !webhookSecret) return null;
    if (!Number.isInteger(templateId) || templateId <= 0) return null;
    return new DocusealClient({
      baseUrl,
      apiToken,
      webhookSecret,
      duaTemplateId: templateId,
      duaRole: process.env.OCI_DOCUSEAL_DUA_ROLE || 'First Party',
    });
  }

  // Runtime-private, not a TypeScript `private` parameter property: the
  // config holds a secret, and a `#` field is left out of JSON.stringify,
  // util.inspect and any logger that serialises the instance (#784).
  readonly #cfg: DocusealConfig;

  constructor(cfg: DocusealConfig) {
    this.#cfg = cfg;
  }

  async createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
    const url = `${this.stripTrailingSlash(this.#cfg.baseUrl)}/api/submissions`;
    const body = {
      template_id: this.#cfg.duaTemplateId,
      send_email: false,
      submitters: [
        {
          role: this.#cfg.duaRole,
          email: input.signerEmail,
          name: input.signerName,
          external_id: input.accessRequestId,
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          values: {
            [DUA_PAGE_FIELDS.agreement]: input.agreement,
            [DUA_PAGE_FIELDS.accessRequest]: input.accessRequestId,
            [DUA_PAGE_FIELDS.dataset]: input.dataset,
            [DUA_PAGE_FIELDS.textSha256]: input.documentSha256,
            [DUA_PAGE_FIELDS.fullText]: input.fullTextRef,
          },
        },
      ],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': this.#cfg.apiToken,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`DocuSeal submission failed ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`DocuSeal createSubmission returned ${res.status}`);
    }
    // DocuSeal answers with one entry per submitter; the envelope id is
    // `submission_id` on each. `id` there is the submitter, not the
    // submission the webhook will report.
    const json = (await res.json()) as unknown;
    const first = (Array.isArray(json) ? json[0] : json) as
      | { submission_id?: number | string; embed_src?: string; slug?: string }
      | undefined;
    const id = first?.submission_id;
    const signerUrl =
      first?.embed_src ??
      (first?.slug ? `${this.stripTrailingSlash(this.#cfg.baseUrl)}/s/${first.slug}` : null);
    if (id === undefined || id === null || !signerUrl) {
      throw new Error('DocuSeal response missing submission id or signer URL');
    }
    return { id: String(id), signerUrl };
  }

  /**
   * Authenticate a webhook call from DocuSeal. The free edition sends no
   * body signature; its webhook settings take a fixed secret that it
   * sends as a header, configured on dev as `X-OCI-Webhook-Secret` with
   * the value of `OCI_DOCUSEAL_WEBHOOK_SECRET`. That header is accepted
   * when it matches in constant time; otherwise the HMAC signature below
   * is checked, for an edition or proxy that signs the body.
   */
  verifyWebhook(args: {
    rawBody: string;
    secretHeader: string | undefined;
    signatureHeader: string | undefined;
  }): boolean {
    if (args.secretHeader) {
      const given = Buffer.from(args.secretHeader.trim());
      const expected = Buffer.from(this.#cfg.webhookSecret);
      return given.length === expected.length && timingSafeEqual(given, expected);
    }
    return this.verifyWebhookSignature(args.rawBody, args.signatureHeader);
  }

  /**
   * Verify the `X-Docuseal-Signature` header on a webhook payload.
   * DocuSeal signs the raw request body with HMAC-SHA256 using the
   * configured webhook secret; we recompute and compare in constant
   * time.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', this.#cfg.webhookSecret).update(rawBody).digest('hex');
    const given = signatureHeader.trim();
    if (given.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  private stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
}
