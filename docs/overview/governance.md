# Governance

The OCI Platform operates under the **Global Initiative on AI for Health (GI-AI4H)** — a joint UN initiative led by the International Telecommunication Union (ITU), the World Health Organization (WHO), and the World Intellectual Property Organization (WIPO).

## Governance structure

```
   ┌────────────────────────────────────────────────────────────────┐
   │                     Steering Committee                          │
   │              Senior representatives — ITU + WHO + WIPO          │
   └──────────────────────────────┬──────────────────────────────────┘
                                  │
   ┌──────────────────────────────┴──────────────────────────────────┐
   │                       Joint Secretariat                          │
   │              Operational coordination across the three           │
   └──────┬─────────────────────┬────────────────────────────────────┘
          │                     │
   ┌──────▼──────────┐    ┌─────▼─────────┐   ┌─────────────────────┐
   │ Working Groups  │    │ Topic Groups  │   │ Facilitation Groups │
   │ (cross-cutting) │    │ (per domain)  │   │ (stakeholder net.)  │
   └─────────────────┘    └───────────────┘   └─────────────────────┘
```

### Working Groups

Cross-cutting themes:

- **WG-Regulatory considerations** — regulatory science, AI/ML medical-device frameworks.
- **WG-Ethics & governance** — consent, equity, transparency, bias.
- **WG-Data** _(this is where the OCI lives)_ — data standards, access protocols, federation.
- **WG-Evaluation** — benchmarking methodology, reproducibility.
- **WG-Intellectual property & innovation** — licensing, attribution, public-domain pathways.

### Topic Groups (current)

- Traditional medicine ✓
- Maternal & reproductive health
- Point-of-care / primary health care
- Oral health _(on hold)_

## Where the OCI sits

The OCI is operated under **WG-Data** as the implementation of the **Data and Model Exchange Protocol (DMXP)**. WG-Data sets the protocol; the OCI ships the running infrastructure. WG-Data's stated objectives:

- **G1**: Dataset metadata standardisation and basic matchmaking. _(OCI catalogue + Croissant 1.1 = G1.)_
- **G2**: Searchable, ontology-linked index of health datasets. _(OCI federation + DUO = G2.)_
- **G3**: Secure transaction protocols (authentication, licensing, access control). _(OCI access governance + DUO matcher = G3 in progress; DUA generation in PR J.2 closes the licensing piece.)_
- **G4**: Federated testing environments and real-world pilots. _(WG-Evaluation surface, cross-linked from OCI; Phase C.)_

## Decision-making

| Decision class                                                                              | Who decides                                                       | Recorded where                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Cross-cutting architecture / pattern** (auth model, validation pattern, error envelope)   | OCI maintainers + WG-Data lead, with notice to Steering Committee | [`docs/adr/`](../adr/)                                                                                    |
| **Operational** (deploy gates, security baseline, dependency upgrades)                      | OCI maintainers                                                   | Pull-request review trail; CHANGELOG.                                                                     |
| **Standards alignment** (which version of Croissant; which DUO terms to surface)            | WG-Data, in coordination with MLCommons / GA4GH where applicable  | ADR + change in `@oci/croissant`.                                                                         |
| **Compliance posture** (what jurisdictions are supported, what audit artefacts are emitted) | WG-Ethics & governance + Steering Committee                       | [`docs/for-governance/compliance.md`](../for-governance/compliance.md) and per-environment runbooks.      |
| **Roadmap & prioritisation** (which Phase ships first, which Topic Group is supported)      | Steering Committee, advised by Joint Secretariat                  | [`docs/oci-milestones-2026-2027.md`](../oci-milestones-2026-2027.md) and the public GitHub Project board. |

## Operating principles

1. **Open by default.** Source code on GitHub, public-domain or permissive licensing on infrastructure code, OSI-approved licences on dataset metadata. Closed components require explicit Steering-Committee justification.
2. **Standards-aligned, not standards-inventing.** Croissant 1.1, DUO, ODRL, OBO-style biomedical ontologies. The OCI extends standards through their working groups (BioCroissant via MLCommons + GA4GH); it doesn't fork them.
3. **Federation over centralisation.** Member-state and regional instances are first-class. Data-residency requirements are a configuration, not a fork.
4. **Public-good economics.** Free at the point of use; operating costs covered through GI-AI4H multilateral funding + voluntary infrastructure sponsorship from member states. No paid tiers.
5. **Auditable by design.** Every access decision, every dataset version, every model evaluation is recorded with an immutable hash trail. Regulators get read access on request.

## Intellectual property posture

- **Platform code**: open-source (the LICENSE file in this repository is authoritative).
- **Dataset metadata**: typically CC0 or CC-BY-4.0 — set by the host on the manifest's `license` field.
- **Dataset bytes**: governed by the host's own licensing; the OCI surfaces but does not override.
- **Standards and ontologies the platform consumes**: each carries its own licence (Croissant: CC-BY-4.0; DUO: CC-BY-4.0).
- **Contributions** (code, docs, ADRs): the project's standard contribution licence applies (see CONTRIBUTING — TODO link when finalised).

## Reference documents

- [GI-AI4H AI for Good webinar — Data Standards for Health AI (March 2026)](https://aiforgood.itu.int/event/data-standards-for-health-ai-benchmarking-metadata-and-federated-data-discovery/)
- [`docs/WG-Data_Terms_of_Reference.docx`](../WG-Data_Terms_of_Reference.docx) — formal WG-Data ToR.
- [`docs/oci-milestones-2026-2027.md`](../oci-milestones-2026-2027.md) — published milestone plan.
- [`docs/platform-modernization-assessment.md`](../platform-modernization-assessment.md) — the strategy doc that drove the current architecture.
