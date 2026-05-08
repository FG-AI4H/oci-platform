# DUO and DUA — the access-control framework

> **For the plain-English overview, including the tiered access model, identity layers, and e-signature levels, read [overview/access-governance.md](../overview/access-governance.md) first.** This page is the governance-audience deep-dive on DUO and DUA specifically.

The OCI's access-control surface is built on three composable layers — codified in [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md):

1. **Identity tier** — _who you are_. Email-only → verified institutional email → ORCID-linked → Quiz-passed → PI-countersigned → GA4GH-Passport-verified. Stronger identity unlocks more sensitive datasets.
2. **DUO (Data Use Ontology)** — machine-readable expressions of what a dataset _permits_ and what a requester _intends_. GA4GH-approved technical standard. **Live today (PR J.1).**
3. **DUA (Data Use Agreement)** — the formal contractual artefact, signed at one of three eIDAS levels (SES → AdES → QES). **Phase 2 (DocuSeal AdES) and Phase 3 (Skribble QES).**

Together they cover the access spectrum from "anyone can use it for anything" (`NRES` + click-through) to "only this named institution may use it for this named project after signing a bespoke agreement" (`US`/`PS`/`IS` + QES-signed DUA + PI countersignature).

## Layer 1 — DUO

DUO is a vocabulary of ~30 terms. The OCI's matcher recognises 16 of them — the ones that meaningfully change the host's review workload.

### The three categories of DUO term

**Permissions** — what the dataset is _for_. A dataset typically declares one.

- `GRU` (general research use), `HMB` (health/medical/biomedical), `DS` (disease-specific), `POA` (population/ancestry only), `NRES` (no restriction).

**Restrictions** — additional narrowing.

- `NCU` (non-commercial only), `NPUNCU` (non-profit non-commercial only), `GSO` (genetic studies only).

**Modifiers** — duties or constraints on the requester.

- `IRB` (ethics approval required), `PUB` (publication required), `COL` (collaboration required), `MOR` (publication moratorium), `RTN` (return derivatives), `US`/`PS`/`IS` (user/project/institution-specific).

The OCI's machine-readable subset is curated for tractability — adding terms is a code change in `packages/croissant/src/duo/registry.ts`. Manifests can declare any DUO term; unknown ones are silently dropped from the matcher's input (no implicit permission).

### How matching works

When a researcher submits an access request:

1. The platform reduces the requester's `intendedUseCategory` (Non-commercial / Commercial / Clinical care / Education) to a coverage check against the dataset's permission terms.
2. It checks restrictions: commercial intent vs `NCU`, etc.
3. It checks modifier preconditions: `IRB` requires `irbApproved=true` on the request.
4. It flags formal-agreement modifiers (`RTN`, `COL`, `MOR`, `US`/`PS`/`IS`) as UNCLEAR — they need a DUA.

Result: **MATCHED** / **CONFLICT** / **UNCLEAR**, with explanations the host inbox renders verbatim.

The matcher is **conservative**. Anything not provably matched is UNCLEAR — the platform won't auto-rubber-stamp a request the host should review.

The full matrix is in [for-hosts/duo-terms-guide.md](../for-hosts/duo-terms-guide.md) (host-facing) and [for-researchers/requesting-access.md](../for-researchers/requesting-access.md) (requester-facing).

### What DUO doesn't cover

DUO is a **vocabulary**, not a contract. It can express that "this dataset requires an IRB approval and is non-commercial only", but it cannot:

- Bind the requester legally — a DUA is needed for that.
- Express bespoke clauses (jurisdiction-specific liability, indemnification, governing law).
- Specify the consequences of misuse — those go in the DUA + the operator's terms of service.

For datasets where these matter, DUO terms with a formal-agreement modifier (`RTN`, `COL`, etc.) signal "this needs a DUA". The OCI flags these for the host; the DUA itself is the contract.

## Layer 3 — DUA _(planned, ADR-0003 Phase 2 + Phase 3)_

When the DUA layer ships, the platform will:

