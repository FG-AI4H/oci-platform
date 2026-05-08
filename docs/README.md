# OCI Platform documentation

The Open Code Infrastructure (OCI) Platform is a global public good, convened by the **ITU/WHO/WIPO Global Initiative on AI for Health (GI-AI4H)**, that provides shared infrastructure for cataloguing, governing, and benchmarking health datasets and AI models.

This documentation is organised by **audience**. Pick the entry point that matches who you are:

| Audience | What you'll find | Start here |
| --- | --- | --- |
| 🌍 **Anyone** — what is the OCI? | Concept, mandate, governance, glossary | [Overview](./overview/README.md) |
| 🔬 **Researcher / Data consumer** | Find datasets, request access, use the data | [For researchers](./for-researchers/README.md) |
| 🏥 **Dataset host** | Publish a dataset, upload files, review access requests | [For hosts](./for-hosts/README.md) |
| 💻 **Developer / Integrator** | API, Croissant manifest, local setup, contribution | [For developers](./for-developers/README.md) |
| ⚙️ **Operator / SRE** | Deployment, runbooks, security baseline | [For operators](./for-operators/README.md) |
| 🏛️ **Member-state / Regulator / DPO** | Sovereignty, compliance, DUO/DUA framework, audit | [For governance](./for-governance/README.md) |
| 🎯 **ITU/WHO/WIPO management** | Strategic overview, mandate alignment, adoption | [For strategy](./for-strategy/README.md) |

## Conventions

- Each audience folder has a **README** that's the index, plus topic pages.
- Cross-cutting reference material (architecture, security, ADRs) lives at the repository root under `docs/` and is linked from the relevant audience pages — read once, referenced often.
- We use [Architecture Decision Records](./adr/) for decisions that change a workstream-wide concern.
- Doc updates are part of the **definition of done** for every shipped feature — see the orchestrator skill at `.claude/skills/oci-fullstack-feature-scaffold/`.

## What's shipped today

The platform is in **Phase A → B** transition (catalog + access governance). See [overview/feature-status.md](./overview/feature-status.md) for the live capability matrix.

## External references

- [GI-AI4H AI for Good webinar — Data Standards for Health AI (March 2026)](https://aiforgood.itu.int/event/data-standards-for-health-ai-benchmarking-metadata-and-federated-data-discovery/)
- [MLCommons Croissant 1.1](https://mlcommons.org/2026/02/croissant-1-1-standard/) — the metadata standard the catalogue conforms to.
- [GA4GH Data Use Ontology (DUO)](https://www.ga4gh.org/product/data-use-ontology-duo/) — the access-control vocabulary.
