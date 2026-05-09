import { Logger } from '@nestjs/common';

/**
 * ORCID OAuth client (#125).
 *
 * Two endpoints:
 *   - Authorize: `https://orcid.org/oauth/authorize` (or sandbox).
 *   - Token:     `https://orcid.org/oauth/token`.
 *
 * The platform uses the `/authenticate` scope only — the token grants
 * us the user's ORCID iD + a thin profile read; we don't keep the
 * token afterward. ADR-0003 Phase 2 records this as the smallest
 * surface that delivers `ORCID_LINKED` identity assurance.
 *
 * Activation rule: env `OCI_ORCID_CLIENT_ID` + `OCI_ORCID_CLIENT_SECRET`
 * must both be set. Optional `OCI_ORCID_BASE_URL` lets local-dev /
 * staging point at the ORCID sandbox (`https://sandbox.orcid.org`);
 * defaults to production. `OCI_ORCID_REDIRECT_URI` is the web-side
 * callback URL ORCID redirects to.
 */

interface OrcidConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string; // 'https://orcid.org' or 'https://sandbox.orcid.org'
  redirectUri: string;
}

export interface OrcidTokenResult {
  accessToken: string;
  orcidId: string;
  /** ORCID returns the user's display name on the token response when authenticated. */
  name: string | null;
  /** Scope granted; we expect `/authenticate` for this flow. */
  scope: string;
}

export interface OrcidPersonRecord {
  emails: string[];
  /** Most recent employment institution name, if any. */
  affiliation: string | null;
}

export class OrcidOauthClient {
  private readonly logger = new Logger(OrcidOauthClient.name);

  /** Returns the configured client, or `null` when env isn't set up — enables a clean 503 path. */
  static fromEnv(): OrcidOauthClient | null {
    const clientId = process.env.OCI_ORCID_CLIENT_ID;
    const clientSecret = process.env.OCI_ORCID_CLIENT_SECRET;
    const redirectUri = process.env.OCI_ORCID_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return null;
    const baseUrl = process.env.OCI_ORCID_BASE_URL ?? 'https://orcid.org';
    return new OrcidOauthClient({ clientId, clientSecret, baseUrl, redirectUri });
  }

  constructor(private readonly cfg: OrcidConfig) {}

  /**
   * Build the ORCID authorize URL the web should redirect to. The
   * `state` parameter is opaque to ORCID; we generate it server-side
   * and validate on the callback to defend against CSRF.
   */
  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      scope: '/authenticate',
      redirect_uri: this.cfg.redirectUri,
      state,
    });
    return `${this.cfg.baseUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for an access token + the user's
   * ORCID iD. Throws on any non-2xx response; the controller maps
   * those to a 502 with a redacted message (we don't want to leak
   * token-endpoint internals into client error envelopes).
   */
  async exchangeCode(code: string): Promise<OrcidTokenResult> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
    });
    const res = await fetch(`${this.cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`ORCID token exchange failed ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`ORCID token endpoint returned ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      orcid?: string;
      name?: string;
      scope?: string;
    };
    if (!json.access_token || !json.orcid) {
      throw new Error('ORCID token response missing access_token or orcid');
    }
    return {
      accessToken: json.access_token,
      orcidId: json.orcid,
      name: json.name ?? null,
      scope: json.scope ?? '/authenticate',
    };
  }

  /**
   * Best-effort fetch of the public ORCID person record — emails + most
   * recent employment. Treated as enrichment; failures are logged and
   * the link still succeeds with whatever the token response provided.
   *
   * Uses the public API base (`https://pub.orcid.org`); for sandbox
   * we route to `https://pub.sandbox.orcid.org`.
   */
  async fetchPersonRecord(orcidId: string, accessToken: string): Promise<OrcidPersonRecord> {
    const pubBase = this.cfg.baseUrl.replace('://', '://pub.');
    const headers = {
      Accept: 'application/vnd.orcid+json',
      Authorization: `Bearer ${accessToken}`,
    };
    const empty: OrcidPersonRecord = { emails: [], affiliation: null };

    try {
      const [personRes, employmentRes] = await Promise.all([
        fetch(`${pubBase}/v3.0/${orcidId}/person`, { headers }),
        fetch(`${pubBase}/v3.0/${orcidId}/employments`, { headers }),
      ]);
      if (!personRes.ok && !employmentRes.ok) return empty;

      let emails: string[] = [];
      if (personRes.ok) {
        const person = (await personRes.json()) as {
          emails?: { email?: { email?: string; verified?: boolean }[] };
        };
        emails =
          person.emails?.email
            ?.filter((e) => e.email && e.verified)
            .map((e) => e.email as string) ?? [];
      }

      let affiliation: string | null = null;
      if (employmentRes.ok) {
        const employments = (await employmentRes.json()) as {
          'affiliation-group'?: Array<{
            summaries?: Array<{
              'employment-summary'?: {
                organization?: { name?: string };
                'end-date'?: unknown;
              };
            }>;
          }>;
        };
        // Pick the first summary without an end-date — that's "current".
        outer: for (const group of employments['affiliation-group'] ?? []) {
          for (const s of group.summaries ?? []) {
            const emp = s['employment-summary'];
            if (emp && !emp['end-date'] && emp.organization?.name) {
              affiliation = emp.organization.name;
              break outer;
            }
          }
        }
        // Fallback — pick any summary.
        if (affiliation === null) {
          for (const group of employments['affiliation-group'] ?? []) {
            const first = group.summaries?.[0]?.['employment-summary'];
            if (first?.organization?.name) {
              affiliation = first.organization.name;
              break;
            }
          }
        }
      }
      return { emails, affiliation };
    } catch (err) {
      this.logger.warn(
        `ORCID person/employment fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return empty;
    }
  }
}
