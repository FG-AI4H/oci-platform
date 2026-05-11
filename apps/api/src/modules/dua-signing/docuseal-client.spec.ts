import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocusealClient } from './docuseal-client.js';

const SAVED_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED_ENV };
  vi.restoreAllMocks();
});

describe('DocusealClient.fromEnv', () => {
  it('returns null when any of the three required env vars is missing', () => {
    delete process.env.OCI_DOCUSEAL_BASE_URL;
    delete process.env.OCI_DOCUSEAL_API_TOKEN;
    delete process.env.OCI_DOCUSEAL_WEBHOOK_SECRET;
    expect(DocusealClient.fromEnv()).toBeNull();

    process.env.OCI_DOCUSEAL_BASE_URL = 'https://docuseal.example';
    expect(DocusealClient.fromEnv()).toBeNull();

    process.env.OCI_DOCUSEAL_API_TOKEN = 'token';
    expect(DocusealClient.fromEnv()).toBeNull();
  });

  it('returns a client when all three env vars are present', () => {
    process.env.OCI_DOCUSEAL_BASE_URL = 'https://docuseal.example';
    process.env.OCI_DOCUSEAL_API_TOKEN = 'token';
    process.env.OCI_DOCUSEAL_WEBHOOK_SECRET = 'secret';
    expect(DocusealClient.fromEnv()).toBeInstanceOf(DocusealClient);
  });
});

describe('DocusealClient.verifyWebhookSignature', () => {
  const client = new DocusealClient({
    baseUrl: 'https://docuseal.example',
    apiToken: 't',
    webhookSecret: 'webhook-secret-xyz',
  });

  it('accepts a signature computed with the configured secret', () => {
    const body = JSON.stringify({ event_type: 'form.completed' });
    const sig = createHmac('sha256', 'webhook-secret-xyz').update(body).digest('hex');
    expect(client.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    const body = JSON.stringify({ event_type: 'form.completed' });
    const sig = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(client.verifyWebhookSignature(body, sig)).toBe(false);
  });

  it('rejects an empty signature header', () => {
    expect(client.verifyWebhookSignature('any', undefined)).toBe(false);
    expect(client.verifyWebhookSignature('any', '')).toBe(false);
  });

  it('rejects a signature of wrong length (avoids constant-time crash)', () => {
    expect(client.verifyWebhookSignature('any', 'short')).toBe(false);
  });
});

describe('DocusealClient.createSubmission', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 42,
                submitters: [
                  {
                    id: 99,
                    slug: 'submitter-slug',
                    embed_src: 'https://docuseal.example/s/embed-token',
                  },
                ],
              },
            ]),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
  });

  it('POSTs to /api/submissions with the auth header and returns id + signer URL', async () => {
    const client = new DocusealClient({
      baseUrl: 'https://docuseal.example/',
      apiToken: 'tok-123',
      webhookSecret: 'secret',
    });
    const result = await client.createSubmission({
      name: 'DUA — test-dataset — ar-123',
      bodyMarkdown: '# Test DUA',
      signerEmail: 'requester@example.edu',
      signerName: 'Alice Researcher',
    });
    expect(result.id).toBe('42');
    expect(result.signerUrl).toBe('https://docuseal.example/s/embed-token');
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://docuseal.example/api/submissions');
    expect((init.headers as Record<string, string>)['X-Auth-Token']).toBe('tok-123');
    const body = JSON.parse(init.body as string);
    expect(body.submitters[0].email).toBe('requester@example.edu');
    expect(Buffer.from(body.documents[0].content, 'base64').toString('utf8')).toBe('# Test DUA');
  });

  it('falls back to /s/<slug> when embed_src is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: 7, submitters: [{ slug: 'abc' }] }]), {
            status: 201,
          }),
      ),
    );
    const client = new DocusealClient({
      baseUrl: 'https://docuseal.example',
      apiToken: 't',
      webhookSecret: 's',
    });
    const result = await client.createSubmission({
      name: 'x',
      bodyMarkdown: 'x',
      signerEmail: 'a@b.com',
      signerName: 'A',
    });
    expect(result.signerUrl).toBe('https://docuseal.example/s/abc');
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const client = new DocusealClient({
      baseUrl: 'https://docuseal.example',
      apiToken: 't',
      webhookSecret: 's',
    });
    await expect(
      client.createSubmission({
        name: 'x',
        bodyMarkdown: 'x',
        signerEmail: 'a@b.com',
        signerName: 'A',
      }),
    ).rejects.toThrow(/500/);
  });
});