1. **Generate** a DUA from a template, parameterised by the dataset's DUO terms, the host's institution, and the requester's declared intended use.
2. **Capture countersigning** at the eIDAS level the dataset's tier requires:
   - **CONTROLLED tier → AdES** via [DocuSeal](https://www.docuseal.com/), an open-source e-signature service self-hosted in our existing AWS Fargate cluster. Identity-verified, tamper-evident, free beyond infra (~$15/mo Fargate task).
   - **SENSITIVE tier → QES** via [Yousign](https://yousign.com/), an EU Qualified Trust Service Provider on the EU Trust List, procured through **AWS Marketplace** so the QES bill consolidates onto our existing AWS account. Pay-per-signature (~€1–2 each, no minimum). Equivalent to a handwritten signature under eIDAS Article 25.
3. **Require an institutional Signing Official / PI** for CONTROLLED+ tiers — someone other than the requester at their institution who countersigns. (Synapse's policy verbatim: _"you cannot serve as your own signing official"_.)
4. **Persist** the signed DUA + signature certificate as an immutable artefact tied to the access-request row.
5. **Optionally route** to OCI ACT (the platform-level Access & Compliance Team — an ITU/WHO-appointed body) when the dataset is SENSITIVE tier or when DUO terms require multi-member review.
6. **Surface** to regulators in the audit trail (read-only).

The template surface is configurable per operator. The defaults will draw from:

- GA4GH's model Data Access Agreement.
- WHO Health Data Governance Principles.
- Jurisdiction-specific clauses where the operator pins them in (GDPR Art 89 research exemption, HIPAA business-associate language, etc.).

We deliberately did **not** adopt DocuSign or Adobe Sign as the canonical e-signature stack — both are per-seat / per-month with envelope quotas, optimised for sales-ops use cases. OCI's pattern (rare, bursty signing across a small operator team) is wrong for that model. Pay-per-signature QTSPs cost ~€150/year at expected volume vs. ~$5,000/year per DocuSign seat. AWS itself does not offer a first-party eIDAS signature service (AWS Signer is for code, not documents). See [ADR-0003 § Alternatives considered](../adr/0003-tiered-identity-assurance-and-access-requirements.md#alternatives-considered).

Until the DUA layer ships, hosts handle DUAs out-of-band and reference them in decision notes. The audit trail records the reference; the artefact lives in the host's institutional document store.

## Layer 4 — Federation via GA4GH Passports _(planned, ADR-0003 Phase 2)_

Above DUO and DUA sits the **federation layer**: OCI as both a relying party for and an issuer of [GA4GH Passports](https://ga4gh.github.io/data-security/ga4gh-passport).

- **Relying party**: OCI verifies Passport JWTs from trusted brokers (ELIXIR AAI in Europe, NIH RAS in the US, the planned Sage broker for Synapse). A researcher who has already been vetted by EGA arrives with a `ResearcherStatus` Visa and an `AffiliationAndRole` Visa from their home institution; OCI honours those and skips its own quiz.
- **Issuer**: OCI signs its own Visas — `AcceptedTermsAndPolicies` for accepted ToU, `ControlledAccessGrants` for approved dataset access, `ResearcherStatus` for quiz-passed users. Other GA4GH-conformant platforms can verify these against our published JWKS endpoint and trust our approvals for shared researchers.

This makes OCI a peer to EGA, dbGaP, and Synapse rather than an island that re-asks every researcher questions other platforms have already answered. It also positions OCI to interoperate with EUDI Wallet and W3C Verifiable Credentials when those mature (eIDAS 2.0 mandate, Nov 2026).

## Why this layered approach

- **DUO does the easy 80%.** Most access decisions are mechanical: matched intent + valid IRB + standard retention = approve. The matcher reduces this to a click for the host.
- **DUA covers the hard 20%.** Bespoke agreements with bespoke signatures, but only when the dataset's terms actually require them. The matcher's UNCLEAR flag is the entry point to this layer.
- **Standards-aligned.** DUO is GA4GH's standard; we don't fork. ODRL (also Croissant-1.1-supported) gives us a richer policy expression layer if and when DUO proves insufficient.
- **Globally interpretable.** A `DUO_0000042` tag means the same thing on the global OCI instance, on a member-state instance, and on a peer Croissant catalogue at MLCommons. A bespoke "this is for non-commercial use" string in a PDF doesn't.

## Reference

- [GA4GH DUO standard](https://www.ga4gh.org/product/data-use-ontology-duo/) | [EBISPOT/DUO source](https://github.com/EBISPOT/DUO)
- [GA4GH model Data Access Agreement (TODO link to specific GA4GH product)](https://www.ga4gh.org/)
- [Pandit & Esteves (2024) — Enhancing DUO with ODRL and DPV](https://doi.org/10.3233/sw-243583)
- [`packages/croissant/src/duo/registry.ts`](../../packages/croissant/src/duo/registry.ts) — the platform's DUO term registry.
- [`apps/api/src/modules/access-request/duo-matcher.ts`](../../apps/api/src/modules/access-request/duo-matcher.ts) — the matcher implementation.
