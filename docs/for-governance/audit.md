# Audit and transparency

The OCI is built so that every consequential action is recorded, attributable, and verifiable. This page is for regulators, ethics committees, and DPOs who need to understand what's recorded and how to read it.

## What's recorded

### Catalogue

Each `Dataset`:

- `id` (UUID), `slug` (URL-stable), `hostId` (the publisher's identity).
- `visibility` (PRIVATE/RESTRICTED/PUBLIC) and `status` (DRAFT/PUBLISHED/ARCHIVED).
- `createdAt`, `updatedAt` — server timestamps.
- `duoTerms[]` — DUO permission terms snapshotted from the latest published manifest.

Each `DatasetVersion` (one per published manifest):

- `id`, `version` (semver), `croissantHash` (SHA-256 of the canonicalised manifest).
- `croissant` — the full JSON-LD manifest.
- `notes` — host's release notes.
- `publishedById` — who pushed the version.
- `publishedAt` — server timestamp.
- **Immutable.** Versions can't be overwritten.

Each `Distribution`:

- `id`, `croissantId` (the manifest's `@id` for the file), `contentUrl`.
- `contentType`, `contentSizeBytes`, `contentHash`.
- `requiresAccess` (boolean).
- For platform-hosted: `storageBackend=S3`, `s3Bucket`, `s3Key`, `uploadStatus`.

### Access requests

Each `AccessRequest`:

- `id`, `datasetId`, `requesterId`.
- `status` (PENDING / APPROVED / DENIED / REVOKED).
- `attestations` — the structured intended-use payload at request time:
  - `projectTitle`, `projectDescription`, `institution`.
  - `intendedUseCategory`, `intendedUseDuoTerms[]`.
  - `irbApproved`, `irbApprovalRef`, `dpiaRef`, `dataRetentionDays`.
  - `redistributionIntent`, `outputType`.
- `matchStatus` (MATCHED / CONFLICT / UNCLEAR), `matchExplanations[]` — the auto-matcher's verdict + plain-English reasoning.
- `decidedById`, `decidedAt`, `decisionNote` — when status leaves PENDING.
- `createdAt`, `updatedAt`.

### Identity

In Cognito (separate from the catalogue DB):

- User pool with PII (email, name, phone if collected).
- Group memberships (host / admin / regulator / supervisor / participant).
- MFA enrollment status.
- Sign-in events with IP + user-agent (CloudWatch Logs).

### Operational

- ALB access logs to S3.
- API logs (CloudWatch, structured JSON, correlation ids).
- WAF logs (int / prod).
- AWS Config, CloudTrail (account-level — not platform-specific).

## What's _not_ recorded

- The bytes of dataset distributions in the API logs (logging redacts payload contents).
- Personal data of _subjects_ in datasets — that's in the dataset itself, governed by the host.
- IP addresses of dataset downloaders beyond the ALB log retention (90 days in prod).
- Browser fingerprints, behavioural analytics, or A/B-test bucketing — none are implemented.

## Who can read what

| Role                                                     | Can read                                                                         | Cannot read                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Anonymous**                                            | PUBLIC + PUBLISHED datasets only. Federation outbound.                           | Anything else.                                          |
| **Authenticated participant**                            | + RESTRICTED datasets (visible, not auto-downloaded). + own access requests.     | Other users' access requests; admin/regulator data.     |
| **Host**                                                 | + own datasets at any visibility/status. + access requests against own datasets. | Other hosts' datasets they don't own.                   |
| **Admin**                                                | All catalogue rows. All access requests. Operational metadata.                   | Cognito user PII without a separate authorisation.      |
| **Regulator** _(reserved for Phase D — read-only audit)_ | Full audit trail (catalogue + access requests). Operational logs on request.     | Cognito PII (PII is on a separate authorisation track). |

A **regulator audit-trail export endpoint** is planned for Phase D. Until then, regulator audits are run by the operator via direct read-only access to the audit data.

## Architectural commitment — append-only audit feed + signed regulator export ([ADR-0014](../adr/0014-evidence-audit-trail-and-regulator-export.md))

🚧 **Planned — Phase B foundation, Phase C export.** Not yet implemented. The shape and contract are committed; the work is tracked under [#257](https://github.com/FG-AI4H/oci-platform/issues/257) (audit package + table), [#258](https://github.com/FG-AI4H/oci-platform/issues/258) (CI coverage gate), [#259](https://github.com/FG-AI4H/oci-platform/issues/259) (export endpoint).

### `AuditEvent` shape

A single append-only Postgres table mirrors regulator-grade domain facts from every module. Each row carries:

- `id`, `occurredAt`, `sequenceNumber` (BIGINT auto-increment for chain ordering).
- `module` (`catalog`, `annotation`, `access-request`, …) + `action` (`dataset.published`, `evaluation.submitted`, `dua.signed`, …).
- `subjectType` + `subjectId` — what the event is about (dataset, model, evaluation, user, …).
- `actorUserId` + `actorRoles[]` — who did it; roles snapshotted at emission time.
- `payload` (JSON-LD) — module-defined; round-trips with a stable canonicalisation (RFC 8785 JCS).
- `payloadHash` (sha256 of canonical payload), `previousHash` (chain pointer), `recordHash` (sha256 of the row minus `recordHash`).
- `retentionClass` — `short-1y` / `standard-7y` / `legal-hold`.

**Append-only is enforced in Postgres**, not the application layer: `BEFORE UPDATE` / `BEFORE DELETE` triggers raise on the table. The retention sweeper uses a `SECURITY DEFINER` carve-out and writes archived rows to an S3 Object Lock bucket before deletion.

### Hash chain

Each row's `recordHash` references the previous row's hash. A daily Lambda verifies the chain end-to-end and anchors the chain root to S3 Object Lock. We do not claim cryptographic untamperability against a Postgres admin — we claim **detectability**. A bundle export (see below) carries the chain root at export time so a future verifier can prove no event was edited between emission and read.

### Retention classes

| Class | Purpose | Default |
|---|---|---|
| `short-1y` | Operational chatter (login events, etc. — mostly not in this table at all). | 1 year |
| `standard-7y` | Default for every domain event: dataset/model/evaluation lifecycle, access decisions, DUA signatures, role grants. | 7 years |
| `legal-hold` | Operator-set per-subject; never auto-deleted. | indefinite |

### Regulator-export endpoint

`GET /v2/audit/export?subjectType=<...>&subjectId=<...>&since=&until=&includeRelated=` — gated to `regulatory-advisor` or `admin` Visas per [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md). Returns a streaming ZIP:

```
manifest.jsonld      — subject metadata, query parameters, chain anchor
events.ndjson        — newline-delimited audit events
signature.cose       — COSE_Sign1 envelope (KMS-signed, ECDSA-P256-SHA256)
chain-root.txt       — hash chain root at export time + S3 Object Lock pointer
README.md            — offline verification instructions
```

The bundle is self-verifying: any future regulator can read it six years later without platform connectivity, validate the signature against the published KMS public key, and recompute the chain locally.

### What's already covered today (without `AuditEvent`)

Until the `@oci/audit` package + table land, the platform writes operational facts into per-module tables (`AccessRequest.statusHistory`, `DuaSigning.events`, `PolicyAcceptance.history`). Those continue to exist after `AuditEvent` lands — they remain the operational surface; `AuditEvent` is the regulator-grade mirror written in the same transaction. No data is moved or duplicated semantically; the export endpoint reads `AuditEvent` plus selectively joins the operational tables when `includeRelated=true`.

## How to verify a model's training-data claims

A claim like _"trained on RSNA Pneumonia 2018 v1.0.0 (manifest sha256:abc…)"_ is verifiable end-to-end:

1. Fetch `GET /v2/catalog/datasets/rsna-pneumonia-2018`.
2. In the response, find the version with `version: "1.0.0"`. Its `croissantHash` is recorded.
3. Compare the recorded hash against the claimed `abc…`. They must match.
4. The `croissant` field on that version is the manifest the model was trained against. It identifies the distributions, the cohort metadata, the DUO terms.
5. Cross-reference the `AccessRequest` rows for that dataset: who downloaded which version, when, under what declared use.

This is the regulator-facing payoff of immutable versioning + structured access-requests: _"prove what you trained on"_ becomes a deterministic check, not a paperwork dance.

## How to subpoena audit data

Because the OCI is run as a public good under multilateral governance, formal legal process for audit data follows the operator's jurisdiction:

- For the global instance at `oci.ai4h.net` operated by ITU/WHO/WIPO: routed through the relevant agency's legal office.
- For member-state instances: the operator's national legal process applies.
- For academic / institutional instances: the institution's data-governance process.

The platform itself does not adjudicate. It records the request, exposes the data through audited endpoints (when implemented), and preserves immutability.

## Retention

Audit records are retained:

- **Catalogue rows** (datasets, versions, access requests, distributions): forever, by design. Versions are immutable; deleting an access-request row would break an audit chain.
- **Operational logs** (CloudWatch, ALB access logs): per-environment retention policy. Default 90 days `dev`, 180 `int`, 1 year `prod`. Configurable.
- **Cognito sign-in events**: per Cognito retention.

Forever-retention of catalogue rows is a deliberate trade-off: it preserves auditability at the cost of "right to erasure" for catalogue activity. Operators must document this in their privacy notices; users are informed at sign-up. (The substantive data — the dataset bytes themselves — are subject to the host's retention policy, which is independent.)

## Transparency reports

A future cadence (Phase D / Phase E, governed by WG-Ethics) will publish anonymised transparency reports: how many datasets, how many access requests, by region, by DUO term. The data exists today; the reporting cadence and granularity are TBD.

## Reference

- [`docs/security.md`](../security.md) — security operating contract.
- [`for-governance/data-sovereignty.md`](./data-sovereignty.md) — what data crosses what boundaries.
- [`for-governance/duo-and-dua.md`](./duo-and-dua.md) — the access-control framework.
- WHO ethics and governance guidance for AI in health (linked from compliance.md).
