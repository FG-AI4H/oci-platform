# ADR-0014: Evidence audit trail & regulator export

- **Status:** proposed
- **Date:** 2026-05-17
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:platform` `area:governance` `area:identity`

## Context

Every WHO publication reviewed in [docs/research/](../research/) (2021, 2023, 2024 LMM, 2026 Evidence Policy, 2026 WHO Europe EU Readiness) treats an **immutable, regulator-exportable audit trail** as a core obligation rather than a feature:

- WHO/ITU FG-AI4H (2023) §5.5.2: "audit trails documenting design choices + privacy controls implemented" — required for ISO 13485 traceability and post-incident forensics.
- WHO 2024 LMM Guidance pp. 81–98: "providers must maintain audit trails of LMM evaluations, modifications, and deployment decisions for regulatory oversight and liability justification".
- WHO Europe 2026 EU Readiness §19, Fig. 12: 56 % of EU states cite "effective and transparent documentation across AI product life-cycle" as their primary AI-governance enabler; 48 % already mandate "data accountability practices" (the most common AI-governance baseline).
- WHO 2026 Evidence Policy §6: "transparent and auditable decision-making… documented assumptions, traceable inputs and reviewable rationales to support accountability and public trust".
- EU AI Act Art. 12 (record-keeping) and Art. 13 (transparency) make this a legal obligation for high-risk AI systems deployed in the EU, where OCI runs (eu-central-1).

OCI today emits structured pino logs and writes individual events into module tables (`AccessRequest.statusHistory`, `DuaSigning.events`, `PolicyAcceptance.history`). What does not exist:

1. A **single, append-only audit feed** spanning every module so a regulator can read "everything that happened to dataset X / model Y / user Z" without joining 12 tables.
2. A **regulator-export endpoint** that returns a signed, machine-readable bundle (JSON-LD + detached signature) suitable for inclusion in a Notified Body submission or a court-ordered disclosure.
3. **Tamper-evidence** beyond CloudTrail (which the platform's customers cannot inspect) — a hash chain or equivalent.

This ADR locks the data model, the emission contract, and the export shape. It does not pre-build every module's emitters — each module owns its own integration as part of its Phase B/C epic.

## Decision

### 1. One append-only `AuditEvent` table; one event-emitter helper

A new Prisma model `AuditEvent` is added to `packages/database`:

```
model AuditEvent {
  id              String   @id @default(cuid())
  occurredAt      DateTime @default(now())
  emittedAt       DateTime @default(now())
  sequenceNumber  BigInt   @default(autoincrement())
  module          String   // 'catalog' | 'annotation' | 'access-request' | …
  action          String   // 'dataset.published' | 'evaluation.submitted' | …
  subjectType     String   // 'dataset' | 'model' | 'evaluation' | 'user' | …
  subjectId       String
  actorUserId     String?  // null for system-emitted events
  actorRoles      String[] // snapshot of roles at emission
  payload         Json     // module-defined; must round-trip JSON-LD
  payloadHash     String   // sha256(payload)
  previousHash    String?  // hash chain across the global stream
  recordHash      String   // sha256(canonical(this row minus recordHash))
  retentionClass  String   // 'standard-7y' | 'legal-hold' | 'short-1y'
  @@index([subjectType, subjectId, occurredAt])
  @@index([module, action, occurredAt])
}
```

**Append-only enforcement is in Postgres**, not the application layer:

- A `BEFORE UPDATE` trigger raises an exception on the table.
- A `BEFORE DELETE` trigger raises an exception except for the retention sweeper, which uses a `SECURITY DEFINER` function and only deletes rows past `retentionClass`-derived expiry.
- The API role has only `INSERT`, `SELECT`. Retention sweeping uses a distinct role.

The emitter helper lives in a new `@oci/audit` package (TS, no runtime dependencies). Two surfaces:

- `audit.emit({ module, action, subjectType, subjectId, payload, retentionClass? })` — fire-and-forget; failures are logged and re-queued via BullMQ to the same Postgres so emission never blocks request handling.
- `audit.emitSync(...)` — synchronous variant used for events that **must** be persisted before the parent transaction commits (e.g. DUA-signing completions, access grants). Same Postgres connection; participates in the parent's transaction.

Module owners add an `audit.emit(...)` call at the boundary of each persisted state change. The audit emitter does **not** wrap any existing logger — pino still writes operational logs; audit emits domain facts.

### 2. Hash chain spans the global stream

Each row stores `recordHash = sha256(canonical_json(row without recordHash))`. `previousHash` references the `recordHash` of the row with the immediately preceding `sequenceNumber`. The chain is verified periodically by a CDK-scheduled Lambda (daily) and the chain root is anchored to AWS QLDB / S3 Object Lock as part of the audit-export bundle (see §4).

If a row is tampered with at the DB layer despite the trigger guards, the chain check fails and an alarm fires. We do not claim cryptographic untamperability — Postgres admins can do anything — but we claim **detectability**.

### 3. Retention classes

| Retention class | Purpose | Default duration |
|---|---|---|
| `short-1y` | Operational chatter (login events, page views) — most are *not* in the audit table at all but pino logs; included here for the rare cases that should be visible to regulators. | 1 year |
| `standard-7y` | Default for every domain event (dataset.published, evaluation.submitted, access.granted, dua.signed, role.assigned, model.promoted, etc.). | 7 years |
| `legal-hold` | Set by the platform operator on a per-subject basis; never auto-deleted. | indefinite |

Retention is enforced by the sweeper Lambda. Records moved out are written to an S3 Object Lock bucket in compliance mode before deletion from Postgres; the sweeper records the move as an audit event (`audit.retention.sweep`).

### 4. Regulator-export endpoint

`GET /v2/audit/export` (requires `regulatory-advisor` or `admin` Visa per [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md)):

Query parameters:

- `subjectType` (required) — `dataset` | `model` | `evaluation` | `access-request` | `user`
- `subjectId` (required)
- `since`, `until` — ISO-8601 timestamps; both optional
- `includeRelated` — boolean; when true, follows subject relationships (e.g. dataset → its evaluations → its access requests)

Response: streaming `application/zip` containing:

```
manifest.jsonld              # subject metadata, query parameters, chain anchor
events.ndjson                # newline-delimited audit events
signature.cose               # COSE_Sign1 over manifest+events; key: KMS-signed
chain-root.txt               # hash chain root at export time + S3-Object-Lock pointer
README.md                    # how to verify the bundle offline
```

Signature key is an AWS KMS asymmetric key (`alg: ECDSA-P256-SHA256`); the public key + a verification script ship in [docs/runbooks/verify-audit-bundle.md](../runbooks/) (to be written).

### 5. What events get emitted (initial taxonomy)

This ADR locks the **shape**; the events themselves are owned by the modules that emit them. The initial taxonomy — to be tracked under the Phase B/C epics — covers:

- `catalog.dataset.{created,published,archived,intendedUse.updated,manifest.updated}`
- `annotation.campaign.{created,started,completed,sample.rejected,annotator.flagged}` (most of this already exists in `Annotation*` tables; the ADR makes it explicit which writes mirror into `AuditEvent`)
- `access-request.{submitted,matched,approved,denied,revoked}`
- `dua-signing.{initiated,signed,countersigned,revoked}`
- `identity.role.{granted,revoked}`, `identity.visa.{issued,refreshed,revoked}`
- `evaluation.{submitted,scored,delta-report.generated,fairness-report.generated,re-evaluated}` (Phase B)
- `prediction.modelcard.{created,facts-label.generated,version.promoted,version.demoted}` (Phase B)
- `reporting.{cear.generated,mdr-bridge.generated,pms.alert.fired,policy-use.recorded}` (Phase C)

Each event carries enough payload to make sense **without** the application running — a future regulator should be able to read the export bundle six years later with no platform connectivity.

### 6. Existing event-history tables are not deleted

`AccessRequest.statusHistory`, `DuaSigning.events`, etc., remain. They are operational — the UI reads them, the matcher reads them. The `AuditEvent` row is the *regulator-grade* mirror, written in the same transaction. Modules that have no event-history table today add only the `AuditEvent` emit; no operational duplication.

## Consequences

### Positive

- **Regulator-export is a single endpoint, not a manual data dump.** Closes a recurring gap raised by every WHO doc reviewed.
- **EU AI Act Art. 12 record-keeping obligation** is structurally satisfied for high-risk systems — vendors using OCI inherit the compliance.
- **Tamper-detection.** Append-only triggers + global hash chain + signed exports give us a credible answer to "how do we know nothing was edited".
- **No platform-wide refactor.** Modules opt in by calling `audit.emit(...)` at the right places; the table and infra are universal.

### Negative

- **Storage cost.** A platform emitting ~10 events/sec at 7-year retention is ~2 B rows; partitioning + S3-archive of cold data are required from day one (the sweeper Lambda handles the archive). Estimated <$50/month at int scale.
- **Discipline.** Modules will forget to emit. The Phase B/C epics each include a "audit-emit coverage" acceptance criterion; a CI check greps for emitted action names against a declared taxonomy.
- **JSON-LD canonicalisation** for hash stability is non-trivial — RFC 8785 is the chosen canonicalisation. Pinned as a `@oci/audit` dependency.

### Neutral

- The audit table is not a substitute for CloudTrail (infra-level) or pino logs (operational). It captures *domain* facts only.
- COSE was chosen over JWS because the bundle is binary-aware (CBOR-friendly) and the COSE_Sign1 envelope is the IETF standard for detached signatures over JSON-LD-like payloads.
- We do not commit to immediate S3 Object Lock on every event — only on the archived cold tier and the export bundle root. Hot Postgres is the operational mode.

## Alternatives considered

- **Per-module event tables only (no global mirror).** Rejected — regulators consume "everything about X"; cross-table joins are not a substitute and version drift between modules makes them brittle.
- **CloudTrail / VPC Flow Logs as the audit trail.** Rejected — those capture infra calls, not domain facts. A regulator asking "who approved access to dataset X" cannot read `s3:GetObject` and find the answer.
- **Use the existing `AccessRequest.statusHistory` pattern across all modules.** Rejected — it works for one entity but the global "what happened to this user across the platform" query is impossible across N independent history tables.
- **AWS QLDB as the primary store.** Rejected — QLDB is being deprecated by AWS; betting on a managed-ledger is a portability risk. We re-implement the parts we want (append-only + hash chain) in Postgres, which we already run.
- **External SIEM integration (Splunk / Datadog audit).** Rejected for the regulator-export use case — SIEMs aren't built for "give a signed snapshot to a Notified Body"; they're built for live ops. We do plan to *also* tee audit events to a SIEM in Phase C for ops; this ADR doesn't depend on it.
- **Synchronous emission only.** Rejected — for high-frequency events the latency hit is unacceptable; the BullMQ-backed asynchronous path with at-least-once delivery is sufficient for non-critical events. Critical events (DUA, access grant) use `emitSync`.

## References

- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — Visa scopes; `regulatory-advisor` Visa gates the export endpoint.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — provenance-on-write pattern; the audit emit is the regulator-grade mirror of provenance.
- [ADR-0013](./0013-intended-use-statement-and-risk-tier.md) — IUS writes are first-class audit events.
- WHO/ITU FG-AI4H (2023) [§5.5.2](../research/9789240078871-eng.pdf), WHO 2024 LMM Guidance pp. 81–98, WHO Europe 2026 EU Readiness §19.
- EU AI Act (Regulation 2024/1689) Art. 12 (record-keeping), Art. 13 (transparency).
- IETF RFC 8785 — JSON Canonicalization Scheme (JCS).
- IETF RFC 9052 — COSE_Sign1.
- ISO 13485 §4.2.5 — control of records.
