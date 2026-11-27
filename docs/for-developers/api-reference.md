# API reference

The OCI exposes a JSON-over-HTTPS API at `https://oci.ai4h.net/v2/`. URI versioning is the contract: `/v2/` is the current major. `/v1/` is the legacy Django API and is **never** served from the new platform.

> **Live spec.** The OpenAPI document is published at `/docs-json` in every environment, `prod` included. The interactive UI at `/docs` (and the `/docs-yaml` twin) stays `dev` and `int` only. Worker-only routes, such as the sealed-run result callback, are left out of the document.

## Discovery

### `GET /.well-known/oci-capabilities.json`

What this deployment offers, readable by machine. Public, no auth, `Cache-Control: public, max-age=3600`. Shape: `OciCapabilitiesDocument` in `@oci/shared-types`.

- `platform`: `name`, `version`, `environment`, `baseUrl` (from `OCI_API_URL`) and `jurisdiction` (from `OCI_JURISDICTION`, else `null`).
- `standards`: Croissant 1.1, BIOCroissant, GA4GH DUO and GA4GH Passport as `implements`; ITU-T Y.3176 and Y.3181 as `alignsWith`, not certification.
- `capabilities`: grouped by the AI for Good Sandbox verbs `discover`, `publish`, `trust` and `operate`. Each entry has `id`, `method`, `path` (OpenAPI template form), `auth` (`none`, `bearer` or `passport`) and a one-line `description`. `operate` is empty, with a note: OCI produces evaluation evidence, not deployments.
- `links`: the OpenAPI document and the Croissant catalogue index.

Every `path` is checked against the generated OpenAPI document in `capabilities.service.spec.ts`, so renaming or removing a listed route fails CI. Add a new entry to `CAPABILITY_GROUPS` in `apps/api/src/modules/discovery/capabilities.service.ts` when an endpoint serves one of the four verbs.

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

