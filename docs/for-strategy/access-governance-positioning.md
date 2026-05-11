# Access governance — strategic positioning

> **Read [overview/access-governance.md](../overview/access-governance.md) for the plain-English explainer.** This page is the strategy-audience view: what the architectural choices mean for OCI's standing in the field, the convening organisations' mandates, and the platform's running cost.

## The strategic question

Health AI's data bottleneck isn't a single problem. It's three:

1. **Findability** — which datasets exist, what they describe, who hosts them. _Solved by the catalogue layer (Croissant 1.1, federation, Google Dataset Search indexing)._
2. **Permission** — what is each dataset allowed to be used for, by whom, under what terms. _This is what the access-governance layer addresses._
3. **Reproducibility** — can a regulator or peer verify a model claim against a versioned dataset years later. _Solved by the evaluation-traceability layer (Phase C)._

The middle problem is the hardest because it's where law, ethics, institutional politics, and cryptography all meet. A platform that gets it wrong ends up either a glorified spreadsheet (no real access control) or an unusable bureaucracy (every request takes weeks). Synapse, EGA, dbGaP, and UK Biobank have all wrestled with this for over a decade. We can either reinvent the field's mistakes or stand on what the field has learned.

## Who this serves — the LMIC AI-builder mission

OCI is not just an academic-research catalogue. The platform's distinctive mandate under GI-AI4H is to **enable AI solutions for WHO public-health priorities, especially in low- and middle-income countries (LMICs)**. The data-access architecture therefore has to serve two equally first-class user populations:

- **Researchers** — academic, clinical, public-health. The traditional Synapse/EGA/dbGaP audience. They need rigorous access governance and citation-grade dataset versioning.
- **AI solution developers** — LMIC startups, MedTech vendors, academic spin-offs, WHO Collaborating Centres operating implementation projects. They need the _same_ governance rigour but with an access flow that doesn't assume a US R1 university affiliation, plus a Data Use Agreement that supports commercial deployment when the host has granted it.

Peer platforms (Synapse, EGA, dbGaP) skew strongly toward the first audience. Their default DUA language assumes academic non-commercial use. **OCI's distinctive value is that it serves both.** A Senegalese startup building a TB X-ray triage tool for Ministry-of-Health deployment, or a Brazilian MedTech company building a cervical-cancer-screening AI, or a Cambodian academic spin-off commercialising a malaria-classifier, should all be able to request and use OCI-curated datasets through a flow that takes their use case seriously — without first being routed to a US-style "non-commercial research use only" default that excludes them.

This isn't a softening of access governance. The matcher, the DUA, and the OCI ACT review apply equally. What changes is the _shape_ of the request form, the _language_ of the DUA template, and the _terms_ a host can offer (e.g. "commercial use OK for LMIC public-sector deployments, royalty-free; high-income-country deployment requires a separate negotiation"). The platform encodes these as machine-readable terms so that a commercial requester knows ex-ante whether their use case fits — no months of bilateral negotiation just to find out.

Concrete consequences for the architecture:

