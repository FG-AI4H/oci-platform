import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Thin DocuSeal REST client (#128).
 *
 * DocuSeal exposes:
 *   - `POST /submissions` — create an envelope for an HTML/PDF body
 *   - `GET /submissions/:id` — read state
 *   - Webhook to a configured URL on `form.completed` / `form.declined`
 *
 * We don't model the full DocuSeal schema; just the request /
 * response fields the platform acts on.
 *
 * Activation: env `OCI_DOCUSEAL_BASE_URL` + `OCI_DOCUSEAL_API_TOKEN`
 * + `OCI_DOCUSEAL_WEBHOOK_SECRET` must all be set. When unset,
 * `fromEnv()` returns `null` and the signing endpoints return 503;
 * the rest of the platform (template preview, click-wrap) keeps
 * working without DocuSeal.
 */

interface DocusealConfig {
  baseUrl: string;
  apiToken: string;
  webhookSecret: string;
}

export interface CreateSubmissionInput {
  /** Display name for the envelope — surfaces in DocuSeal admin UI. */
  name: string;
  /** Markdown body of the DUA. DocuSeal renders it to PDF on its side. */
  bodyMarkdown: string;
  /** Signer email (requester). */
  signerEmail: string;
  /** Signer display name. */
  signerName: string;
  /** Optional reply-to address — usually the host institution. */
  replyTo?: string;
}

export interface CreateSubmissionResult {
  /** DocuSeal submission id. */
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
    if (!baseUrl || !apiToken || !webhookSecret) return null;
    return new DocusealClient({ baseUrl, apiToken, webhookSecret });
  }

  constructor(private readonly cfg: DocusealConfig) {}

  async createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
    const url = `${this.stripTrailingSlash(this.cfg.baseUrl)}/api/submissions`;
    const body = {
      name: input.name,
      send_email: false,
      documents: [
        {
          name: 'Data Use Agreement.md',
          content: Buffer.from(input.bodyMarkdown, 'utf8').toString('base64'),
        },
      ],
      submitters: [
        {
          role: 'signer',
          email: input.signerEmail,
          name: input.signerName,
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        },
      ],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': this.cfg.apiToken,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`DocuSeal submission failed ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`DocuSeal createSubmission returned ${res.status}`);
    }
    const json = (await res.json()) as Array<{
      id?: number | string;
      slug?: string;
      embed_src?: string;
      submitters?: Array<{ id?: number | string; embed_src?: string; slug?: string }>;
    }>;
    // DocuSeal's create-submission returns an array (one entry per signer).
    // We use the first; we only register one signer per envelope today.
    const first = Array.isArray(json) ? json[0] : (json as unknown);
    const submission = first as {
      id?: number | string;
      submitters?: Array<{ id?: number | string; embed_src?: string; slug?: string }>;
    };
    const id = submission.id;
    const submitter = submission.submitters?.[0];
    const signerUrl =
      submitter?.embed_src ??
      (submitter?.slug ? `${this.stripTrailingSlash(this.cfg.baseUrl)}/s/${submitter.slug}` : null);
    if (id === undefined || id === null || !signerUrl) {
      throw new Error('DocuSeal response missing submission id or signer URL');
    }
    return { id: String(id), signerUrl };
  }

  /**
   * Verify the `X-Docuseal-Signature` header on a webhook payload.
   * DocuSeal signs the raw request body with HMAC-SHA256 using the
   * configured webhook secret; we recompute and compare in constant
   * time.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(rawBody).digest('hex');
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
