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
- Dependency upgrades require ADR + 48h dev soak before promotion (per [`CLAUDE.md`](../../CLAUDE.md)).

### Operational

- All AWS resources defined in CDK. No console clicks.
- Three environments — `dev` / `int` / `prod` — with progressively stricter posture.
- Removal policies: DESTROY (dev), SNAPSHOT (int), RETAIN (prod).
- Aurora Performance Insights + enhanced monitoring on `int` and `prod`.

The full security baseline is in [`docs/security.md`](../security.md).

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
