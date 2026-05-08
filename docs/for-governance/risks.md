# Risk register

Governance-facing view of platform risks. The strategic-level risk register is at [for-strategy/risks.md](../for-strategy/risks.md); this page focuses on risks that matter for compliance, audit, and member-state oversight.

| Risk | Likelihood | Impact | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| Misuse of an APPROVED access — requester acts outside declared intent | Medium | Medium | Audit trail + DUO matching limits surface area; `Revoke` action available; regulator audit on request | Real — depends on requester compliance; platform records, doesn't enforce |
| Host publishes a non-PUBLIC dataset without DUO terms | Low | Medium | Publish-time fail-closed (PR J.1) rejects non-PUBLIC manifests without `consentCode` | Eliminated by control |
| Unknown DUO term on a manifest matched as if registered | Low | High | Matcher silently ignores unknown terms; UNCLEAR is the worst-case outcome (manual review) | Acceptable — no auto-approval based on unknown terms |
| Cross-border transfer outside DPO awareness | Medium | High | Federation outbound is PUBLIC-only; bytes residency is host's choice; configurable per deployment | Real if host mis-configures; documented in [data-sovereignty.md](./data-sovereignty.md) |
| IRB approval lapses after request was approved | Medium | Medium | Host can REVOKE; no automated re-check (operator can wire one if needed) | Real — depends on requester self-disclosure |
| Audit-trail tampering at the operator level | Low | Critical | Immutable versions; KMS-encrypted backups; CloudTrail at the AWS-account level; multilateral operator | Mitigated but not eliminated — depends on operator's IAM hygiene |
| Federation peer publishes misleading metadata | Medium | Low | Federated rows are clearly attributed; not commingled with local; admin can deregister a peer | Real but bounded — peers don't influence local data |
| Cognito PII exposure | Low | Critical | Cognito's own controls; OCI doesn't store PII outside Cognito; logs redact PII at pino layer | Acceptable subject to AWS posture |
| Data Use Agreement enforcement — requester violates a signed DUA | Low | High | Out of scope for the platform's enforcement; the audit trail supports legal action by host/operator | Accepted risk — DUAs depend on legal not technical enforcement |
| Decision-note information leakage | Low | Medium | Decision notes are visible to requester, host, admin, regulator; not external | Acceptable — hosts are coached not to put sensitive content in notes |
| Reproducibility loss — manifest hash changes after publish | Negligible | Critical | Versions are immutable; re-publish requires version bump; hash recomputed deterministically | Eliminated by control |
| Right-to-erasure conflict (GDPR Art 17) on catalogue audit data | Medium | Low–Medium | Documented as accepted under GDPR Art 89 research exemption; user notice at sign-up | Accepted; revisit with WG-Ethics if jurisdictional position changes |

## How to read this register

**Likelihood** is qualitative (Low / Medium / High), based on platform-team judgement informed by current operations + threat modelling.

**Impact** is qualitative (Low / Medium / High / Critical), worst-case if the risk realises.

**Mitigation** lists the platform's structural responses; some are eliminated by control, some bounded by control, some accepted with disclosure.

**Residual** is the post-mitigation status. "Real" means it can still happen; "Eliminated" means the control closes the gap; "Accepted" means a deliberate trade-off, documented and supervised.

## Process

This register is reviewed:

- **At every Phase boundary** (Phase B → C, etc.): the maintainer team + WG-Data leadership.
- **On any incident**: post-incident review feeds back into the register.
- **On regulator request**: published register made available; updates discussed.

Material changes require an ADR or equivalent decision record.

## Related

- [Compliance posture](./compliance.md) — controls implemented by default.
- [Data sovereignty](./data-sovereignty.md) — what data crosses what boundaries.
- [Audit](./audit.md) — what's recorded and who can read it.
- [`docs/security.md`](../security.md) — full security operating contract + threat model.
- [Strategic risk register](../for-strategy/risks.md) — funding, adoption, governance risks.
