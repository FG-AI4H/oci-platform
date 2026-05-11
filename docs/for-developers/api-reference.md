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

## GA4GH Passport (#126)

The platform is a Passport relying party — Visa JWTs from trusted
issuers (ELIXIR AAI, NIH RAS) lift the requester's `identityScore` to
`PASSPORT_VERIFIED`. Spec: <https://ga4gh.github.io/data-security/ga4gh-passport>.

### `GET /v2/identity/passport/issuers`

The active trust list. Public — no auth required.

Response: `{ items: PassportTrustedIssuerSummary[] }` — `{ id, issuer, displayName, jwksUri, active }`.

### `POST /v2/identity/passport/visas`

Ingest a Visa JWT. The API decodes the `iss` claim, looks the issuer up in the trust list, fetches its JWKS, verifies signature + `exp` + `iss`, and persists the parsed visa. Re-ingest of the same `(user, issuer, visaType, jti)` is idempotent (updates `verifiedAt`).

Body: `IngestPassportVisaRequest` — `{ jwt }` (compact-form JWT).

Response (201): `PassportVisaSummary` — `{ id, visaType, issuer, issuerDisplayName, assertedAt, expiresAt, verifiedAt, value, source }`.

Errors: 400 on malformed JWT / unknown issuer / verification failure.

### `GET /v2/me/passport/visas`

Caller's active (non-expired, non-revoked) visas.

Response: `ListPassportVisasResponse` — `{ items: PassportVisaSummary[] }`.

### `DELETE /v2/me/passport/visas/:id`

Soft-delete (revoke) one of the caller's visas. Returns 204; audit row preserved.

## OCI as Passport issuer (#127)

Counterpart to the relying-party module — the platform also signs its own GA4GH Visas for internal events. JWTs are minted on demand and verified against the platform's JWKS.

Auto-mint hooks (no caller-driven endpoint needed):

- Quiz pass → `ResearcherStatus` (validity matches `OCI_QUIZ_VALIDITY_DAYS`).
- Click-wrap policy acceptance → `AcceptedTermsAndPolicies` (5-year long-lived).
- Access-request approval → `ControlledAccessGrants` (1-year, mirrors AR expiry).

### `GET /.well-known/jwks.json`

RFC 7517 — public JWKS so external verifiers can validate visas signed by the platform. Returns `{ keys: PublicJwk[] }`. Mounted at the well-known prefix per JOSE convention.

### `GET /v2/me/passport/issued`

Caller's OCI-issued visa rows. Includes both active and expired (so the user can see what was issued historically).

Response: `ListIssuedPassportVisasResponse` — `{ items: IssuedPassportVisaSummary[] }` with `active` flag.

### `GET /v2/me/passport/issued/:id/jwt`

Materialise a freshly-signed JWT for the row. The JWT is short-lived (matches `expiresAt`) so the caller can present it to an external verifier (e.g. another GA4GH-aware platform).

Response: `IssuedPassportVisaJwt` — `{ jwt }`.

Errors: 404 when the visa is missing, revoked, or past expiry.

### Signing-key configuration

Production: provision an AWS KMS RSA-2048 key (`RSASSA_PKCS1_V1_5_SHA_256`) and seed `passport_signing_keys` with the ARN before boot. Operator runbook in [`docs/runbooks/passport-issuer.md`](../runbooks/passport-issuer.md) (TBD).

Dev: an ephemeral RSA keypair is generated on first boot when no ACTIVE row exists. Refused when `NODE_ENV=production`.

## DUA template engine (#129)

Renders the prose of a Data Use Agreement for the given dataset + audience + intended-use. Pure render — no persistence side-effects. The signing surface (DocuSeal, #128) calls into the same service to produce the document payload at sign time.

Two starter templates ship with the API binary:

- `dua-researcher.hbs` — non-commercial / publication-as-output.
- `dua-builder.hbs` — commercial / product-as-output. Includes regulatory-pathway, deployment-country, post-market-monitoring clauses.

One conditional addendum:

- `addendum-lmic.hbs` — WHO-aligned LMIC public-sector carve-out, appended when the dataset's commercial-use terms are `NON_COMMERCIAL_ONLY` (so a separate LMIC route is the only commercial pathway).

Operators can override templates per-deployment by mounting an alternative directory and pointing `OCI_DUA_TEMPLATE_DIR` at it.

### `POST /v2/dua/preview`

Body: `PreviewDuaRequest` — `{ datasetSlug, audience, intendedUse, requesterInstitution?, requesterName?, regulatoryPathway?, deploymentCountry?, forceLmicAddendum? }`.

Response: `PreviewDuaResponse` — `{ templateId, lmicAddendumIncluded, markdown }`.

Errors: 404 when the dataset doesn't exist; 400 on validation failure.

## AdES DUA signing via DocuSeal (#128)

One step up from click-wrap. Required for `CONTROLLED` access tier per the matrix. Click-wrap (#118) handles `OPEN` and `REGISTERED`; this handles `CONTROLLED`; Yousign QES (#131, Phase 3) will handle `SENSITIVE`.

### Activation

Env vars (all three required):

- `OCI_DOCUSEAL_BASE_URL` — internal DocuSeal endpoint, e.g. `https://docuseal.dev.oci.ai4h.net`.
- `OCI_DOCUSEAL_API_TOKEN` — issued by the DocuSeal admin UI.
- `OCI_DOCUSEAL_WEBHOOK_SECRET` — HMAC-SHA256 secret for verifying webhook payloads.

When unset, signing endpoints return 503; click-wrap and template preview keep working.

### `POST /v2/dua/sign-requests`

Mint a DocuSeal envelope for an APPROVED access request. Idempotent on `(accessRequestId, status=PENDING)` — calling twice returns the same in-flight envelope so the requester's signer URL doesn't get invalidated.

Auth required. Caller must be the requester, the dataset host, or an admin.

Body: `CreateDuaSigningRequest` — `{ accessRequestId, audience: 'RESEARCHER' | 'BUILDER', signerEmail, signerName }`.

Response (201): `CreateDuaSigningRequestResponse` — `{ signature: DuaSignatureSummary }` with status `PENDING` and a `signerUrl` to redirect the requester to.

Errors: 404 unknown AR; 400 AR not APPROVED; 403 caller not authorised; 503 DocuSeal unreachable.

### `POST /v2/dua/webhook/docuseal`

Unauthenticated webhook called by DocuSeal on `form.completed` / `form.declined` / `form.expired`. HMAC-validated against `OCI_DOCUSEAL_WEBHOOK_SECRET` via the `X-Docuseal-Signature` header. On `completed`, the platform stamps the row `SIGNED` and mints an `AcceptedTermsAndPolicies` Passport visa pointing at the signed PDF URL.

### `GET /v2/me/dua-signatures`

Caller's signing history. Returns `ListDuaSignaturesResponse` — `{ items: DuaSignatureSummary[] }` most-recent first.

### `GET /v2/me/dua-signatures/:id`

One row. 404 when the row belongs to another user.

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
