# API reference

The OCI exposes a JSON-over-HTTPS API at `https://oci.ai4h.net/v2/`. URI versioning is the contract: `/v2/` is the current major. `/v1/` is the legacy Django API and is **never** served from the new platform.

> **Live spec.** OpenAPI is exposed at `/docs` in `dev` and `int` (not `prod`). For the canonical machine-readable spec, fetch `/docs-json` from a non-prod environment.

This page is the human-readable summary. Fields and constraints are derived from the Zod schemas in `@oci/shared-types`; that package is the source of truth.

## Authentication

`Authorization: Bearer <token>` on every endpoint that has `@UseGuards(CognitoJwtGuard)`.

- **Production**: tokens are AWS Cognito access tokens. Verified server-side via `aws-jwt-verify`.
- **Local dev (`OCI_ENV=local`)**: a sentinel token of the form `Bearer dev:<user>:<roles>` is accepted and stub-decoded. Used by the web app's NextAuth Credentials provider and by `curl` during testing.

Anonymous calls work for public read endpoints. They return only PUBLIC + PUBLISHED rows.

## Catalog

### `GET /v2/catalog/datasets`

List / search / filter datasets.

| Query param | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | – | Full-text search over name, description, keywords, BioCroissant fields. |
| `visibility` | `PUBLIC` \| `RESTRICTED` \| `PRIVATE` | – | Filter; visibility-aware (anonymous can only request PUBLIC). |
| `status` | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` | – | Filter. |
| `hostId` | UUID | – | Datasets owned by this host. |
| `source` | `local` \| `federated` \| `all` | `local` | Federation filter. |
| `cursor` | string | – | Opaque base64 cursor from prior page. |
| `limit` | int (1..100) | 25 | Page size. |

Response: `ListDatasetsResponse` — `{ items: DatasetSummary[]; nextCursor: string | null; totalEstimate: number }`.

### `GET /v2/catalog/datasets/:slug`

Detail for one dataset. Visibility-aware.

Response: `DatasetDetail` — `DatasetSummary` + `croissant` (the manifest), `versions[]`, `distributions[]`, `duoTerms[]`.

### `POST /v2/catalog/datasets` *(host)*

Create a draft. Body: `CreateDatasetRequest` (`slug`, `name`, optional `description`, `visibility`).

### `POST /v2/catalog/datasets/:slug/versions` *(host or admin)*

Publish a manifest version. Body: `PublishDatasetVersionRequest` (`version`, `croissant`, optional `notes`).

Validates against Croissant 1.0 base + Croissant 1.1 deltas + RAI + BioCroissant + OCI publish-time checks. Validation failures return `400` with `{ message, conformance, issues: [{ path, code, level, message }] }`.

### `GET /v2/catalog/datasets/:slug/croissant`

Returns the raw manifest as `application/ld+json`. Visibility-aware. Used by the web app's "download manifest" link.

### `GET /v2/catalog/.well-known/croissant-catalog.json`

Federation outbound. Lists every PUBLIC + PUBLISHED dataset's latest version as a thin JSON-LD index. Anonymous; aggressively cacheable.

## Access requests

### `POST /v2/catalog/datasets/:slug/access-requests` *(any auth)*

File a structured access request.

Body: `CreateAccessRequestRequest` — `{ attestations: AccessRequestAttestations }`. The attestations payload (v1) carries:

- `projectTitle`, `projectDescription`, `institution`
- `intendedUseCategory` — `NON_COMMERCIAL_RESEARCH` | `COMMERCIAL_RESEARCH` | `CLINICAL_CARE` | `EDUCATION`
- `intendedUseDuoTerms[]` — DUO ids the requester attests to
- `irbApproved`, `irbApprovalRef?`, `dpiaRef?`
- `dataRetentionDays` (1..3650)
- `redistributionIntent` — `NONE` | `DERIVATIVES_ONLY` | `WITH_PERMISSION`
- `outputType` — `PUBLICATION` | `MODEL_WEIGHTS` | `DERIVATIVE_DATASET` | `INTERNAL_USE`

Response: `{ id, matchStatus }` — the matcher's verdict (MATCHED / CONFLICT / UNCLEAR) is computed inline.

### `GET /v2/me/access-requests` *(any auth)*

Caller's own access requests across all datasets.

### `GET /v2/me/host/access-requests` *(host)*

Inbox — access requests for datasets the caller hosts.

### `GET /v2/catalog/datasets/:slug/access-requests` *(host or admin)*

Same data, scoped to one dataset.

### `POST /v2/catalog/access-requests/:id/decision` *(host or admin)*

Decide. Body: `{ status: 'APPROVED' \| 'DENIED' \| 'REVOKED', decisionNote?: string }`. State-machine guards: APPROVE/DENY only from PENDING; REVOKE only from APPROVED.

## Storage / distributions

### `POST /v2/catalog/datasets/:slug/uploads` *(host)*

Initiate a multipart upload. Body: `InitUploadRequest` (`filename`, `contentType`, `contentSize`, optional `sha256`).

Response: `{ uploadId, key, partSize }`. The browser then mints presigned URLs per part:

### `GET /v2/catalog/datasets/:slug/uploads/:uploadId/parts/:partNumber/url?key=…` *(host)*

Returns `{ url, expiresAt }` — the presigned PUT URL for one part.

### `POST /v2/catalog/datasets/:slug/uploads/:uploadId/complete?key=…&contentType=…&contentSize=…&sha256=…` *(host)*

Body: `{ parts: [{ partNumber, etag }] }`. Finalises the multipart on S3, upserts the Distribution row.

Response: `UploadedDistribution` — `{ distributionId, name, contentUrl, contentType, contentSizeBytes, sha256, uploadedAt }`. The `contentUrl` is the relative `/v2/catalog/datasets/:slug/distributions/:id/download` path you paste into the next manifest version.

### `POST /v2/catalog/datasets/:slug/uploads/:uploadId/abort?key=…` *(host)*

Aborts an in-flight upload.

### `GET /v2/catalog/datasets/:slug/distributions/:id/download`

Gated download. Returns `302` to a 15-minute presigned S3 GET. Authz:

- PUBLIC + `requiresAccess: false`: any authenticated caller.
- RESTRICTED **or** `requiresAccess: true`: caller must have an APPROVED `AccessRequest` for the dataset.
- PRIVATE: host or admin only.

## Errors

The API emits RFC 7807 `application/problem+json` for all error responses:

```json
{
  "type": "https://oci.ai4h.net/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "only the dataset host or an admin can decide an access request",
  "instance": "/v2/catalog/access-requests/abc.../decision"
}
```

For Croissant validation, the `400` body carries `issues[]` with JSON-pointer `path`, stable `code`, `level`, and human `message`.

## Rate limits

Per-IP throttling at the ALB; default 100 requests/min. Bulk consumers (CLI, federation harvesters) should authenticate so they're rate-limited per token rather than per IP.

## Versioning policy

- `/v2/` is stable. Breaking changes require an ADR + a `/v3/` rollout.
- Additive fields on responses are not breaking and don't bump the major.
- Required-field changes on requests *are* breaking and require a major bump.
