import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseDicomHeader } from '@oci/dicom';

/**
 * A stand-in for the platform, for the upload tests: a real HTTP server
 * on a port of this machine that speaks the routes the uploader calls
 * (dataset detail, create, publish, the multipart upload) and plays
 * object storage on the same port.
 *
 * It is a fake, not a mock: requests travel over HTTP with the real
 * `fetch`, and what it answers for a stored file comes from the same
 * header reader the platform uses (`@oci/dicom`): CLEAR, HELD,
 * UNREADABLE, or nothing for a file that is not DICOM. What it does not
 * have is the platform's database, its real access rules and real
 * storage; those are covered by the API's own tests.
 */

interface StoredDistribution {
  id: string;
  croissantId: string;
  contentHash: string | null;
  contentSizeBytes: number | null;
  key: string;
}

interface FakeVersion {
  id: string;
  version: string;
  croissant: unknown;
  distributions: StoredDistribution[];
}

interface FakeDataset {
  slug: string;
  visibility: string;
  accessTier: string;
  status: string;
  versions: FakeVersion[];
}

export interface SeenRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  bodyBytes: number;
}

export class FakePlatform {
  readonly datasets = new Map<string, FakeDataset>();
  /** Bytes by storage key, as assembled by a completed upload. */
  readonly objects = new Map<string, Uint8Array>();
  readonly requests: SeenRequest[] = [];
  /** The token the API routes accept. */
  token = 'fake-session-token';
  /** Size of an upload part the server asks for. Small, so tests exercise several parts. */
  partSize = 16 * 1024 * 1024;
  /** Fail the n-th completed upload (1-based) with this status, once. */
  failCompleteAt: { nth: number; status: number } | null = null;
  /** Answer this check status whatever the file holds, to play a platform that disagrees. */
  forceCheckStatus: string | null = null;
  /** Answer no check status at all, as the platform does for a file it does not see as DICOM. */
  silentAboutCheck = false;
  /** Largest JSON body accepted, as the real API. */
  bodyLimit = 1024 * 1024;

  private readonly uploads = new Map<
    string,
    { slug: string; key: string; parts: Map<number, Uint8Array> }
  >();
  private completed = 0;
  private server: Server | null = null;

  get origin(): string {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error('the fake platform is not started');
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }

  addDataset(slug: string, overrides: Partial<FakeDataset> = {}): FakeDataset {
    const dataset: FakeDataset = {
      slug,
      visibility: 'PRIVATE',
      accessTier: 'CONTROLLED',
      status: 'DRAFT',
      versions: [],
      ...overrides,
    };
    this.datasets.set(slug, dataset);
    return dataset;
  }

  addVersion(slug: string, version: string): FakeVersion {
    const dataset = this.datasets.get(slug);
    if (!dataset) throw new Error(`no dataset ${slug}`);
    const created: FakeVersion = { id: randomUUID(), version, croissant: {}, distributions: [] };
    dataset.versions.unshift(created);
    dataset.status = 'PUBLISHED';
    return created;
  }

  /** Requests that reached an API route (anything under /v2). */
  apiRequests(): SeenRequest[] {
    return this.requests.filter((request) => request.path.startsWith('/v2/'));
  }