1. **Commercial use is a first-class identity context**, not a flag inside the researcher form. The request flow asks deployment country, regulatory pathway, WHO-priority alignment, and royalty terms — and these flow through to the DUA template and the host's review surface.
2. **DUO vocabulary used carefully.** `DUO_0000046` (Non-Commercial Use Only) is meaningful for _some_ datasets but is **not** the default for GI-AI4H curated content; `DUO_0000007` (Disease Specific) and the bare permission terms are typically the right defaults for curated, AI-development-targeted data.
3. **Path for accredited LMIC actors — a design exploration, not a delivered feature.** The platform is **architected** to recognise an entity-level accreditation as an identity-tier signal (a proposed `BuilderStatus` Visa Type extension to GA4GH Passport — see [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md) and [`#141`](https://github.com/FG-AI4H/oci-platform/issues/141)). **No accrediting body has yet been engaged** to confirm willingness to issue such credentials — WHO Innovation Hub, national MoH innovation programmes, and development-finance initiatives are all candidate issuers we'd need to approach through the right channels (GI-AI4H Joint Secretariat, member-state programmes). Until that engagement lands, any accreditation declared by a requester is free-text evidence the host weighs manually. This is the right architectural posture: we're ready to wire in the automation as soon as a real issuer is in place.
4. **The DUA template carries a "WHO public-health priorities" mode** with optional clauses for royalty-free LMIC public-sector deployment, modelled loosely on the GAVI / vaccine-pricing tiered-licensing precedent.

## The choice we made

OCI adopts a **two-axis tiered model with GA4GH Passport federation from day one** — codified in [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md):

- One axis is **identity** (email-only → verified institutional → ORCID-linked → quiz-passed → PI-countersigned → Passport-verified).
- The other axis is **dataset sensitivity tier** (OPEN → REGISTERED → CONTROLLED → SENSITIVE), with each tier declaring its own Access Requirements (click-wrap ToU, signed Data Use Agreement, qualified electronic signature, ethics review).

A requester needs enough identity evidence to satisfy what the dataset's tier demands. The platform brokers, the host approves, and OCI ACT (a GI-AI4H-appointed Access & Compliance Team) reviews the most sensitive cases.

## Why this positions OCI well

### Mirrors what works at peer institutions

This model is what Synapse (Sage Bionetworks — our partner) operates. Their tiered Certified User → Validated User identity model with stacked Access Requirements has proven itself across hundreds of regulated datasets over 15+ years. We are not innovating where innovation isn't required; we are adopting and re-implementing in our stack so partner institutions recognise the pattern instantly.

### Federates with the field's biggest archives

GA4GH (the Global Alliance for Genomics and Health) has converged the biomedical-data field on a standard called **Passports** — cryptographically-signed credentials that travel between platforms. Today, EGA (Europe), NIH dbGaP (US), and ELIXIR AAI all issue them; Synapse is on the roadmap. By becoming both a relying party (we accept Passports from peers) AND an issuer (we sign our own that other platforms can trust) from day one, OCI is a peer in the federation rather than an outsider that re-asks every researcher questions other platforms have already answered.

This is the key competitive positioning: **OCI as a peer to EGA / dbGaP / Synapse, not an island.**

### Standards-aligned across all three convening mandates

| Convening org   | Standards we honour                                                                                                        | How                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **ITU**         | GI-AI4H WG-Data Data and Model Exchange Protocol                                                                           | DUO + DUA + Passports operationalise the WG-Data architecture                                                                     |
| **WHO**         | WHO Ethics & Governance of AI for Health; WHO Health Data Governance Principles                                            | DUO encodes consent provisions; the IRB attestation flow operationalises ethics oversight; the audit trail satisfies transparency |
| **WIPO**        | Licensing as machine-readable dataset metadata                                                                             | Croissant `license` field + DUA preserves the licence chain through access                                                        |
| **EU**          | eIDAS Regulation 910/2014 for e-signatures; GDPR Art. 9 (special-category) and Art. 89 (research exemption) for processing | SES/AdES/QES tiers map to dataset sensitivity; DUA template bakes in Art. 89 language                                             |
| **Switzerland** | ZertES (Federal Act on Electronic Signature)                                                                               | Yousign QTSP covers eIDAS; ZertES alignment available via Skribble if a Swiss-only host needs it                                  |
| **US**          | ESIGN Act / UETA; NIH dbGaP Genomic Data Sharing Policy                                                                    | SES (click-wrap with hash) is sufficient; dbGaP Passport interop planned                                                          |

We stay aligned with all of these by adopting their standards directly, not by writing our own.

### Cost shape that fits a body-funded platform

The platform is convened by ITU, WHO, and WIPO and operates on body-funded budget. Per-seat SaaS subscriptions (DocuSign at ~$540/seat/year × N seats with envelope quotas) are the wrong cost shape for our usage pattern (rare, bursty signing across a small operator team).

Instead, OCI uses a **three-tier signing stack with usage-scaled cost**:

| Tier                                                | Service                                            | Cost shape              | Annual cost              |
| --------------------------------------------------- | -------------------------------------------------- | ----------------------- | ------------------------ |
| **SES** (most cases)                                | Built-in click-wrap with SHA-256 hash              | $0 marginal             | **$0**                   |
| **AdES** (CONTROLLED tier DUAs)                     | DocuSeal — open-source, self-hosted on AWS Fargate | ~$15/mo Fargate task    | **~$180**                |
| **QES** (SENSITIVE tier only, when policy requires) | Yousign EU QTSP via AWS Marketplace                | Pay-per-signature ~€1–2 | **~€150** at 100 sigs/yr |

Total expected annual signing cost at full Phase 3 deployment: **under €350**. This consolidates onto our existing AWS bill via AWS Marketplace — no separate vendor procurement. Compare to a single DocuSign Standard seat (the canonical industry choice) at $540/year — we'd exceed the entire signing budget on day one with one user.

### Vendor-lock-in resistance

Every layer has a swap-out path:

- **Identity**: Cognito today, eduGAIN tomorrow, Passport ecosystems indefinitely. The internal `RequesterIdentityContext` normalizer absorbs the change.
- **Signing**: DocuSeal and Yousign are independent — replacing either is a service-level change, not a re-architecture. If the EUDI Wallet (eIDAS 2.0, Nov 2026 mandate) becomes the dominant pattern, we add a translator.
- **Federation**: Passports are issued / consumed via standard JWT verification. New brokers (member-state AAI services as they emerge) plug in by adding their JWKS endpoint to our trust list.

This is deliberate: **standards over vendors.** Where a vendor relationship is genuinely needed (a QTSP for QES), we keep the integration thin and replaceable.

## Risks the steering body should be aware of

1. **Legal review of the DUA template is a prerequisite to any e-sig integration.** Engineering can scaffold; only legal can sign off on enforceability. Recommend tabling for the next steering meeting whether OCI adopts the GA4GH model DTUA verbatim or commissions our own.

2. **Tier mapping is policy, not code.** Which OCI dataset categories _require_ QES vs. AdES vs. SES is a steering-body call, not a developer call. The platform supports the choice; the choice itself needs the GI-AI4H Steering Committee on the line.

3. **Quiz content is hard to author defensibly.** Synapse's certification quiz took years to refine. Our risk is shipping a weak quiz that gives false assurance. **Recommended action:** ask Sage Bionetworks if we can adopt their quiz with attribution — partners-of-partners agreement, light to negotiate.

4. **OCI ACT staffing.** The platform-level Access & Compliance Team for SENSITIVE tier review needs a clear charter, an SLA, and at least 2 reviewers to start. UK Biobank's equivalent runs a 10-day SLA; we likely cannot match that with a smaller team initially. **Recommended action:** scope the OCI ACT as a chartered body of the GI-AI4H steering committee, with named reviewers from convening organisations.

5. **GA4GH Passport ecosystem maturity.** Passport issuance outside ELIXIR AAI and NIH RAS is still thin. Don't make Phase 3 a hard dependency on broad Passport adoption — keep our native flow as the primary, treat Passports as the upgrade.

6. **Vendor relationship with Sage Bionetworks** matters disproportionately. Partnership signals from Sage (joint integration work, mutual relying-party trust on Passport issuance, shared quiz content) translate directly into platform credibility for us. **Recommended action:** include access-governance integration in the next OCI–Sage technical sync.

## What this means for the budget

| Phase                     | Engineering                         | External spend                                       |
| ------------------------- | ----------------------------------- | ---------------------------------------------------- |
| **Phase 1 (~2 weeks)**    | 1 engineer                          | $0                                                   |
| **Phase 2 (1–3 months)**  | 1 engineer                          | DocuSeal infra ~$180/yr                              |
| **Phase 3 (6–12 months)** | 1 engineer + 0.25 ACT reviewer time | Yousign ~€150/yr at expected volume + DocuSeal infra |
| **Steady state**          | 0.25 engineer for maintenance       | < €400/yr total signature & infra                    |

Compared to acquiring an off-the-shelf SaaS solution (DocuSign + ID-verification add-ons + per-seat Adobe Sign for jurisdiction coverage), the OCI stack runs on roughly **3% of the canonical industry cost**, with no vendor lock-in.

## Recommended steering-committee actions

1. **Endorse [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md)** as the access-governance architectural commitment.
2. **Charter OCI ACT** as a body of the GI-AI4H Steering Committee, with named reviewers from at least one convening organisation.
3. **Mandate the legal review** of the DUA template ahead of Phase 2 e-signature integration.
4. **Decide tier mapping policy** — which OCI dataset categories require QES vs. AdES vs. SES — and document it in a steering-committee resolution that engineering can implement.
5. **Add access-governance integration to the OCI–Sage Bionetworks technical sync agenda.**

Items 2–5 are the path-clearing decisions that engineering cannot make alone. Item 1 is the architectural blessing that lets engineering proceed with confidence.

## Further reading

- [overview/access-governance.md](../overview/access-governance.md) — plain-English explainer
- [for-governance/duo-and-dua.md](../for-governance/duo-and-dua.md) — the policy-audience deep-dive
- [adr/0003-tiered-identity-assurance-and-access-requirements.md](../adr/0003-tiered-identity-assurance-and-access-requirements.md) — the architectural decision record
- `docs/research/access-governance-2026-05-08.md` _(internal companion repo)_ — the field-research synthesis that fed the ADR
- [for-strategy/alignment-with-mandates.md](./alignment-with-mandates.md) — broader ITU/WHO/WIPO mandate-fit context