Response: `UploadedDistribution` — `{ distributionId, name, contentUrl, contentType, contentSizeBytes, sha256, uploadedAt, dicomCheckStatus }`. The `contentUrl` is the relative `/v2/catalog/datasets/:slug/distributions/:id/download` path you paste into the next manifest version. `dicomCheckStatus` is `null` for a file that is not DICOM; for a DICOM file it is `CLEAR`, or `HELD` / `UNREADABLE` when the file is held (see [DICOM series](#dicom-series-674-adr-0026)).

### `POST /v2/catalog/datasets/:slug/uploads/:uploadId/abort?key=…` _(host)_

Aborts an in-flight upload.

### `GET /v2/catalog/datasets/:slug/distributions/:id/download`

Gated download. Returns `302` to a 15-minute presigned S3 GET. Authz:

- PUBLIC + `requiresAccess: false`: any authenticated caller.
- RESTRICTED **or** `requiresAccess: true`: caller must have an APPROVED `AccessRequest` for the dataset that has not reached its end date (`expiresAt`, a year after approval unless the deployment sets `OCI_ACCESS_GRANT_VALIDITY_DAYS`).
- PRIVATE: host or admin only.

The end date is checked on every read, by `isAccessGrantActive` in `@oci/shared-types`: the bulk download, the DICOM routes and the annotation images go through the same check. When the caller's approval has ended, the `403` body carries `reason: "ACCESS_ENDED"` and `endedAt`, apart from the plain `403` of a caller who was never approved. `GET /v2/me/access-requests` returns `expiresAt` on each request.

A DICOM file that is held is a `404` for everyone but its host and admins.

## DICOM series (#674, ADR-0026)

When an upload completes, the platform reads the header of the stored file (never the pixel data), and indexes it if it is DICOM. The two routes below read that index. They are what the built-in viewer uses, and they carry what a DICOM JSON data source needs per instance.

Access is that of a download: PRIVATE → host or admin; RESTRICTED → host, admin, or an APPROVED access request; PUBLIC → anyone, signed in or not.

**Held files.** A DICOM file with undecided de-identification findings is returned to its host and to admins only. For everyone else it is absent from the lists and from the counts, and a series made only of held files is a `404`, the same answer as an unknown id.

A series is made of single-frame images. Left out for every caller: other DICOM objects (reports, presentation states, multi-frame objects), files behind an individual access gate (`requiresAccess`), files hosted elsewhere, and uploads that did not finish. A file whose header could not be read belongs to no series: its host and admins find it in the dataset's file list, not here.

### `GET /v2/storage/datasets/:slug/dicom/series`

The series of one dataset version. `?version=1.0.0` names the version; the default is the latest.

Response: `DicomSeriesList` — `{ datasetSlug, version, total, series: [{ id, studyInstanceUid, seriesInstanceUid, modality, seriesNumber, instanceCount, heldInstanceCount, rows, columns }] }`, by study, then series number. At most 500 series are returned and there is no paging yet; `total` is the full count. `rows` and `columns` are `null` unless every instance of the series states the same value. `id` is the platform's own id for the series and stays the same from one dataset version to the next.

### `GET /v2/storage/dicom/series/:id`

One series, with its instances in display order: along the stack, in the direction the scanner numbered them. A series that is not one stack (a localiser, missing positions) is ordered by instance number. `?version=` as above.

Response: `DicomSeriesDetail` — the fields of the list entry, plus `{ datasetSlug, version, frameOfReferenceUid, expiresAt, instances: [...] }`. Each instance carries:

- `url`: a signed storage address. The browser fetches the file from storage directly, with no `Authorization` header. It works at least until `expiresAt` (15 minutes at most); ask for the series again after that, or when storage refuses an address.
- `distributionId`, `held`, and the header fields a viewer needs before it has the file: `sopInstanceUid`, `sopClassUid`, `transferSyntaxUid`, `instanceNumber`, `rows`, `columns`, `bitsAllocated`, `pixelRepresentation`, `photometricInterpretation`, `imagePositionPatient`, `imageOrientationPatient`, `pixelSpacing`, `sliceThickness`, `windowCenter`, `windowWidth`.

Both responses are sent with `Cache-Control: no-store`.

### Operator review of held files _(admin)_

Three routes for the review of held files. Admin only, on every route: the dataset's host is not admitted as such. None is cached. See [Reviewing held DICOM images](../for-operators/reviewing-held-dicom-images.md) for the rules these implement.

**`GET /v2/storage/dicom/held`** returns `DicomHeldDatasetList`: the datasets with held files, `{ slug, name, heldInstanceCount, unreadableInstanceCount }`, the most held first.

**`GET /v2/storage/datasets/:slug/dicom/findings`** returns `DicomFindingsReview`: the undecided findings of a dataset, one per (attribute, value), with `instanceCount` and `seriesCount`, plus the decisions already recorded. It writes nothing. Each finding carries:

- `attribute` and `valueDigest`: how the finding is named. The digest is keyed; it is not a hash of the value alone.
- `value`: read from a stored file for this response and stored nowhere. **It may identify a patient.** Do not log or keep it. `null` when it could not be read back; cut to 1,000 characters with `valueTruncated: true` when longer.
- `wholeFile`: `true` for a finding about the file as a whole (`PrivateTags`, `BurnedInAnnotation`, `SequenceDepthExceeded`, `DataAfterPixelData`).
- `acceptable`: `false` when a decision naming it will be refused.

**`POST /v2/storage/datasets/:slug/dicom/findings/decisions`** takes `{ reason, findings: [{ attribute, valueDigest }] }` and returns `201` with `DicomFindingDecisionResult`: `{ decisionId, acceptedFindingCount, releasedInstanceCount, stillHeldInstanceCount }`. In one transaction it records the decision, releases every held file whose findings are now all accepted, and writes the audit event.

- A finding with a value is accepted for the dataset and also covers files uploaded later. A whole-file finding is accepted on the files held at that moment only.
- Only findings that are undecided on a held file of this dataset are accepted; others in the request are left out. `409` when none is.
- `422` when a selected value cannot be read back from storage or is too long to be shown whole. Nothing is recorded.
- Uploads with findings and decisions on the same dataset are serialised, so a file indexed while a decision is recorded is covered by it.

## Audit trail (#653, ADR-0014)

The platform's append-only, hash-chained record of events. Read by `admin` and `regulator` only, on every route; anyone else gets `403`. See [Reading and exporting the audit trail](../for-operators/reading-the-audit-trail.md) for how to use it.

**Who sees whom.** An `admin` sees the user id of each actor. A `regulator` sees a pseudonym instead, `ps-` and 24 hex digits: a keyed HMAC-SHA256 of the identifier, the same for the same person on every page and in every export. The same applies to the id of an event whose subject is a person (`subjectType: user`) and to values under person keys in a payload (`actorUsername`, `targetUsername`, `operator`, `reviewer`, …); each event lists them in `pseudonymised` as JSON Pointers. Without the key (`OCI_AUDIT_PSEUDONYM_KEY`), a deployed environment shows a regulator `withheld` instead. Someone in both groups is treated as an `admin`.

**Filters**, shared by the list and the exports (empty values are ignored):

| Parameter     | Meaning                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `subjectType` | The kind of object: `model-card`, `dataset`, `user`, `audit-export`, …                                                  |
| `subjectId`   | The object's id as stored. A regulator gives a pseudonym for a person and cannot use a real user id.                    |
| `actor`       | `system` (no person), a user id (`admin` only) or a pseudonym (`regulator` only). The other form is a `400`.            |
| `action`      | `module.action` as in `scripts/audit-taxonomy.json` (`prediction.modelcard.created`), or a module alone (`prediction`). |
| `from`, `to`  | ISO 8601 with an offset; `from` inclusive, `to` exclusive, on `occurredAt`.                                             |

### `GET /v2/audit/events`

A page of events. `?limit=` 1–200 (default 50), `?order=desc` (newest first, the default) or `asc`, `?cursor=` the `nextCursor` of the previous page.

Response: `AuditEventPage` — `{ events, nextCursor, actorView }`, `actorView` being `identified`, `pseudonymous` or `withheld`. Each event: `{ id, sequenceNumber, occurredAt, eventType, module, action, subjectType, subjectId, actor, actorRoles, payload, pseudonymised, payloadHash, previousHash, recordHash, retentionClass }`. `actor` is `{ kind: 'system' }`, `{ kind: 'user', id }`, `{ kind: 'pseudonym', id }` or `{ kind: 'withheld' }`. `sequenceNumber` is a string; gaps are normal (a rolled-back insert uses a number).

### `GET /v2/audit/events/verify`

Recomputes the chain and reports the first event at which it does not hold. Without parameters, from the first event of the trail. `?fromSequence=` / `?toSequence=` bound it by sequence number; `?from=` / `?to=` by time, which is turned into the span of sequence numbers between the first and last event in that time, every event in between being checked. At most 50,000 events per call; `complete: false` and `continueFromSequence` say where to go on. Rate-limited to 10 calls a minute.

For each event, in sequence order:

- `previousHash` must be the stored `recordHash` of the event before it (for the first event checked, the event before the range, or `null` at the start of the trail): otherwise `previous-hash`;
- `recordHash` must be sha256 of `module|action|subjectType|subjectId|occurredAt (YYYY-MM-DDTHH:MM:SS.mmmZ)|sequenceNumber|actor user id or empty|payloadHash|previousHash or empty`: otherwise `record-hash`;
- `payloadHash` must be sha256 of the RFC 8785 form of the stored payload: otherwise `payload-hash`.

Response: `AuditChainVerification` — `{ status: 'intact' | 'broken' | 'empty', checked, firstSequence, lastSequence, anchor, complete, continueFromSequence, firstBreak: { id, sequenceNumber, kind, expected, actual } | null, verifiedAt }`.

### `GET /v2/audit/events.csv` and `GET /v2/audit/events.json`

The events the filters match, oldest first, as a download (`Content-Disposition: attachment`, `Cache-Control: no-store`). `422` when more than 10,000 match. Rate-limited to 10 a minute.

**Each export is itself recorded** before the file is sent: event `audit.events.exported`, subject `audit-export` / the export id, with the format, the filters, the event count, the first and last sequence numbers, the `actorView` and the sha256 of the file. If that record cannot be written, there is no export. The response carries `X-OCI-Export-Id` and `X-OCI-Export-Sha256`.

- **JSON** (`oci-audit-events/v1`): `{ format, exportId, exportedAt, actorView, filters, count, rules, events }`; `rules` states both hash rules.
- **CSV**: columns `sequenceNumber, occurredAt, eventType, subjectType, subjectId, actorKind, actor, actorRoles, payload, pseudonymised, payloadHash, previousHash, recordHash, retentionClass, id`, CRLF line ends. `payload` is its RFC 8785 form. A cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` so a spreadsheet does not run it.

## Activity report (#828)

### `GET /v2/reports/activity`

One calendar month of what the deployment recorded. `admin`, `regulator` or `supervisor`; `Cache-Control: no-store`.

Query: `month`, as `YYYY-MM`, in UTC. Without it: the last complete month. A month that is not over is served with `partial: true`.

Response: `ActivityReport`.

- `datasets`: public datasets published at the end of the period, the versions published in it (the 50 most recent listed).
- `accessRequests`: filed in the period; approved and denied in the period, counted at the outcome they stand at today; waiting at its end.
- `evaluation`: tasks, submissions received, scored and failed; per task, the best published result as it stands today and the number of published results. What is published is decided by the evaluation module (an approved method version, not retracted).
- `models`: cards published today, and published in the period (read from the audit trail).
- `annotation`: running and completed campaigns with the tasks read, the share sent to arbitration and the agreement the annotation module computes, over all tasks read so far.
- `audit`: events in the period and the state of the hash chain over them: `intact`, `broken`, `empty`, or `unverified` when the period holds more events than one check covers.

Counts and public entries only: no person is named. Nothing is stored; the report is assembled from the database on each request.

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

RFC 7517 — public JWKS so external verifiers can validate visas signed by the platform. Returns `{ keys: PublicJwk[] }`. Mounted at the root well-known prefix per JOSE convention (version-neutral: not under `/v2/`), so `<issuer>/.well-known/jwks.json` resolves.

### `GET /v2/me/passport/issued`

Caller's OCI-issued visa rows. Includes both active and expired (so the user can see what was issued historically).

Response: `ListIssuedPassportVisasResponse` — `{ items: IssuedPassportVisaSummary[] }` with `active` flag.

### `GET /v2/me/passport/issued/:id/jwt`

Materialise a freshly-signed JWT for the row. The JWT is short-lived (matches `expiresAt`) so the caller can present it to an external verifier (e.g. another GA4GH-aware platform).

Response: `IssuedPassportVisaJwt` — `{ jwt }`.

Errors: 404 when the visa is missing, revoked, or past expiry.

### Signing-key configuration

Production: provision an AWS KMS RSA-2048 key (`RSASSA_PKCS1_V1_5_SHA_256`) and seed `passport_signing_keys` with the ARN before boot. Operator runbook at `docs/runbooks/passport-issuer.md` _(not yet written)_.

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

## Model catalogue (#591)

Public discovery of model cards (ITU-T Y.3176 Discover). Writes on `/v2/prediction/model-cards` stay authenticated; the reads below are anonymous. A bearer token, when sent, keeps the signed-in behaviour. The list and the card are advertised under `discover` in the capability document as `model.search` and `model.detail`.

### `GET /v2/prediction/model-cards`

List / search **PUBLISHED** model cards. No other status is ever returned, whoever asks.

| Query param    | Type                                                             | Default  | Notes                                                                                      |
| -------------- | ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `q`            | string (1..200)                                                  | –        | Case-insensitive substring over slug, developer, clinical summary and Intended-Use values. |
| `modelClass`   | `classical` \| `time-series` \| `foundation` \| `lmm` \| `agent` | –        | Filter.                                                                                    |
| `jurisdiction` | string (2..64)                                                   | –        | Matches `trainingDataJurisdictions` or `regulatoryApproval.jurisdictions`, any case.       |
| `sort`         | `recent` \| `name` \| `oldest`                                   | `recent` | `name` sorts by slug.                                                                      |
| `page`         | int (1-indexed, 1..10000)                                        | 1        | Offset pagination.                                                                         |
| `limit`        | int (1..100)                                                     | 25       | Page size.                                                                                 |

Response: `ListModelCardsResponse` — `{ items: ModelCardSummary[]; total; page; pageSize; totalPages }`. A summary carries the slug, class, version, developer, clinical summary, medical purpose, risk tier, generative-AI flag, training-data jurisdictions and regulatory-approval status. It never carries `submitterUserId`.

### `GET /v2/prediction/model-cards/:slug`

One model card. Anonymous: PUBLISHED cards only; any other status is a `404`, the same as an unknown slug. Signed in: PUBLISHED and WITHDRAWN cards, plus DRAFT and SUBMITTED for the submitter and reviewers.

Who sees which shape: the submitter, `evaluation-reviewer` and `admin` get the full `ModelCardResponse`. Everyone else, signed in or not, gets `PublicModelCard`, an allowlist that leaves out `submitterUserId`, `securityPosture`, `trainingDataLineage`, `parentModelCardId` and `changeJustification`. A field added to the card later stays private until it is added to the allowlist.

### Datasets of a model card (#820)

A card names the datasets the model was trained, tuned, validated or evaluated on. On `POST /v2/prediction/model-cards` and `PATCH /v2/prediction/model-cards/:slug`, `datasetRefs` is a list of at most 20 entries; on `PATCH` it replaces the whole list, and leaving it out keeps the list as it is. Each entry has a `role` (`TRAINING`, `TUNING`, `VALIDATION`, `EVALUATION`), an optional `note` of up to 500 characters, and exactly one target:

- `datasetSlug`: a dataset of this catalogue. It must be one the submitter can see; otherwise the answer is a `400` that lists the identifiers under `unknownDatasets`, the same for a slug that does not exist. The catalogue version and manifest hash current at that moment are stored with the reference and kept when the card is edited later.
- `externalUrl` with `externalName`: a dataset held elsewhere. Only `http` and `https` addresses are accepted.

Both card shapes, `ModelCardResponse` and `PublicModelCard`, carry two lists:

- `datasetRefs`, in the order declared. `kind` is `CATALOGUE`, `EXTERNAL` or `WITHHELD`. A `CATALOGUE` entry has `dataset` (name, modalities, file formats, licence, latest version) when the reader may see the dataset. A dataset of the catalogue the reader may not see is served as `WITHHELD`, with its role and nothing else: no slug, no note. The submitter and the reviewers always get the slug back.
- `evaluatedOn`: one entry per evaluation task with a published result linked to the card (#587), with the task and its dataset. Derived, never declared.

### `GET /v2/prediction/datasets/:slug/model-cards`

The **PUBLISHED** model cards that declare a dataset, newest change first: `{ items: ModelCardForDataset[] }`, each with the card's slug, developer, version, medical purpose, risk tier and the `roles` it declares the dataset in. Anonymous for a public dataset. A dataset the caller may not see is a `404`, the same as an unknown slug. Advertised in the capability document as `model.by-dataset`.

### `GET /v2/prediction/model-cards/:slug/model-facts` and `/model-facts.md`

The WHO Fig. 7 Model Facts Label, structured or as Markdown. Anonymous: PUBLISHED cards only, else `404`. Signed in: any non-DRAFT card; DRAFT is a `409`.

## From a use case to suggestions (#829)

### `GET /v2/use-case/suggestions`

Datasets, evaluation tasks and models that fit a described use case. Anonymous, like the catalogue; a bearer token widens the datasets to those the caller may see. Advertised in the capability document as `use-case.suggestions`.

Query, every field optional:

- `q`: condition, body site or other words (2 to 200 characters).
- `modality`: a modality label as datasets declare it.
- `taskKind`: an evaluation task kind.
- `intendedUse`: `NON_COMMERCIAL_RESEARCH` (default), `COMMERCIAL_RESEARCH`, `CLINICAL_CARE` or `EDUCATION`.
- `irbApproved`: `true` or `false` (default).
- `country`: a country or region code, matched against where a model's training data came from or where it is approved.

An empty value (`?q=`) counts as left out. A value that cannot be read is a `400`.

Response: `UseCaseSuggestionsResponse`.

- `datasets`: at most 20 published datasets from the catalogue search on `q` and `modality`. Each has `match`, what the access matcher says for this kind of use and ethics approval against the dataset's terms: `MATCHED`, `UNCLEAR` (a holder would have to review) or `CONFLICT`. It is the matcher an access request goes through, minus the check of who is asking. `MATCHED` is not an approval. Compatible datasets come first. `requiresRequest` is true when the files are behind an access request.
- `tasks`: evaluation tasks on a suggested dataset (`onSuggestedDataset`), then those whose name carries the words of `q`; filtered by `taskKind` when given.
- `models`: at most 10 published model cards matching `q` or `country`; empty when neither is given.

Rules on metadata only: no model and no agent takes part.

## Evaluation submissions (#645)

The task list and task detail (`GET /v2/evaluation/tasks`, `GET /v2/evaluation/tasks/:slug`) are public and never return the reference labels. The task detail, and the `task` object of a submission, carry `positiveClassName`: for a `BINARY_DIAGNOSTIC` task, what label 1 means in words; `null` for the other kinds. `POST /v2/evaluation/tasks` requires it, with `numClasses: 2` and `referableThreshold: 1`, when `taskKind` is `BINARY_DIAGNOSTIC`, and refuses it otherwise.

**Subgroups (#410, ADR-0030).** `POST /v2/evaluation/tasks` accepts an optional `subgroups: { fields: [{ key, label, values: [{ value, label }] }], values: { itemId: { fieldKey: value } } }`: at most 6 fields of 2 to 20 values each, and a value from the declared set for every field of every item of `groundTruth` (a `400` names the item and the field, never the value). The task detail publishes `subgroupFields` (the declaration; `[]` when none) and never the item map. Each scored submission then carries `subgroups` on its detail: `{ minCellSize, fields: [{ key, label, cells }] }`, one cell per declared value, either `{ status: 'REPORTED', value, label, itemCount, scoredCount, metrics }` with the kind's headline figures (no per-class table, no confusion counts; binary rates with their Wilson intervals) or `{ status: 'SUPPRESSED', value, label }`. A group with fewer than 11 scored items is withheld, further groups are withheld so a withheld one cannot be derived from the total and the others, and inside a published group a rate resting on 1 to 10 items is `null` with `ratesWithheld: true`. The breakdown is computed and stored at scoring time, already suppressed, and is the same for every reader. `subgroups` is `null` when the task declares no field or the submission was scored before it did.

### `POST /v2/evaluation/tasks/:slug/submissions`

Body: `{ methodName, intent?, predictions: [{ imageId, grade, score? }] }`. `intent` is `SCORED` (default) or `VALIDATION`. `score` (a number from 0 to 1) is accepted for a `BINARY_DIAGNOSTIC` task only; sent to any other kind it is refused as a format error (a failed `PAYLOAD_SHAPE` check on validation, a `400` on a scored submission). A binary task reports AUC only when every scored item carries a score (#650).

- `VALIDATION`: no token needed. Returns a `SubmissionValidationReport` listing identifiers sent twice, identifiers the task does not contain, labels outside the task's range, and how many of the task's items were left out. Nothing is scored, stored or counted.
- `SCORED` _(any auth)_: scores the predictions and returns `{ id, scores }`. A format error (an identifier sent twice, a label outside the range) returns `400` with `{ message, submissionId }` and records a FAILED submission that does **not** count against the quota. Over the quota: `403` with `{ message, quota }`.

### `GET /v2/evaluation/tasks/:slug/quota` _(any auth)_

`ScoredSubmissionQuotaSummary`: the weekly and per-task limits in force on the environment, the caller's usage against each, and `remaining`, the smaller of the two remainders. Validation submissions and predictions files refused for a format error are not counted; a sealed run counts whatever its outcome.

### `GET /v2/evaluation/tasks/:slug/submissions/:id`

`EvaluationSubmissionDetail`: the submission's status, its scores (for a `CLASSIFICATION` task, `scores.metrics.perClass` is the per-class breakdown; for a `BINARY_DIAGNOSTIC` task each rate is `{ estimate, lower, upper, numerator, denominator }` with a Wilson 95% interval, or `null` when not estimable, and `auc` is `null` unless every scored item had a score), the evaluation method version that produced them with its review status, and the task fields needed to read the numbers. Never carries predictions, reference labels or the submitter's identity; `viewerIsSubmitter` says only whether the caller submitted it.

A SCORED or PENDING submission is public. A FAILED one is returned, with `failure: { reason, quotaConsumed }`, to its submitter and to `admin` only. For anyone else it is a `404`, the same as an unknown id.

## Request size limits

The API refuses a request body over its route's limit with `413`, before the route runs: nothing is validated, stored or counted against a quota (#741). The numbers are defined once, in `@oci/shared-types` (`request-limits.ts`), with their arithmetic.

| Route                                         | Limit                 | What it holds                                                                                                                                                                                                                    |
| --------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v2/evaluation/tasks/:slug/submissions` | 10 MiB (10,485,760 B) | The schema's 100,000 predictions with identifiers of up to 64 characters (28 bytes a row plus the identifier: 9.2 MB). The schema allows identifiers of 200 characters; at that length about 46,000 rows fit, and more is `413`. |
| `POST /v2/evaluation/seam/evalai/submissions` | 10 MiB                | The same rows as above.                                                                                                                                                                                                          |
| `POST /v2/catalog/datasets/:slug/versions`    | 8 MiB (8,388,608 B)   | A manifest listing about 24,000 files one by one (about 350 bytes a file). The seeded manifests are 5 to 94 KB.                                                                                                                  |
| Every other route                             | 1 MiB (1,048,576 B)   | Fastify's default, set explicitly.                                                                                                                                                                                               |

The web app sends less than these limits. A server action's body is capped at 1 MiB by Next.js (`serverActions.bodySizeLimit` in `apps/web/next.config.ts`), and the predictions page refuses a file over 512 KiB, which becomes at most about 2.8 MB of JSON. Larger bodies come from scripts and machine clients calling the API directly.

The `413` is a problem response (`Content-Type: application/problem+json`) that names the limit and what to do about it. `message` repeats `detail` for clients that read Nest's usual shape:

```json
{
  "type": "https://oci.ai4h.net/errors/payload-too-large",
  "title": "Payload Too Large",
  "status": 413,
  "detail": "The predictions submission is larger than 10 MiB, the most this endpoint accepts. Nothing was stored. A submission carries at most 100,000 predictions, and fewer when the identifiers are long. Check that the file holds one prediction for each item of the task and nothing else.",
  "instance": "/v2/evaluation/tasks/idrid-grading/submissions",
  "limitBytes": 10485760,
  "statusCode": 413,
  "message": "…the same as detail…"
}
```

Where the load balancer's WAF is on (`int`, `prod`), it does not limit the body: the core rule set's 8 KB body rule only counts (#736, [security.md](../security.md)). Its other size rules still block: a query string over 2,048 bytes, a URI path over 1,024 bytes and a `Cookie` header over 10,240 bytes are refused with `403` before they reach the API.

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

Rate limits are not part of the documented contract yet and may be introduced. Clients should treat `429 Too Many Requests` as a signal to wait and retry, honouring `Retry-After` when it is present. Bulk consumers (CLI, federation harvesters) should authenticate.

## Versioning policy

- `/v2/` is stable. Breaking changes require an ADR + a `/v3/` rollout.
- Additive fields on responses are not breaking and don't bump the major.
- Required-field changes on requests _are_ breaking and require a major bump.
