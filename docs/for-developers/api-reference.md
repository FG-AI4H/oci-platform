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

| Query param                             | Type                                            | Default  | Notes                                                                   |
| --------------------------------------- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `q`                                     | string                                          | –        | Full-text search over name, description, keywords, BioCroissant fields. |
| `visibility`                            | `PUBLIC` \| `RESTRICTED` \| `PRIVATE`           | –        | Filter; visibility-aware (anonymous can only request PUBLIC).           |
| `status`                                | `DRAFT` \| `PUBLISHED` \| `ARCHIVED`            | –        | Filter.                                                                 |
| `hostId`                                | UUID                                            | –        | Datasets owned by this host.                                            |
| `source`                                | `local` \| `federated` \| `all`                 | `local`  | Federation filter.                                                      |
| `cursor`                                | string                                          | –        | Opaque base64 cursor from prior page.                                   |
| `limit`                                 | int (1..100)                                    | 25       | Page size.                                                              |
| `commercialUseTerms`                    | `OK` \| `NON_COMMERCIAL_ONLY` \| `CASE_BY_CASE` | –        | (#119) filter datasets by commercial-use band.                          |
| `modality` / `bodyRegion` / `condition` | string \| string[]                              | –        | (#91 PR L.1) BioCroissant facets; multi-value ORs within.               |
| `anonymizationLevel`                    | `ANONYMIZED` \| `PSEUDONYMIZED` \| `IDENTIFIED` | –        | BioCroissant facet.                                                     |
| `license` / `duoTerms`                  | string \| string[]                              | –        | License substring match / DUO id array overlap.                         |
| `sort`                                  | `recent` \| `name` \| `oldest`                  | `recent` | Sort order; FTS rank wins when `q` is set.                              |
| `page`                                  | int (1-indexed, 1..10000)                       | –        | 1-indexed page; `cursor` wins when both are passed.                     |

Response: `ListDatasetsResponse` — `{ items: DatasetSummary[]; nextCursor: string | null; totalEstimate: number; page, pageSize, totalPages }`. Each `DatasetSummary` carries `accessTier` (#115 — `OPEN`/`REGISTERED`/`CONTROLLED`/`SENSITIVE`) and `commercialUseTerms` (#119) so cards can render badges client-side.

### `GET /v2/catalog/datasets/:slug`

Detail for one dataset. Visibility-aware.

Response: `DatasetDetail` — `DatasetSummary` + `croissant` (the manifest), `versions[]`, `distributions[]`, `duoTerms[]`.

### `POST /v2/catalog/datasets` _(host)_

Create a draft. Body: `CreateDatasetRequest` (`slug`, `name`, optional `description`, `visibility`).

### `POST /v2/catalog/datasets/:slug/versions` _(host or admin)_

Publish a manifest version. Body: `PublishDatasetVersionRequest` (`version`, `croissant`, optional `notes`).

Validates against Croissant 1.0 base + Croissant 1.1 deltas + RAI + BioCroissant + OCI publish-time checks. Validation failures return `400` with `{ message, conformance, issues: [{ path, code, level, message }] }`.

### `GET /v2/catalog/datasets/:slug/croissant`

Returns the raw manifest as `application/ld+json`. Visibility-aware. Used by the web app's "download manifest" link.

### `GET /v2/catalog/.well-known/croissant-catalog.json`

Federation outbound. Lists every PUBLIC + PUBLISHED dataset's latest version as a thin JSON-LD index. Anonymous; aggressively cacheable.

## Access requests

### `POST /v2/catalog/datasets/:slug/access-requests` _(any auth)_

File a structured access request.

Body: `CreateAccessRequestRequest` — `{ attestations: AccessRequestAttestations, builderContext?: BuilderContext }`. The attestations payload (v1) carries:

- `projectTitle`, `projectDescription`, `institution`
- `intendedUseCategory` — `NON_COMMERCIAL_RESEARCH` | `COMMERCIAL_RESEARCH` | `CLINICAL_CARE` | `EDUCATION`
- `intendedUseDuoTerms[]` — DUO ids the requester attests to
- `irbApproved`, `irbApprovalRef?`, `dpiaRef?`
- `dataRetentionDays` (1..3650)
- `redistributionIntent` — `NONE` | `DERIVATIVES_ONLY` | `WITH_PERMISSION`
- `outputType` — `PUBLICATION` | `MODEL_WEIGHTS` | `DERIVATIVE_DATASET` | `INTERNAL_USE`

`builderContext` is **required** when `intendedUseCategory ∈ {COMMERCIAL_RESEARCH, CLINICAL_CARE}` (the BUILDER audience per #120) and **forbidden** otherwise — the schema's `superRefine` enforces this symmetrically. Shape:

- `legalEntity: { name, jurisdictionCountry: ISO-3166-1 alpha-2 }`
- `deploymentCountries: string[]` (ISO-3166-1 alpha-2)
- `regulatoryPathway` — `FDA_510K` | `FDA_DE_NOVO` | `FDA_PMA` | `EU_MDR_CLASS_I/IIA/IIB/III` | `EU_IVDR` | `NATIONAL_LMIC` | `NONE_RESEARCH_ONLY` | `OTHER`
- `whoPriorityAlignment?: string`, `accreditations: string[]`, `royaltyPlan?: string`
- `postMarketDataFlow` — `NO_PERSISTENCE` | `AGGREGATE_STATS` | `PSEUDONYMISED_RETAINED` | `IDENTIFIED_RETAINED`

Response: `{ id, matchStatus, requesterIdentityScore, audience }`. The matcher's verdict (MATCHED / CONFLICT / UNCLEAR) is computed inline; the `requesterIdentityScore` (#115) reflects what the platform could verify about the requester (today: email-domain category via #116; future: ORCID, quiz pass, GA4GH visas); `audience` is derived from `intendedUseCategory`.

### `GET /v2/me/access-requests` _(any auth)_

Caller's own access requests across all datasets.

### `GET /v2/me/host/access-requests` _(host)_

Inbox — access requests for datasets the caller hosts.

### `GET /v2/catalog/datasets/:slug/access-requests` _(host or admin)_

Same data, scoped to one dataset.

### `POST /v2/catalog/access-requests/:id/decision` _(host or admin)_

Decide. Body: `{ status: 'APPROVED' \| 'DENIED' \| 'REVOKED', decisionNote?: string }`. State-machine guards: APPROVE/DENY only from PENDING; REVOKE only from APPROVED.

## Storage / distributions

### `POST /v2/catalog/datasets/:slug/uploads` _(host)_

Initiate a multipart upload. Body: `InitUploadRequest` (`filename`, `contentType`, `contentSize`, optional `sha256`).

Response: `{ uploadId, key, partSize }`. The browser then mints presigned URLs per part:

### `GET /v2/catalog/datasets/:slug/uploads/:uploadId/parts/:partNumber/url?key=…` _(host)_

Returns `{ url, expiresAt }` — the presigned PUT URL for one part.

### `POST /v2/catalog/datasets/:slug/uploads/:uploadId/complete?key=…&contentType=…&contentSize=…&sha256=…` _(host)_

Body: `{ parts: [{ partNumber, etag }] }`. Finalises the multipart on S3, upserts the Distribution row.

Response: `UploadedDistribution` — `{ distributionId, name, contentUrl, contentType, contentSizeBytes, sha256, uploadedAt }`. The `contentUrl` is the relative `/v2/catalog/datasets/:slug/distributions/:id/download` path you paste into the next manifest version.

### `POST /v2/catalog/datasets/:slug/uploads/:uploadId/abort?key=…` _(host)_

Aborts an in-flight upload.

### `GET /v2/catalog/datasets/:slug/distributions/:id/download`

Gated download. Returns `302` to a 15-minute presigned S3 GET. Authz:

- PUBLIC + `requiresAccess: false`: any authenticated caller.
- RESTRICTED **or** `requiresAccess: true`: caller must have an APPROVED `AccessRequest` for the dataset.
- PRIVATE: host or admin only.

## Certification (#117)

### `GET /v2/certification/quizzes/:type`

Public quiz definition (questions + choices, no answer keys). The active quiz type today is `data_ethics_v1`.

Response: `QuizDefinitionPublic` — `{ certificationType, title, passMarkPercent, validityDays, questions: QuizQuestionPublic[] }`.

### `POST /v2/certification/quizzes/:type/attempts`

Start a new attempt. Returns `{ attemptId, startedAt }`.

### `POST /v2/certification/quizzes/:type/attempts/:id/submit`

Body: `{ answers: [{ questionId, choiceIndex }] }`. Server grades against the bank by `questionId`; missing answers count as wrong; pass mark is 80%; double-submission 409s; mismatched type 400s; submitting another user's attempt 404s (no oracle).

Response: `QuizAttemptResult` — `{ attemptId, certificationType, score, passed, passMarkPercent, submittedAt, expiresAt }`. `expiresAt` is null when not passed; otherwise `submittedAt + validityDays`.

### `GET /v2/me/certifications`

Caller's status + last 20 attempts.

Response: `UserCertificationStatus` — `{ certificationType, active, passedAt, expiresAt, history: [{ attemptId, submittedAt, score, passed }] }`.

## Click-wrap policy acceptances (#118)

### `POST /v2/identity/policy-acceptances`

Record an acceptance event. Body: `RecordPolicyAcceptanceRequest` — `{ policyUrl, policyVersion, policyText, contextType?, contextRef? }`. Server computes `sha256(policyText)` and (when `OCI_KMS_SIGNING_KEY_ARN` is set) signs a canonical receipt blob via KMS `ECDSA_SHA_256`.

Response: `PolicyAcceptanceReceipt` — `{ id, userId, policyUrl, policyVersion, textSha256, acceptedAt, contextType, contextRef, signature, signatureKeyId }`. `signature` and `signatureKeyId` are null when KMS isn't configured; the hash itself remains legally binding under SES (US ESIGN/UETA + EU eIDAS).

### `GET /v2/me/policy-acceptances`

Caller's audit trail. Most-recent-first list. Excludes the bulky `policyText` from the wire shape — fetch the row by id via a future admin endpoint when the full text is needed.

Response: `ListPolicyAcceptancesResponse` — `{ items: PolicyAcceptanceReceipt[] }`.

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
- Required-field changes on requests _are_ breaking and require a major bump.
