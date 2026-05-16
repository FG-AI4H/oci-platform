# Compliance posture

The OCI is designed to be **configured for your jurisdiction**, not to claim one-size-fits-all certification. This page documents what controls the platform implements out-of-the-box and where the compliance boundaries lie.

> **Important.** This document is reference material, not legal advice. Whether the OCI satisfies a specific regulatory regime depends on the deployment configuration, the host's data handling, and your jurisdiction's specific requirements. Consult your DPO / counsel.

## Controls implemented by default

### Identity & access

- Authentication via AWS Cognito (PLUS plan in `prod`, standard in `dev`/`int`). Password + MFA where required.
- MFA mandatory for `admin`, `regulator`, `supervisor` roles in production.
- Role-based authorisation enforced at the API. Three audit roles (host, admin, regulator) plus the requester's own role.
- No service accounts with persistent credentials. All deploys are OIDC-mediated.

### Data protection

- **At rest**: AWS KMS-CMK with annual rotation. All RDS storage and S3 buckets use KMS encryption. The CDK refuses to provision otherwise.
- **In transit**: TLS 1.3 only. Cipher suite restricted at the ALB.
- **Backups**: automated daily, retained per environment policy (7 days dev, 14 int, 30 prod). Snapshot encryption enforced.
- **Object lock**: enabled on the artefact bucket in `prod` (write-once-read-many semantics).

### Audit trail

- Every access-request decision recorded with: request id, requester id, dataset id, dataset's DUO terms at the time, the structured intended-use payload, the host/admin who decided, the timestamp, and the decision note.
- Every dataset version recorded with manifest hash, publisher id, timestamp, immutable.
- Every download (gated) recorded against the requester's identity.
- ALB access logs to a dedicated S3 bucket with restricted IAM access.
- CloudWatch Logs structured JSON with correlation ids; PII redacted at the pino layer.
- Database audit log via `pgaudit` extension _(Phase D — under review)_.

### Application security

- OWASP-aware. Trivy + Gitleaks + CycloneDX SBOM in every PR.
- Distroless Node 24 base images.
- WAFv2 on `int` and `prod`. AWS managed rule sets + custom rules.
- CSRF mitigation via SameSite cookies + CSRF tokens on state-changing routes.
- CSP via `@fastify/helmet` (configurable per deployment; default-deny).
- Dependency upgrades require ADR + 48h dev soak before promotion (project rule; see the [Architecture Decision Records](../adr/) for cross-cutting decisions).

### Operational

- All AWS resources defined in CDK. No console clicks.
- Three environments — `dev` / `int` / `prod` — with progressively stricter posture.
- Removal policies: DESTROY (dev), SNAPSHOT (int), RETAIN (prod).
- Aurora Performance Insights + enhanced monitoring on `int` and `prod`.

The full security baseline is in [`docs/security.md`](../security.md).

## Mapping OCI artefacts to specific clauses

A second, complementary map: which OCI artefact contributes to which clause of the EU AI Act, EHDS, EU MDR, and GDPR Art. 89 research basis. Anchored to [ADR-0013](../adr/0013-intended-use-statement-and-risk-tier.md), [ADR-0014](../adr/0014-evidence-audit-trail-and-regulator-export.md), and [ADR-0015](../adr/0015-lmm-extensibility-door-openers.md). Items marked 🚧 are planned-not-yet-live; the issue number links the work item.

### EU AI Act (Regulation 2024/1689) — high-risk AI obligations

