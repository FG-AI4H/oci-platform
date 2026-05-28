# OCI Platform documentation

The Open Code Infrastructure (OCI) Platform is a global public good, convened by the **ITU/WHO/WIPO Global Initiative on AI for Health (GI-AI4H)**, that provides shared infrastructure for cataloguing, governing, and benchmarking health datasets and AI models.

This documentation is organised by **audience**. Pick the entry point that matches who you are:

| Audience                               | What you'll find                                                                                                             | Start here                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 🌍 **Anyone** — what is the OCI?       | Concept, mandate, governance, glossary                                                                                       | [Overview](./overview/README.md)               |
| 🔬 **Researcher**                      | Academic / clinical research; find datasets, request access, use the data, cite versions for publication                     | [For researchers](./for-researchers/README.md) |
| 🚀 **AI solution developer**           | LMIC startup, MedTech vendor, academic spin-off, WHO Collaborating Centre — building deployable AI for WHO health priorities | [For AI builders](./for-ai-builders/README.md) |
| 🏥 **Dataset host**                    | Publish a dataset, upload files, review access requests                                                                      | [For hosts](./for-hosts/README.md)             |
| 💻 **Platform developer / Integrator** | API, Croissant manifest, local setup, contribution                                                                           | [For developers](./for-developers/README.md)   |
| ✍️ **Annotator**                       | Labelling tasks for an OCI campaign: claim, instructions ack, submit, 3-gate workflow, rights & licensing                    | [For annotators](./for-annotators/README.md)   |
| ⚙️ **Operator / SRE**                  | Deployment, runbooks, security baseline                                                                                      | [For operators](./for-operators/README.md)     |
| 🏛️ **Member-state / Regulator / DPO**  | Sovereignty, compliance, DUO/DUA framework, audit                                                                            | [For governance](./for-governance/README.md)   |
| 🎯 **ITU/WHO/WIPO management**         | Strategic overview, mandate alignment, adoption                                                                              | [For strategy](./for-strategy/README.md)       |

> **Two audiences consume the data, not one.** Researchers and AI solution developers use the same catalogue and the same access-governance machinery, but the request form, the Data Use Agreement template, and the routing rules differ. If you're not sure which audience you fit, read the [access-governance overview](./overview/access-governance.md) — it has both flows side-by-side.

## Conventions

- Each audience folder has a **README** that's the index, plus topic pages.
- Cross-cutting reference material (architecture, security, ADRs) lives at the repository root under `docs/` and is linked from the relevant audience pages — read once, referenced often.
- We use [Architecture Decision Records](./adr/) for decisions that change a workstream-wide concern.
- Doc updates are part of the **definition of done** for every shipped feature.

## What's shipped today

The platform is in **Phase A → B** transition (catalog + access governance). See [overview/feature-status.md](./overview/feature-status.md) for the live capability matrix.

## External references

- [GI-AI4H AI for Good webinar — Data Standards for Health AI (March 2026)](https://aiforgood.itu.int/event/data-standards-for-health-ai-benchmarking-metadata-and-federated-data-discovery/)
- [MLCommons Croissant 1.1](https://mlcommons.org/2026/02/croissant-1-1-standard/) — the metadata standard the catalogue conforms to.
- [GA4GH Data Use Ontology (DUO)](https://www.ga4gh.org/product/data-use-ontology-duo/) — the access-control vocabulary.
