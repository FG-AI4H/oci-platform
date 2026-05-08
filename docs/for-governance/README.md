# For governance — member states, regulators, DPOs, ethics committees

You're responsible for assuring that the OCI's operation is consistent with your jurisdiction's legal, ethical, and policy requirements. This section is for you.

The OCI is **not** a single-jurisdiction product. Compliance posture is configurable per deployment so that an EU member-state instance, a WHO regional-office instance, and an academic instance can all coexist within the global federation.

| Topic                                                            | Read when                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Access governance — overview](../overview/access-governance.md) | You want the plain-English explainer of identity tiers, DUO, DUA, e-signature levels (eIDAS), and GA4GH Passports. **Read this first.** |
| [Data sovereignty](./data-sovereignty.md)                        | Your jurisdiction has data-residency requirements; you need to know what stays where.                                                   |
| [Compliance posture](./compliance.md)                            | You need to map the OCI's controls to GDPR / HIPAA / PIPL / equivalents.                                                                |
| [DUO and DUA framework](./duo-and-dua.md)                        | You need to understand how the platform expresses, matches, and (eventually) formalises data-use agreements.                            |
| [Audit and transparency](./audit.md)                             | You need to confirm what's recorded, who can read it, and how to subpoena it.                                                           |
| [Risk register](./risks.md)                                      | You need a structured view of platform risks and their mitigations.                                                                     |

## What the OCI promises

- **Multilateral governance.** ITU + WHO + WIPO under the GI-AI4H mandate. No single-vendor lock-in; no single-country veto.
- **Open source.** Source code on GitHub, infrastructure code in CDK. You can audit, fork, or self-host.
- **Standards-aligned.** MLCommons Croissant 1.1, GA4GH DUO, W3C ODRL, OBO biomedical ontologies. The platform extends; it doesn't fork.
- **Auditable by design.** Every access decision, every dataset version, every model evaluation is recorded with an immutable hash trail.
- **Federation over centralisation.** Your data can stay in your jurisdiction; only metadata travels.

## What the OCI does not do

- It does not perform IRB / ethics review. It records the _fact_ of approval and the reference number; the substantive review remains with your institution's IRB or equivalent.
- It does not adjudicate cross-border legality. If your jurisdiction prohibits a transfer, the OCI helps you express that (`DUO_0000028` Institution-specific restriction; geographic scoping in DUO_0000037; visibility set to RESTRICTED with manual approval); it does not make the transfer for you.
- It does not generate or hold electronic signatures yet. The DUA layer ([ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md) Phase 2 + 3) will introduce DUA generation, AdES via DocuSeal, and QES via Yousign (AWS Marketplace). Until then, formal-agreement modifiers (`RTN`, `COL`, `MOR`, `US`/`PS`/`IS`) require out-of-band agreements that hosts reference in decision notes.
- It does not waterproof against malicious insiders. Like any platform, it depends on the operator's identity / access controls. Threat modelling is in [`docs/security.md`](../security.md).

## Quick orientation by role

- **Data Protection Officer (DPO)**: start with [data-sovereignty.md](./data-sovereignty.md) and [compliance.md](./compliance.md).
- **Ethics committee chair**: start with [audit.md](./audit.md) and [duo-and-dua.md](./duo-and-dua.md).
- **National regulator (e.g. medical-device regulator)**: start with [audit.md](./audit.md) and the model-evaluation traceability section once Phase D ships.
- **Member-state programme officer**: start with [data-sovereignty.md](./data-sovereignty.md) and the [strategic overview](../for-strategy/strategic-overview.md).
- **Public-interest advocacy groups**: read everything; the docs are public for a reason.

## How to engage

- **Comment on the docs.** Pull requests welcome at `FG-AI4H/oci-platform`. Documentation is treated as part of the platform — issues against docs get triaged like code issues.
- **Participate in WG-Ethics & governance.** GI-AI4H's ethics WG is the formal forum for compliance-posture changes that affect multiple jurisdictions.
- **Audit access.** Regulators can request audit-trail access via the platform operator. This is separate from the OCI's own admin role and is read-only.
