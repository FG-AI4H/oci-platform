import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocusealClient, DUA_PAGE_FIELDS } from './docuseal-client.js';

const SAVED_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED_ENV };
  vi.restoreAllMocks();
});

function client(overrides: Partial<ConstructorParameters<typeof DocusealClient>[0]> = {}) {
  return new DocusealClient({
    baseUrl: 'https://docuseal.example/',
    apiToken: 'tok-123',
    webhookSecret: 'webhook-secret-xyz',
    duaTemplateId: 3,
    duaRole: 'First Party',
    ...overrides,
  });
}

const INPUT = {
  agreement: 'OCI Data Use Agreement, researcher-v1',
  accessRequestId: 'ar-123',
  dataset: 'lab-demo-chest-xr',
  documentSha256: 'a'.repeat(64),
  fullTextRef: 'Stored with access request ar-123 on the OCI Platform',
  signerEmail: 'requester@example.edu',
  signerName: 'Alice Researcher',
};

describe('DocusealClient.fromEnv', () => {
  function setAll() {
    process.env.OCI_DOCUSEAL_BASE_URL = 'https://docuseal.example';
    process.env.OCI_DOCUSEAL_API_TOKEN = 'token';
    process.env.OCI_DOCUSEAL_WEBHOOK_SECRET = 'secret';
    process.env.OCI_DOCUSEAL_DUA_TEMPLATE_ID = '3';
  }

  it('returns null when any of the four required env vars is missing', () => {
    for (const key of [
      'OCI_DOCUSEAL_BASE_URL',
      'OCI_DOCUSEAL_API_TOKEN',
      'OCI_DOCUSEAL_WEBHOOK_SECRET',
      'OCI_DOCUSEAL_DUA_TEMPLATE_ID',
    ]) {
      setAll();
      // eslint-disable-next-line security/detect-object-injection -- fixed list above
      delete process.env[key];
      expect(DocusealClient.fromEnv(), key).toBeNull();
    }
  });

  it('returns null when the template id is not a positive integer', () => {
    setAll();
    process.env.OCI_DOCUSEAL_DUA_TEMPLATE_ID = 'abc';
    expect(DocusealClient.fromEnv()).toBeNull();
    process.env.OCI_DOCUSEAL_DUA_TEMPLATE_ID = '0';
    expect(DocusealClient.fromEnv()).toBeNull();
  });

  it('returns a client when all four are present', () => {
    setAll();
    expect(DocusealClient.fromEnv()).toBeInstanceOf(DocusealClient);
  });
});

describe('DocusealClient.verifyWebhookSignature', () => {
  const c = client();

  it('accepts a signature computed with the configured secret', () => {
    const body = JSON.stringify({ event_type: 'form.completed' });
    const sig = createHmac('sha256', 'webhook-secret-xyz').update(body).digest('hex');
    expect(c.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    const body = JSON.stringify({ event_type: 'form.completed' });
    const sig = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(c.verifyWebhookSignature(body, sig)).toBe(false);
  });

  it('rejects an empty signature header', () => {
    expect(c.verifyWebhookSignature('any', undefined)).toBe(false);
    expect(c.verifyWebhookSignature('any', '')).toBe(false);
  });

  it('rejects a signature of wrong length (avoids constant-time crash)', () => {
    expect(c.verifyWebhookSignature('any', 'short')).toBe(false);
  });
});

describe('DocusealClient.createSubmission', () => {
  // The shape DocuSeal's free edition returned on dev on 18 November 2026:
  // one entry per submitter, `id` = submitter, `submission_id` = envelope.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 99,
                submission_id: 42,
                slug: 'uL4NFd7SntW8FG',
                embed_src: 'https://docuseal.example/s/uL4NFd7SntW8FG',
                role: 'First Party',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
  });

  it('creates the submission from the signature-page template with the five values', async () => {
    const result = await client().createSubmission(INPUT);
    expect(result).toEqual({ id: '42', signerUrl: 'https://docuseal.example/s/uL4NFd7SntW8FG' });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://docuseal.example/api/submissions');
    expect((init.headers as Record<string, string>)['X-Auth-Token']).toBe('tok-123');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ template_id: 3, send_email: false });
    expect(body.documents).toBeUndefined();
    expect(body.submitters).toHaveLength(1);
    expect(body.submitters[0]).toMatchObject({
      role: 'First Party',
      email: 'requester@example.edu',
      name: 'Alice Researcher',
      external_id: 'ar-123',
      values: {
        [DUA_PAGE_FIELDS.agreement]: INPUT.agreement,
        [DUA_PAGE_FIELDS.accessRequest]: 'ar-123',
        [DUA_PAGE_FIELDS.dataset]: 'lab-demo-chest-xr',
        [DUA_PAGE_FIELDS.textSha256]: 'a'.repeat(64),
        [DUA_PAGE_FIELDS.fullText]: INPUT.fullTextRef,
      },
    });
  });

  it('returns the submission id, not the submitter id, so the webhook can find the row', async () => {
    const result = await client().createSubmission(INPUT);
    expect(result.id).toBe('42');
  });

  it('falls back to /s/<slug> when embed_src is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: 8, submission_id: 7, slug: 'abc' }]), {
            status: 200,
          }),
      ),
    );
    const result = await client({ baseUrl: 'https://docuseal.example' }).createSubmission(INPUT);
    expect(result.signerUrl).toBe('https://docuseal.example/s/abc');
  });

  it('throws when the answer carries no submission id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ id: 8, slug: 'abc' }]), { status: 200 })),
    );
    await expect(client().createSubmission(INPUT)).rejects.toThrow(/submission id/);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"template_id is required"}', { status: 422 })),
    );
    await expect(client().createSubmission(INPUT)).rejects.toThrow(/422/);
  });
});

describe('DocusealClient.verifyWebhook', () => {
  const c = client();

  it('accepts the shared secret header the free edition sends', () => {
    expect(
      c.verifyWebhook({
        rawBody: '{}',
        secretHeader: 'webhook-secret-xyz',
        signatureHeader: undefined,
      }),
    ).toBe(true);
  });

  it('rejects a wrong or differently sized secret header, without falling back to HMAC', () => {
    const body = '{"event_type":"submission.completed"}';
    const hmac = createHmac('sha256', 'webhook-secret-xyz').update(body).digest('hex');
    expect(
      c.verifyWebhook({ rawBody: body, secretHeader: 'webhook-secret-xyw', signatureHeader: hmac }),
    ).toBe(false);
    expect(
      c.verifyWebhook({ rawBody: body, secretHeader: 'short', signatureHeader: undefined }),
    ).toBe(false);
  });

  it('falls back to the HMAC signature when no secret header is sent', () => {
    const body = '{"event_type":"submission.completed"}';
    const hmac = createHmac('sha256', 'webhook-secret-xyz').update(body).digest('hex');
    expect(c.verifyWebhook({ rawBody: body, secretHeader: undefined, signatureHeader: hmac })).toBe(
      true,
    );
    expect(
      c.verifyWebhook({ rawBody: body, secretHeader: undefined, signatureHeader: undefined }),
    ).toBe(false);
  });
});