| Clause | OCI artefact | State |
|---|---|---|
| Art. 9 (data governance) | BIOCroissant manifest provenance fields (modality, body region, condition, demographics, IRB, `consentBasis`, `anonymizationLevel`, `lawfulBasis[]`, `dataController`/`dataProcessor`) + DUO permission terms + dataset access tier (`OPEN`/`REGISTERED`/`CONTROLLED`/`SENSITIVE`) | ✅ Live (BIOCroissant ext. landed in PR #272) |
| Art. 10 (data + data governance for high-risk AI) | Annotation provenance ([ADR-0008](../adr/0008-annotation-persistence-and-provenance.md)) + IRR ([ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md)) + dataset version immutability | 🚧 Annotation track Phase B (#212 + sub-epics) |
| Art. 11 (technical documentation) | BIOCroissant manifest + ModelCard (Phase C) + CEAR (Phase D) | 🚧 Planned ([#260](https://github.com/FG-AI4H/oci-platform/issues/260), [#265](https://github.com/FG-AI4H/oci-platform/issues/265)) |
| Art. 12 (record-keeping) | Append-only `AuditEvent` table + signed `GET /v2/audit/export` bundle (ADR-0014) | 🚧 Planned ([#257](https://github.com/FG-AI4H/oci-platform/issues/257), [#259](https://github.com/FG-AI4H/oci-platform/issues/259)) |
| Art. 13 (transparency to user) | Model Facts Label — auto-rendered one-page summary from the AI submission's IUS + evaluation results (WHO 2021 Fig. 7) | 🚧 Planned ([#261](https://github.com/FG-AI4H/oci-platform/issues/261)) |
| Art. 14 (human oversight) | Annotation 3-gate SOP ([ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md)) + Clinical Evaluator role (Phase C) | 🚧 Annotation Phase B (live for annotators) / Phase C (Clinical Evaluator role) |
| Art. 15 (accuracy + robustness + cybersecurity) | Fairness / subgroup report (per-group sens/spec/AUC with CIs; ≥ 5% delta flagged) + external validation typing + risk-tier-gated evidence rigor | 🚧 Planned ([#263](https://github.com/FG-AI4H/oci-platform/issues/263), [#264](https://github.com/FG-AI4H/oci-platform/issues/264)) |
| Art. 72 (post-market monitoring) | PMS dashboard + drift-event API | 🚧 Planned ([#267](https://github.com/FG-AI4H/oci-platform/issues/267)) |

### EHDS (Regulation 2025/327) — secondary use of health data

| Clause | OCI artefact | State |
|---|---|---|
| Art. 33–34 (secondary-use permits) | BIOCroissant `ehdsDataPermitId` + `lawfulBasis[]` per-jurisdiction array on the manifest | ✅ Live as schema (passthrough optional) |
| Art. 50 (Data Access Body interface) | DUO + access-request matcher + audit log of every decision | ✅ Live (catalog access-request flow) |
| Art. 56 (cross-border secondary use) | BIOCroissant `crossBorderSharingPermitted` + `jurisdictionsEligible[]` declaration | ✅ Live as schema |

### EU MDR (Regulation 2017/745) — medical-device technical documentation

| Annex | OCI artefact | State |
|---|---|---|
| Annex II §B.1 (device description, intended use) | ModelCard.intendedUse (ADR-0013) | 🚧 Planned ([#260](https://github.com/FG-AI4H/oci-platform/issues/260)) |
| Annex II §B.4 (risk analysis) | IMDRF risk-tier auto-derivation + override-with-justification (ADR-0013 §3) | ✅ Live as schema |
| Annex II §B.5 (data verification + validation) | Evaluation module + external validation typing + reproducibility manifest | 🚧 Planned ([#262](https://github.com/FG-AI4H/oci-platform/issues/262)) |
| Annex II §6 (clinical evaluation) | CEAR — Clinical Evaluation Assessment Report generator | 🚧 Planned ([#265](https://github.com/FG-AI4H/oci-platform/issues/265)) |
| AI-MDR Bridge Report (cross-cutting) | Maps every OCI artefact to MDR Annex II / III clauses for Notified Body submissions | 🚧 Planned ([#266](https://github.com/FG-AI4H/oci-platform/issues/266)) |

### GDPR (Regulation 2016/679)

The existing GDPR table below covers the high-level posture; the new BIOCroissant fields tighten specific points:

- **Art. 4(7)/4(8)** (controller / processor): `dataController` + `dataProcessor` fields on the manifest.
- **Art. 6 / Art. 9** (lawful basis / sensitive data): `lawfulBasis[]` per-jurisdiction array with article references.
- **Art. 89** (research exemption): `consentBasis` enum value `RETROSPECTIVE_WAIVER` or `PUBLIC_INTEREST` captures the legal basis.

### Note on Intended-Use Statement scope

The Intended-Use Statement (IUS) and IMDRF risk tier attach to the **AI submission / ModelCard**, **never to the dataset**. A dataset is a multi-purpose resource: the same chest-X-ray set may train a Tier I research model, a Tier II screening tool, or a Tier IV standalone diagnostic — pinning a single IUS to the dataset would prejudge the device. Dataset suitability for a given IUS is a *matching* concern resolved by reading the dataset's existing provenance + characteristic fields. See [ADR-0013](../adr/0013-intended-use-statement-and-risk-tier.md) (especially the 2026-05-17 amendment) for the full rationale.

## Mapping to common regulatory regimes

This is a partial, illustrative map. **Each row is a hint, not a certification.** Substantive coverage depends on configuration and process.

### EU GDPR

| Requirement            | OCI control                                                                                                                                                              | Notes                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Lawful basis           | Host declares legal basis on the manifest; requester declares intended use + IRB ref.                                                                                    | OCI doesn't infer lawful basis; it records the host's and requester's claims. |
| Data minimisation      | Federation principle: metadata travels, bytes don't.                                                                                                                     | Host responsibility to publish only what's necessary.                         |
| Purpose limitation     | DUO terms encode permitted purpose; matcher checks intended use.                                                                                                         | UNCLEAR triggers manual review; CONFLICT is denial-by-default.                |
| Right to erasure       | Out of scope for dataset bytes (research data isn't typically subject to erasure under GDPR Art 89 research exemption); applies to user-account data per Cognito policy. | Document this explicitly in your DPIA.                                        |
| DPIA                   | Manifest has a `dpiaRef` field on access-request attestations.                                                                                                           | Reference, not the document itself.                                           |
| Cross-border transfers | Configurable: host can pin to upstream-only, or stand up a national OCI instance.                                                                                        | See [data-sovereignty.md](./data-sovereignty.md).                             |
| Records of processing  | Audit trail.                                                                                                                                                             | Read-only access available to DPO on request.                                 |

### US HIPAA

| Requirement                        | OCI control                                                                     | Notes                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| De-identification                  | Manifest has `bio:anonymizationLevel`. Hosts attest, don't validate.            | The OCI does not perform de-identification.                        |
| Business Associate Agreement (BAA) | Out of scope at the platform level. The hosting AWS account is the BA boundary. | Operators of US-targeting instances must execute BAAs with hosts.  |
| Audit controls                     | Logs + audit trail above.                                                       | HIPAA-equivalent logging is configurable; check operator runbooks. |
| Access controls                    | Cognito + role-based authz.                                                     | MFA mandatory in `prod` for admin / regulator / supervisor.        |
| Encryption                         | At-rest KMS-CMK + in-transit TLS 1.3.                                           | Meets HIPAA's "Addressable" encryption specs.                      |

### China PIPL

PIPL has stricter cross-border-transfer requirements than GDPR. A China-targeting OCI instance would need:

- An in-country deployment (CDK supports any AWS region; `cn-north-1` requires the China partition, separate AWS account).
- DUO `DUO_0000028` (institution-specific) + `DUO_0000037` (geographic restriction) on every dataset.
- Federation **disabled** outbound except to other in-country peers.

Whether the OCI's standard posture combined with these configs meets PIPL is a question for in-country counsel.

### Brazil LGPD, Australia Privacy Act, Canada PIPEDA, etc.

Similar pattern: the OCI provides the structural controls (encryption, role-based access, audit, configurable residency, DUO-machine-checkable consent); jurisdiction-specific obligations are met through configuration + the operator's own policies.

## What the OCI does _not_ implement (yet)

- **Data Use Agreement (DUA) generation + e-sign.** Today the platform flags DUO terms requiring a formal agreement (`RTN`, `COL`, `MOR`, `US`, `PS`, `IS`) as UNCLEAR; hosts negotiate the agreement out-of-band and reference it in decision notes. PR J.2 will introduce template generation + countersigning.
- **DAC (Data Access Committee) escalation routing.** Today every host inbox is the DAC; multi-member committees coordinate via decision notes. PR J.2 territory.
- **Regulator audit-trail export.** Audit data is recorded; an export endpoint with regulator-scoped auth lands in Phase D.
- **Automated PII detection / redaction.** Out of scope. Hosts are responsible for the data they publish.

## Threat model

See [`docs/security.md`](../security.md) for the platform's STRIDE-aligned threat model. Highlights:

- The platform's primary trust boundary is the request author. A compromised host account can publish or grant access; mitigations are MFA + audit + revocation.
- The federation surface is read-only outbound. A compromised peer can't inject data into your instance — it can only consume your `/.well-known/...` feed (which is PUBLIC by definition).
- AWS account compromise is out of scope of the platform's threat model; it's a deployment risk handled by your AWS organisation's controls.

## How to do a compliance review

1. Read [`docs/security.md`](../security.md) and this page.
2. Map your jurisdiction's requirements against the controls above. Note the gaps.
3. Configure the deployment to close the gaps that _can_ be closed (residency, federation participation, DUO terms required at publish, MFA scope).
4. Document the gaps that _can't_ be closed (DUA generation, audit export today) as accepted risks with planned mitigations.
5. Engage WG-Ethics if the gaps are common across jurisdictions — it's the GI-AI4H forum for posture changes.

## Reference

- [GI-AI4H mandate documents (TODO link)](#)
- [WHO ethics and governance guidance for AI in health](https://www.who.int/publications/i/item/9789240029200)
- [GA4GH Framework for Responsible Sharing of Genomic and Health-Related Data](https://www.ga4gh.org/framework/)
- [European Health Data Space (EHDS) regulation](https://www.european-health-data-space.com/)
- [`docs/security.md`](../security.md)
