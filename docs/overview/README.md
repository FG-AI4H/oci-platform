# Overview — Concept of the OCI

The Open Code Infrastructure (OCI) is **shared, open, public-good infrastructure** for the global health AI community — convened by ITU, WHO, and WIPO under the [Global Initiative on AI for Health (GI-AI4H)](https://aiforgood.itu.int/event/data-standards-for-health-ai-benchmarking-metadata-and-federated-data-discovery/).

It exists because health AI today suffers from three structural problems that no single country, hospital, or vendor can solve alone:

1. **Datasets are siloed.** Every research group has its own description format, access process, and licensing language. Data that _could_ improve outcomes globally stays invisible to everyone except the originating institution.
2. **Benchmarks aren't comparable.** A model evaluated on one dataset can't be honestly compared to a model evaluated on another, even when they ostensibly do the same task.
3. **Compliance is bespoke.** Every cross-border data-sharing agreement is rebuilt from scratch, slowing legitimate research and incentivising shortcuts.

The OCI is a **federated, standards-aligned platform** that addresses all three:

- A **Catalogue** of health datasets described in MLCommons Croissant 1.1 (a JSON-LD metadata standard with biomedical extensions).
- An **Access governance layer** built on GA4GH's Data Use Ontology — machine-checkable permissions, structured intended-use declarations, auto-matching, and a path to formal data-use agreements.
- An **Evaluation surface** (Phase C, in progress) for reproducible benchmarking against versioned manifest hashes.
- **Federation** so peer catalogues — hospitals, research consortia, member-state platforms — can be discovered through one surface without surrendering data sovereignty.

## Read these first

- [What is the OCI?](./what-is-oci.md) — concept, scope, what's in / out.
- [Why the OCI exists](./why-oci.md) — the problems it solves, the alternatives we considered.
- [Governance](./governance.md) — the ITU/WHO/WIPO mandate, working groups, decision-making.
- [Feature status](./feature-status.md) — what's shipped, what's in flight.
- [Glossary](./glossary.md) — domain terms (Croissant, DUO, DUA, IRB, Federation, etc.).
