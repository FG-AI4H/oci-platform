# Alignment with mandates

The OCI is the operational arm of GI-AI4H's WG-Data. This page maps the platform's deliverables to:

- GI-AI4H's working groups and topic groups.
- Each convening organisation's strategic mandate (ITU, WHO, WIPO).
- UN Sustainable Development Goals (SDGs).

## GI-AI4H working groups

| Working group                    | OCI's contribution                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WG-Data** _(operational home)_ | Implements the Data and Model Exchange Protocol (DMXP). Catalogue + access governance + federation = WG-Data G1–G3.                                                          |
| **WG-Ethics & governance**       | Operationalises ethics guidance via DUO consent codes + IRB attestations + audit trail. WG-Ethics ratifies the platform's compliance posture.                                |
| **WG-Regulatory considerations** | Audit trail + immutable version hashes support regulator workflows (Phase D). The platform doesn't replace regulator review; it makes it tractable.                          |
| **WG-Evaluation**                | Catalogue feeds dataset selection for benchmarking challenges. Phase C ports the legacy evaluation engine into the OCI's evaluation surface.                                 |
| **WG-IP & innovation**           | Surfaces dataset licences + attribution + citation metadata (Croissant `license`, `creator`, `citeAs`). Supports IP-aware AI development; cross-references WIPO's interests. |

## GI-AI4H topic groups

Topic groups (per-domain) consume OCI infrastructure rather than build it:

- **Traditional medicine** ✓ — adopted, dataset onboarding in flight.
- **Maternal & reproductive health** — engagement starting; first datasets pipelined.
- **Point-of-care / primary health care** — engagement starting.
- **Oral health** — currently on hold.

The OCI's federation model means topic groups can run their own instances if jurisdictional or operational reasons require it; they federate with the global instance for discovery.

## ITU mandate alignment

| ITU strategic theme                          | How the OCI contributes                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI for Good**                              | OCI is a flagship deliverable of the AI for Good portfolio for health AI.                                                                                                                                                      |
| **Bridging the digital divide**              | Federation lets member states with constrained infrastructure participate as peers, not consumers. The audit-trail + DUO framework lowers the cross-border-access cost — disproportionately benefiting under-resourced groups. |
| **Standards (ITU-T)**                        | Croissant 1.1 + DUO + ODRL — standards consumption + contribution back through MLCommons / GA4GH. The OCI is a reference implementation.                                                                                       |
| **Connectivity for sustainable development** | Health AI built on accessible data is a multiplier for connectivity-driven health outcomes.                                                                                                                                    |

## WHO mandate alignment

| WHO strategic theme                                        | How the OCI contributes                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Health Data Governance Principles** (WHO 2021)           | DUO consent codes encode core principles in machine-readable form. The audit trail operationalises transparency.                 |
| **Ethics and Governance of AI for Health** (WHO 2021/2024) | Structured intended-use + IRB attestations + DAC escalation (PR J.2) operationalise the ethics guidance.                         |
| **Digital health roadmaps** (WHO regional offices)         | Member states stand up regional OCI instances with regionally-pinned residency; federate with the global instance for discovery. |
| **Pandemic preparedness**                                  | Audit-grade dataset traceability supports rapid surveillance + benchmarking when an emergency requires verified-source data.     |

## WIPO mandate alignment

| WIPO strategic theme          | How the OCI contributes                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **AI and IP policy**          | Croissant manifests carry `cr:license`, `creator`, `citeAs`. The OCI surfaces these explicitly so AI training pipelines can honour them. |
| **Standards for IP-aware AI** | Dataset licences are first-class metadata. Compositional licensing (a model trained on data with mixed licences) is auditable.           |
| **Access to knowledge**       | Public-domain and open-licensed datasets are surfaced alongside restricted ones, with the licence rendered prominently.                  |

## UN Sustainable Development Goals

The OCI most directly contributes to:

- **SDG 3 — Good Health and Well-being.** Health-AI data made findable, lawfully usable, and reproducible widens the geographic + institutional base for health-AI development.
- **SDG 9 — Industry, Innovation, Infrastructure.** The platform itself is a piece of public-good infrastructure; standards-alignment encourages compatible national/regional infrastructure.
- **SDG 10 — Reduced Inequalities.** Lowering the cost of finding + lawfully using data disproportionately helps under-resourced researchers and institutions.
- **SDG 17 — Partnerships for the Goals.** A multilateral, federated, open-source platform is the partnership archetype the SDG envisions.

## Reference deliverables

- **WG-Data Terms of Reference** (formal): [`docs/WG-Data_Terms_of_Reference.docx`](../WG-Data_Terms_of_Reference.docx).
- **GitHub Project board** (live roadmap): [FG-AI4H/projects/3](https://github.com/orgs/FG-AI4H/projects/3).
- **Architecture Decision Records**: [`docs/adr/`](../adr/) — the foundational choices that drove the architecture.
- **AI for Good webinar — March 2026**: [Data Standards for Health AI: Benchmarking, Metadata and Federated Data Discovery](https://aiforgood.itu.int/event/data-standards-for-health-ai-benchmarking-metadata-and-federated-data-discovery/).
