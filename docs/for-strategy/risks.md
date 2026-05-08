# Risks and what we're betting on

Candid risk register. The OCI's leadership is read by stakeholders who can't easily verify claims by reading the codebase, so this page errs on the side of disclosure.

## Strategic / governance risks

### Multilateral coordination drag

**Risk**: Decisions that should take a week take six because three organisations + a Steering Committee are involved.

**Mitigation**: The OCI's day-to-day operational decisions are delegated to maintainers + WG-Data lead per the documented [governance](../overview/governance.md) (ADRs, code review). Only cross-cutting decisions (auth model, compliance posture, jurisdictional changes) escalate. Most work doesn't escalate.

**Residual risk**: Real, not hypothetical. Onboarding a new member state at Tier 2 takes months partly because the legal/governance side moves at multilateral speed.

### Single-funder concentration

**Risk**: If the platform's operating cost is borne by a single donor, that donor's withdrawal or political shift can pause the platform.

**Mitigation**: Funding model is multilateral by design (see [public-good-rationale.md](./public-good-rationale.md)). Existing federated instances would keep running on their operators' budgets even if global-instance funding paused.

**Residual risk**: We're not at the multilateral funding diversity yet. Today the OCI is in a build-out phase with concentrated funding sources.

### Standards drift

**Risk**: Croissant 1.1 / DUO / ODRL evolve in directions that make the OCI's implementation costly to keep aligned.

**Mitigation**: WG-Data participates in MLCommons + GA4GH standards-bodies; the OCI is a reference implementation. Standards changes that would break the OCI go through working-group channels first.

**Residual risk**: Real for niche extensions (BioCroissant is in this category — in active definition). Lower for the core standards.

## Operational risks

### Cloud-vendor lock-in (AWS today)

**Risk**: AWS pricing, service availability, or geopolitical posture changes; the platform is hard to move.

**Mitigation**: All infrastructure is in CDK; the application code uses AWS-specific services through abstraction layers (`@oci/database`, `S3ClientProvider`). A port to another cloud would be substantial but tractable — measured in months, not years.

**Residual risk**: Real. We've optimised for AWS in `eu-central-1` (the global instance) and accept that cost. A multi-cloud future requires a funded ask.

### Operations team scale

**Risk**: A 4–8 person team supporting a multilateral platform with 24/7 expectations is thin.

**Mitigation**: Stateless application layer, auto-scaling, monitored alerting. Member-state instances run on their own operations teams; the global instance is the only operations responsibility for the central team.

**Residual risk**: Real for incident response outside business hours in EU. Mitigated by AWS-managed services for the data-plane (Aurora, S3), where the cloud provider's SLA is the floor.

### Cognito as identity choke-point

**Risk**: Cognito (AWS) is the only identity provider in production. AWS account compromise or Cognito service issues break the platform.

**Mitigation**: MFA mandatory in production; OIDC-only deploys; account-level CloudTrail; KMS-CMK separation between deployment and runtime keys.

**Residual risk**: Real but bounded. Federated identity (e.g. eduGAIN, OIDC against member-state IdPs) is an architectural option but not a near-term roadmap item.

## Compliance risks

### Misalignment with a major jurisdiction

**Risk**: A jurisdiction (EU, US, China, India) issues regulation that the platform's default posture doesn't satisfy. Member-state participation pauses.

**Mitigation**: Configurable per-deployment posture (see [for-governance/compliance.md](../for-governance/compliance.md)). Most jurisdiction-specific concerns are addressable through configuration: residency, federation participation, DUO-required-at-publish, MFA scope, audit retention.

**Residual risk**: Real for regulations that demand things we can't configure (e.g. real-time data-export blocks, mandatory in-country administrators). These would be features, not configurations.

### DUA generation lag

**Risk**: PR J.2 (DUA generation + e-sign) ships later than expected; datasets needing formal agreements pile up in the UNCLEAR queue.

**Mitigation**: Hosts handle DUAs out-of-band today; the inbox tells them what's needed. Workable for the volume we have. Becomes a bottleneck at higher adoption.

**Residual risk**: Real once we're at scale. Unblocking PR J.2 is a near-term priority.

### Audit-export gap

**Risk**: A regulator requests an audit-trail export today; we can produce it via direct DB read, but we don't have a regulator-scoped endpoint with row-level access controls.

**Mitigation**: Operator-mediated access works for low-volume audit requests. Regulator-scoped export is on the Phase D roadmap.

**Residual risk**: Real if regulator demand outpaces Phase D delivery.

## Adoption risks

### "It's a science project"

**Risk**: Member states see the platform as experimental and don't commit. Adoption stays at Tier 1 (publish to global instance) without progressing to Tier 2/3.

**Mitigation**: Operational reliability + a published feature-status matrix + concrete adoption milestones build credibility over time. The first member-state Tier 2 deployment is a forcing function.

**Residual risk**: Real for the first 12–24 months. The narrative shifts only after a few member states are at Tier 2 with public success stories.

### "We already have one"

**Risk**: A member state has an existing national health-data platform and sees the OCI as duplicative.

**Mitigation**: The OCI is **federation-friendly**: the national platform's outbound `/.well-known/croissant-catalog.json` integrates the national platform into the global discovery surface without replacing it. Not zero-sum.

**Residual risk**: Limited — this is more an opportunity than a risk if framed correctly.

## Technical risks

### Croissant / DUO ecosystem maturity

**Risk**: The standards we depend on are young. Tooling is sparse; adoption is concentrated in a handful of large players.

**Mitigation**: The OCI is itself a growth driver for the ecosystem — it's a published reference implementation that other implementations can validate against. Croissant 1.1 (Feb 2026) and DUO (GA4GH-approved 2019) have crossed the maturity threshold for production use.

**Residual risk**: Real for downstream tooling. Niche datasets requiring esoteric metadata may not have validator support.

### Federation harvest reliability

**Risk**: Peer catalogues go offline, malform their indexes, or change their `/.well-known/...` URL structure. Our harvester accumulates errors.

**Mitigation**: Idempotent harvester; per-peer error tracking visible in `/catalog/remotes`; admin can pause/resume per peer.

**Residual risk**: Real, mitigated by treating federated rows as best-effort. Local-published rows are the authoritative source.

### Dependency churn

**Risk**: Major frameworks (NestJS, Next.js, Prisma) ship breaking changes; security patches require dependency upgrades.

**Mitigation**: ADR + 48h dev soak before promoting any major upgrade. CI runs Trivy + Gitleaks on every PR. CLAUDE.md hard rule: "always use the latest stable, security-patched packages".

**Residual risk**: Real but well-understood. One platform-modernization assessment per year keeps the toolchain current.

## What we're betting on

Across all the risks above, the OCI is making three bets:

1. **Standards win.** Croissant + DUO + ODRL + schema.org will keep growing. The OCI's investment in standards-alignment compounds.
2. **Federation, not centralisation.** Member states will participate as peers, not as consumers of a single global instance. The federation architecture pays off.
3. **Public-good economics.** Multilateral funding, open-source code, and federated operations will sustain the platform indefinitely — the Wikipedia / OpenStreetMap / Linux model, applied to health-AI infrastructure.

If any of these bets is wrong, the platform's value proposition gets weaker. None of them is certain. They're bets we think are the right ones.