  /** Requests that reached storage. */
  storageRequests(): SeenRequest[] {
    return this.requests.filter((request) => request.path.startsWith('/storage/'));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', this.origin);
    const method = req.method ?? 'GET';
    this.requests.push({
      method,
      path: url.pathname,
      authorization: req.headers.authorization,
      bodyBytes: body.length,
    });

    const send = (status: number, json?: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(json === undefined ? '' : JSON.stringify(json));
    };

    // Storage: a signed address is its own authorisation.
    const storage = /^\/storage\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if (storage && method === 'PUT') {
      const upload = this.uploads.get(storage[1] ?? '');
      if (!upload || url.searchParams.get('signature') !== 'valid') return send(403);
      upload.parts.set(Number(storage[2]), new Uint8Array(body));
      return send(200, undefined, { etag: `"etag-${storage[2]}"` });
    }

    if (req.headers.authorization !== `Bearer ${this.token}`) {
      return send(401, { message: 'Unauthorized' });
    }
    if (body.length > this.bodyLimit) return send(413, { message: 'Payload Too Large' });
    const json = (): Record<string, unknown> =>
      body.length > 0 ? (JSON.parse(body.toString('utf8')) as Record<string, unknown>) : {};

    if (method === 'POST' && url.pathname === '/v2/catalog/datasets') {
      const input = json();
      this.addDataset(String(input.slug), {
        visibility: String(input.visibility),
        accessTier: String(input.accessTier),
      });
      return send(201, {});
    }

    // eslint-disable-next-line security/detect-unsafe-regex -- test server, anchored, one optional tail
    const route = /^\/v2\/catalog\/datasets\/([a-z0-9-]+)(\/.*)?$/.exec(url.pathname);
    const dataset = route ? this.datasets.get(route[1] ?? '') : undefined;
    if (!route || !dataset) return send(404, { message: 'dataset not found' });
    const rest = route[2] ?? '';
    const latest = dataset.versions[0];

    if (method === 'GET' && rest === '') {
      return send(200, {
        slug: dataset.slug,
        visibility: dataset.visibility,
        accessTier: dataset.accessTier,
        status: dataset.status,
        versions: dataset.versions.map(({ id, version }) => ({ id, version })),
        distributions: (latest?.distributions ?? []).map(({ key: _key, ...shown }) => shown),
      });
    }

    if (method === 'POST' && rest === '/versions') {
      const input = json();
      if (dataset.versions.some((version) => version.version === input.version)) {
        return send(409, { message: `version "${String(input.version)}" already exists` });
      }
      const created = this.addVersion(dataset.slug, String(input.version));
      created.croissant = input.croissant;
      // As the platform: a published file list adopts the stored files it points at.
      const listed = (input.croissant as { distribution?: Array<Record<string, string>> })
        .distribution;
      const previous = dataset.versions[1]?.distributions ?? [];
      for (const entry of listed ?? []) {
        const id = /distributions\/([0-9a-f-]{36})\/download$/.exec(entry.contentUrl ?? '')?.[1];
        const source = previous.find((distribution) => distribution.id === id);
        if (source) {
          created.distributions.push({
            ...source,
            id: randomUUID(),
            croissantId: entry['@id'] ?? '',
          });
        }
      }
      return send(201, {});
    }

    if (method === 'POST' && rest === '/uploads') {
      if (!latest) return send(400, { message: 'no published version yet' });
      const input = json();
      const uploadId = randomUUID();
      const key = `${dataset.slug}/${randomUUID()}/${String(input.filename)}`;
      this.uploads.set(uploadId, { slug: dataset.slug, key, parts: new Map() });
      return send(201, { uploadId, key, partSize: this.partSize });
    }

    const part = /^\/uploads\/([^/]+)\/parts\/(\d+)\/url$/.exec(rest);
    if (method === 'GET' && part) {
      const upload = this.uploads.get(part[1] ?? '');
      if (!upload || upload.key !== url.searchParams.get('key')) return send(404, {});
      return send(200, {
        url: `${this.origin}/storage/${part[1]}/${part[2]}?signature=valid`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });
    }

    const abort = /^\/uploads\/([^/]+)\/abort$/.exec(rest);
    if (method === 'POST' && abort) {
      this.uploads.delete(abort[1] ?? '');
      return send(204);
    }

    const complete = /^\/uploads\/([^/]+)\/complete$/.exec(rest);
    if (method === 'POST' && complete && latest) {
      const upload = this.uploads.get(complete[1] ?? '');
      if (!upload) return send(404, { message: 'no such upload' });
      this.completed += 1;
      if (this.failCompleteAt && this.completed === this.failCompleteAt.nth) {
        const { status } = this.failCompleteAt;
        this.failCompleteAt = null;
        return send(status, { message: 'injected failure' });
      }
      const input = json() as { parts: Array<{ partNumber: number }>; croissantId?: string };
      const bytes = Buffer.concat(
        input.parts
          .map((entry) => entry.partNumber)
          .sort((a, b) => a - b)
          .map((number) => upload.parts.get(number) ?? new Uint8Array()),
      );
      this.objects.set(upload.key, new Uint8Array(bytes));
      this.uploads.delete(complete[1] ?? '');

      const parsed = parseDicomHeader(new Uint8Array(bytes), { totalSize: bytes.length });
      const status = this.silentAboutCheck
        ? null
        : (this.forceCheckStatus ??
          (parsed.kind === 'not-dicom'
            ? null
            : parsed.kind === 'ok'
              ? parsed.findings.length > 0
                ? 'HELD'
                : 'CLEAR'
              : 'UNREADABLE'));

      const croissantId = input.croissantId ?? upload.key.split('/').pop() ?? '';
      const existing = latest.distributions.find((d) => d.croissantId === croissantId);
      const distribution: StoredDistribution = {
        id: existing?.id ?? randomUUID(),
        croissantId,
        contentHash: url.searchParams.get('sha256'),
        contentSizeBytes: Number(url.searchParams.get('contentSize')),
        key: upload.key,
      };
      if (existing) Object.assign(existing, distribution);
      else latest.distributions.push(distribution);
      return send(201, {
        distributionId: distribution.id,
        contentUrl: `/v2/catalog/datasets/${dataset.slug}/distributions/${distribution.id}/download`,
        dicomCheckStatus: status,
      });
    }

    return send(404, { message: 'no such route' });
  }
}
