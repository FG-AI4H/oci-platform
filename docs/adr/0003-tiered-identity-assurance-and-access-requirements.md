# ADR-0003: Tiered identity assurance and Access Requirements (GA4GH-first)

- **Status:** proposed
- **Date:** 2026-05-08
- **Deciders:** Marc Lecoultre (architect), pending review by Simao Campos (ITU-T) for the GI-AI4H steering side
- **Tags:** `area:catalog`, `area:access-control`, `package:DP`, `governance`

## Context

The OCI Catalog ships today (PR F + PR J.1, [#75](https://github.com/FG-AI4H/oci-platform/pull/75), [#93](https://github.com/FG-AI4H/oci-platform/pull/93)) with a single-tier access-request flow: requester writes a free-text justification, ticks a fixed set of attestation checkboxes (IRB approval, non-commercial use, etc.), the API auto-matches those against the dataset's GA4GH DUO consent terms, and the host approves or denies. Identity is whatever email the requester used to sign in via Cognito.

Two pressures are forcing the model to evolve:

1. **Hosts of more sensitive datasets** (e.g. the seeded `uhz-cardiac-mri-2024` PRIVATE fixture, which represents Swiss-jurisdiction patient-level cardiac MRI bound by KEK-ZH IRB approval) cannot legally hand out distribution URLs against an unverified email. They need: institutional affiliation evidence, a signed Data Use Agreement, an institutional Signing Official countersignature, an audit-quality record of the act of signing, and — for some EU jurisdictions — a Qualified Electronic Signature (QES) under eIDAS Regulation 910/2014.

2. **Federation pressure**: the broader biomedical-data field has converged on the **GA4GH Passport** standard (signed JWT bundles of _Visas_ — `ResearcherStatus`, `AffiliationAndRole`, `AcceptedTermsAndPolicies`, `ControlledAccessGrants`, `LinkedIdentities`). EGA, NIH dbGaP, and ELIXIR AAI are issuers; Synapse (Sage Bionetworks, our partner) has it on the roadmap. A platform that doesn't speak Passports re-asks every researcher questions other platforms already verified, and re-credentials each time. A platform that _only_ speaks Passports excludes everyone who arrives without one.

3. **Mission scope** — OCI is not just an academic-research catalogue. The platform's distinctive mandate under GI-AI4H is to **enable AI solutions for WHO public-health priorities, especially in LMICs**, and that work is largely done by commercial actors (LMIC startups, MedTech vendors, academic spin-offs commercialising research models, development-finance-backed initiatives). Peer platforms (Synapse, EGA, dbGaP) skew toward an academic-non-commercial-research default that excludes exactly the AI-builder population OCI exists to serve. The access-governance architecture must therefore treat **commercial use as a first-class scenario**, not a corner case — with a DUA template that supports product / deployment use, request-form fields tuned to deployment country and regulatory pathway, and a path that doesn't require a US R1 university affiliation.

Background research synthesising what Synapse, dbGaP, EGA, and UK Biobank do, plus the eIDAS framing, is captured in [docs/research/access-governance-2026-05-08.md](../research/access-governance-2026-05-08.md). This ADR records the architectural choice; the research doc records _why we believe what we believe_ about the field.

The forces in tension:

- **Don't break legacy** — existing approved access-requests, existing host workflows, existing tests must keep working.
- **Don't drown in SaaS cost** — the platform is convened by ITU/WHO/WIPO and operates on body-funded budget; per-seat e-signature subscriptions ($45/user/month with envelope quotas) are the wrong shape for our usage pattern (rare, bursty signature events on a small operator team).
- **Be ahead of the curve, not bleeding-edge** — GA4GH Passports are the right bet; W3C Verifiable Credentials and EUDI Wallet (eIDAS 2.0, mandated Nov 2026) are not yet broadly issued. Build for the former, track the latter.
- **Honour the seam** — the existing `@oci/shared-types` schemas are the contract. New identity claims attach to existing types; we don't fork them.

## Decision

We adopt a **two-axis access-control model** mirroring Synapse's "user tier × per-dataset Access Requirement" pattern, anchored on **GA4GH Passport semantics from day one** (we read native, we ingest existing, we issue our own), and we use **pay-per-signature eIDAS QTSPs** (Skribble for QES, DocuSeal self-hosted for AdES) instead of per-seat subscriptions.

Concretely:

1. **Two new fields on `Dataset`**: `accessTier` (`OPEN | REGISTERED | CONTROLLED | SENSITIVE`) decoupled from `visibility`, and an optional `accessRequirements: AccessRequirement[]` describing what each tier demands (click-wrap ToU, signed DUA, IRB attestation, PI countersignature, QES, …).

2. **A new `RequesterIdentityContext`** computed at every authorize-decision time, normalising whatever the requester brought (Passport Visas, ORCID employment claims, Cognito email, eduGAIN R&S bundle, OCI-issued quiz pass) into one shape:

   ```ts
   interface RequesterIdentityContext {
     identityScore:
       | 'EMAIL_ONLY'
       | 'EMAIL_DOMAIN_VERIFIED'
       | 'ORCID_LINKED'
       | 'QUIZ_PASSED'
       | 'PI_COUNTERSIGNED'
       | 'PASSPORT_VERIFIED';
     visas: GA4GHVisa[]; // both ingested + OCI-issued
     affiliation: {
       institution: string;
       role: string;
       source: 'self' | 'orcid' | 'edugain' | 'passport';
     } | null;
     researcherStatus: { confirmedBy: string; iat: number } | null;
     acceptedPolicies: { policyUrl: string; sha256: string; iat: number }[];
     emailDomainCategory: 'institutional' | 'corporate' | 'public' | 'disposable';
   }
   ```

3. **OCI is a Passport relying party AND a Passport issuer from the start.** We verify Visas against published JWKS for ELIXIR AAI, NIH RAS, and Sage's broker. We sign our own Visas for users who pass our quiz, accept our ToU, get approved for a dataset, or get countersigned by a PI. Other GA4GH-conformant platforms can trust our `ControlledAccessGrants` for OCI-hosted datasets.

4. **Click-wrap with SHA-256 evidence is the SES-grade default.** We hash the policy text + timestamp + user sub, store the hash, and emit an `AcceptedTermsAndPolicies` Visa. Legally binding under US ESIGN/UETA today; sufficient for `OPEN` and `REGISTERED` tiers.

5. **AdES via DocuSeal self-hosted** (open-source, MIT-licensed, runs in our existing ECS cluster). Used for `CONTROLLED` tier DUAs. Zero per-signature cost beyond infra.

6. **QES via Yousign (pay-per-signature, AWS Marketplace)**, gated on `SENSITIVE` tier policy decision. Yousign is an EU QTSP on the EU Trust List, available through AWS Marketplace — so the QES bill consolidates onto our existing AWS account (no separate vendor procurement). Pay ~€1–2 per signature, no minimum, no monthly fee. _Not_ DocuSign — DocuSign is per-seat with envelope quotas, wrong shape for our usage. Skribble (Swiss QTSP, Swisscom backend, dual eIDAS+ZertES conformance) was the runner-up but bills direct; we can revisit if a Swiss-only host with strict ZertES requirements emerges.

   AWS does not offer a first-party eIDAS-compliant signature service: AWS Signer is for code, QLDB is an immutable ledger (not a signing tool), and KMS/CloudHSM provide cryptographic primitives but not the QTSP+QSCD trust chain QES requires. Becoming our own QTSP is theoretically possible via KMS+CloudHSM but requires ETSI EN 319 411 audit by an EU notified body — a workstream of its own, off the table for OCI.

7. **Two reviewer roles** mirroring Synapse:
   - **Host** (existing) — reviews dataset-specific requests for `RESTRICTED` / `CONTROLLED` tier.
   - **OCI ACT** (new — GI-AI4H Access & Compliance Team, an ITU/WHO-appointed body) — reviews `SENSITIVE` tier requests + Validated User profile applications. Implemented as a new Cognito group `oci-act` mapped to existing role plumbing.

8. **Two parallel request-form templates and DUA templates**, sharing the same identity-tier and DUO-matching infrastructure but tuned to their respective audiences:
   - **Researcher form / DUA** — assumes publication-as-output. Asks IRB approval, project description, output type (`PUBLICATION` / `MODEL_WEIGHTS` / `DERIVATIVE_DATASET` / etc.), retention period.
   - **AI-builder form / DUA** — assumes product-as-output. Asks legal entity, deployment country / region, regulatory pathway (FDA 510(k) / De Novo / EU MDR class / national equivalent), WHO health-priority alignment, WHO Innovation Hub or national-MoH accreditation, royalty / commercialisation plan, post-market data flow.

   The form a requester sees is selected by their declared use category (`Commercial research` / `Product development` / `Clinical care` route to the builder template; `Non-commercial research` / `Educational` route to the researcher template). Both flows share the same back-end approval state machine and the same OCI Passport Visa issuance.

9. **Commercial-use terms encoded as machine-readable dataset metadata** so AI builders know ex-ante whether a dataset fits their deployment. Three bands:
   - `commercial OK` — dataset's host has explicitly granted commercial use, optionally with royalty terms by deployment market.
   - `non-commercial only` — DUO_0000046 is set; matcher returns CONFLICT for commercial requests.
   - `case-by-case` — host reviews per request, typically with bilateral negotiation on terms.

   GI-AI4H curated datasets are tagged `commercial OK` by default, with optional `royalty-free for LMIC public-sector deployment` clauses where the curating institution has set those terms (modelled loosely on GAVI / vaccine-pricing tiered-licensing precedent).

10. **Pre-grants for accredited LMIC actors** — a startup registered with the WHO Innovation Hub or accredited by a national MoH innovation programme can be pre-granted access to GI-AI4H curated datasets. The accreditation is recorded as a Visa-equivalent identity claim (`ResearcherStatus` extended with a `BuilderStatus` Visa Type — proposed extension to the GA4GH Visa vocabulary, raised as a discussion item in WG-Data); the dataset's `accessTier` rules honour it; the request collapses to a click-wrap.

The phased rollout is recorded below in _Consequences → Neutral_; this ADR commits to the architectural shape, not the dates.

## Consequences

### Positive

- **Federation works both ways from day one.** A researcher cleared at EGA brings their `ResearcherStatus` and `AffiliationAndRole` Visas to OCI, skipping our quiz. A researcher cleared by OCI is recognisable by Sage's Synapse-Passport platform when it lights up.
- **Cost model scales with usage, not with team size.** Pay-per-signature means CHF ~200/year for a typical 100-signature operator load. Versus DocuSign's $540/year per seat × N operators.
- **Click-wrap evidence is legally defensible today.** SHA-256 hash + timestamp + user sub + policy text is sufficient for SES under eIDAS and ESIGN/UETA — we don't need any external dependency for the common case.
- **Synapse-shape model means Sage can adopt our patterns** (or vice-versa) without translating between two different ontologies. We already collaborate; this strengthens the seam.
- **Identity-context normalizer absorbs heterogeneity.** Adding eduGAIN, W3C VCs, or whatever comes next is a new translator, not a schema change.
- **DUO matcher gets sharper.** Today it matches dataset DUO terms against checkbox attestations. With Visas, it can match against signed institutional claims (`AffiliationAndRole`, `ResearcherStatus`) — much higher signal.

### Negative

- **More moving parts in the auth path.** Verifying inbound Visas means trusting external JWKS (ELIXIR AAI, NIH RAS, Sage). Each issuer is a new failure mode — a JWKS rotation we miss, or a key compromise upstream — that can cascade into spurious 403s. Mitigation: cache JWKS aggressively, fail-open at the _trust_ layer (treat unverified Visas as absent, not invalid) but fail-closed at the _authz_ layer (no Visa = no access for that AR).
- **Signing infrastructure is non-trivial.** Running a JWKS endpoint with rotation, encoding Visas correctly per the GA4GH spec, mapping our internal authz decisions to the right Visa Types — this is a real engineering effort, not a checkbox. Skipping shortcuts here means Visas we issue are trusted incorrectly elsewhere.
- **Operator surface area grows.** OCI ACT review for SENSITIVE tier is a new review queue. We need an admin UI, escalation rules, and an SLA. UK Biobank's Access Sub-Committee operates a 10-day SLA — we likely cannot match that with a 1-2 person team initially.
- **Self-hosted DocuSeal is one more service to operate.** ECS service definition, S3 bucket for signed PDFs, KMS-CMK for at-rest encryption, scheduled DB backups. Manageable but real.
- **Quiz content is hard to author defensibly.** Synapse's quiz took years to refine. Our risk: shipping a weak quiz that gives false assurance. Mitigation: ask Sage if we can adopt theirs with attribution — partners-of-partners agreement.
- **DUA template requires legal review** before any e-sig integration. We can't ship this on engineering timelines alone.

### Neutral

- **Phased rollout** of the architectural commitment:

  **Phase 1 (this iteration, ~2 weeks, no SaaS)**:
  - Schema additions (`Dataset.accessTier`, `AccessRequest` extensions, `UserCertification`, `PolicyAcceptance`).
  - Email-domain checker (disposable blocklist + per-dataset allowlist) in `packages/shared-types`.
  - Certification quiz module (NestJS + Next.js, 1-year validity).
  - Click-wrap with SHA-256 hash storage (SES evidence).
  - Internal `RequesterIdentityContext` with native-only sources.

  **Phase 2 (1–3 months)**:
  - ORCID OAuth integration.
  - GA4GH Passport relying-party — accept Visas from ELIXIR AAI, NIH RAS, Sage broker.
  - OCI as Passport issuer — JWKS endpoint, sign our own `AcceptedTermsAndPolicies`, `ControlledAccessGrants`, `ResearcherStatus` Visas.
  - DocuSeal self-hosted for AdES DUA signing.
  - Renewal cron (BullMQ) — 30-day pre-expiry email, auto-revoke at expiry.

  **Phase 3 (6–12 months, gated on actual demand)**:
  - Skribble integration for QES, gated on `accessTier=SENSITIVE` AND policy says QES is required.
  - eduGAIN SP via SWITCHaai for direct EU-academic SAML SSO.
  - OCI ACT operator UI for `SENSITIVE` tier review.
  - Validated User flow (Synapse-style ID-document review) — only ship if a host actually demands it.
  - Track W3C Verifiable Credentials + EUDI Wallet for the eIDAS 2.0 transition (Nov 2026).

- **Existing `AccessRequest` rows are migrated forward** by setting `requesterIdentityScore = 'EMAIL_ONLY'` (default) and leaving `iduStatement` populated from the existing `justification` text. No backfill of stronger evidence — Phase 1 just makes the new shape available going forward.

- **The existing DUO matcher (PR J.1) does not change** for Phase 1. In Phase 2 it gets a richer input (ingested + OCI-issued Visas) but the same auto-MATCH/CONFLICT/UNCLEAR semantics.

## Alternatives considered

- **Stick with the current single-tier flow and add fields ad-hoc** — rejected. The current model is a Phase A floor we already know is too weak for the seeded `uhz-cardiac-mri-2024` PRIVATE fixture. Patching it without a coherent model means each future host pushes us in a different direction; we'd accumulate flags rather than design a system.

- **Adopt DocuSign as the e-signature canonical** — rejected on cost shape. DocuSign is per-seat / per-month with envelope quotas, optimised for sales-ops use cases (rep sends 100s of contracts/month). OCI's pattern is bursty and rare across a small operator team. Pay-per-signature QTSPs (Skribble, Yousign, Universign) are the right shape and _also_ eIDAS-conformant.

- **Build our own e-signature stack from scratch** — rejected. eIDAS QES requires a Qualified Trust Service Provider on the EU Trust List with a Qualified Signature Creation Device. We cannot become a QTSP in any reasonable timeframe, and we shouldn't try; this is the load-bearing reason to integrate one rather than build.

- **Defer Passport support to Phase 3 (the agent's original recommendation)** — rejected. Synapse's Passport rollout, ELIXIR AAI's existing Passport issuance, and NIH RAS's production Passport infrastructure mean the relying-party demand exists _now_. Late adoption means re-asking researchers questions they've answered elsewhere — a worse experience and a competitive disadvantage. Phase 2 (1-3 months) is the right insertion point.

- **Adopt W3C Verifiable Credentials + EUDI Wallet immediately** — rejected. Universities aren't issuing VCs at scale yet; the EUDI Wallet eIDAS 2.0 mandate hits Nov 2026 but issuance + reliance-party tooling is still maturing. Track, don't bet on.

- **Synapse-style separate platform-level ACT _only_ (no host approval)** — rejected. OCI's host-of-record model is a feature, not a bug — dataset hosts have direct accountability for their data. We add an OCI ACT for the `SENSITIVE` tier on top of host approval, not instead of it.

- **(Chosen) Two-axis tiered model + GA4GH Passport-native + pay-per-signature QTSPs.** Mirrors Synapse's proven architecture, scales cost with usage, federates with the field, lets us migrate forward without breaking existing approvals.

## References

- Research synthesis: [docs/research/access-governance-2026-05-08.md](../research/access-governance-2026-05-08.md)
- Existing access-request implementation: PR F ([#75](https://github.com/FG-AI4H/oci-platform/pull/75)), PR J.1 ([#93](https://github.com/FG-AI4H/oci-platform/pull/93)), PR L.3 ([#99](https://github.com/FG-AI4H/oci-platform/pull/99))
- Related modules: `apps/api/src/modules/access-request/`, `packages/croissant/src/duo/`, `apps/web/src/app/catalog/[slug]/access-cta.tsx`
- GA4GH Passport spec: https://ga4gh.github.io/data-security/ga4gh-passport
- GA4GH DUO product: https://www.ga4gh.org/product/data-use-ontology-duo/
- Synapse User Account Tiers: https://help.synapse.org/docs/User-Account-Tiers.2007072795.html
- eIDAS Regulation 910/2014, Article 25: https://digital-strategy.ec.europa.eu/en/policies/eidas-regulation
- Skribble (Swiss QTSP, ZertES + eIDAS QES): https://www.skribble.com/
- DocuSeal (self-hosted, MIT): https://www.docuseal.com/
- ORCID Affiliations admin guide: https://info.orcid.org/documentation/integration-guide/admin-guide-to-affiliations/
