# ADR-0002: Catalog metadata conformance — Croissant 1.1 + RAI + BIOCroissant v0.1

- **Status:** accepted
- **Date:** 2026-05-05
- **Deciders:** Marc Lecoultre, Mehdi Snene (GI-AI4H WG-Data lead)
- **Tags:** `area:platform` `package:DAP` `wg-data` `phase:B`

## Context

The OCI Platform catalog has to express enough about a health dataset that hosts can publish it, consumers can discover and assess it, regulators can audit it, and ML frameworks can load it. The relevant standards landscape as of 2026-05-05:

- **Croissant 1.0** (MLCommons, March 2024) — JSON-LD metadata format that pairs schema.org's `Dataset` with ML-specific concepts (`RecordSet`, `Field`, `DataSource`, `FileObject`/`FileSet`, splits, labels, bounding boxes, segmentation masks). Supported natively by HuggingFace, Kaggle, OpenML, TensorFlow, PyTorch, CKAN, Dataverse. ~700K datasets carry Croissant metadata today.
- **Croissant 1.1** (MLCommons, February 2026) — backwards-compatible delta over 1.0 adding (a) machine-actionable PROV-O provenance, (b) DUO consent vocabulary integration, (c) ODRL machine-actionable usage rules, (d) a 3-level vocabulary framework (dataset/field/value) for linking to external ontologies, (e) array semantics for fields. Designed to make datasets "agent-ready".
- **Croissant RAI** (sister extension, MLCommons) — 20 properties documenting collection, annotation procedure, demographics, biases, limitations, sensitive information.
- **BIOCroissant** — life-sciences extension referenced in GI-AI4H WG-Data work and the AI for Good "Data standards for health AI" event. **No public canonical specification exists yet** (verified 2026-05-05).

The catalog needs a clear conformance target so tooling (validators, the upload wizard, regulators' import pipelines) and downstream consumers (annotation, evaluation, reporting, federated discovery) all share one truth about what's in a manifest.

## Decision

The OCI catalog declares conformance to **Croissant 1.1** (`dct:conformsTo: http://mlcommons.org/croissant/1.1`) for new datasets, with **Croissant RAI** properties strongly encouraged on health datasets (and policy-required at host level — Phase B follow-up). The platform also publishes and validates a **BIOCroissant v0.1 draft** under provisional namespace `https://oci.ai4h.net/biocroissant/v0.1#`, with the explicit intent to migrate to the WG-Data canonical IRI when assigned.

The validator (`packages/croissant`) is layered (1.0 base / 1.1 deltas / RAI / BIOCroissant) so each layer can evolve independently and host policy can require any subset.

License metadata uses **SPDX identifiers** as the canonical vocabulary. Imaging modalities and disease conditions use **RadLex** (open licence) and **ICD-11** (open licence) by default, deferring SNOMED CT (UMLS-restricted) to Phase E if and when it's needed for clinical-system interoperability. Anonymisation is expressed on a HIPAA-aligned 4-level scale (`IDENTIFIED` / `LIMITED` / `DEIDENTIFIED` / `ANONYMIZED`), with GDPR-aligned mappings (`DEIDENTIFIED` ≈ pseudonymised, `ANONYMIZED` ≈ anonymised) provided as guidance.

## Consequences

### Positive

- **Interoperability for free.** HuggingFace, Kaggle, OpenML, CKAN, Dataverse, TensorFlow Datasets, and PyTorch's data tooling can already consume a Croissant 1.1 manifest. OCI datasets become discoverable in the broader ML ecosystem with no extra mapping work.
- **Forward-compatible with agentic discovery.** 1.1's PROV-O + ODRL + DUO baseline is what MLCommons has explicitly designed for autonomous-agent use; that's the direction federated discovery is heading.
- **Regulator-grade audit trail by default.** RAI's `dataCollection`, `dataCollectionTimeframe`, `dataAnnotationProtocol`, `annotatorDemographics`, `dataBiases`, `dataLimitations`, `personalSensitiveInformation` cover the substance of what FDA-CDRH, MHRA, and EU-MDR notified bodies expect to see in an algorithm submission. Hosts who fill them in once benefit on every downstream evaluation and report.
- **BIOCroissant v0.1 is real, not aspirational.** Validators ship in PR A; hosts can start authoring against it on dev tomorrow. We get implementation feedback before WG-Data finalises a canonical spec and can co-author from a position of working code.

### Negative

- **BIOCroissant v0.1 is provisional.** When WG-Data assigns a canonical IRI we'll need to migrate manifests (`bio:` namespace IRI changes; field names should not). The migration is mechanical but disruptive enough that we own the redirect from `https://oci.ai4h.net/biocroissant/v0.1#` to whatever WG-Data chooses, so tooling that resolves the namespace IRI keeps working without re-validation.
- **Vocabulary lookups are out of scope for v0.1.** The validator checks IRI shape (`@id`, `inDefinedTermSet`, `termCode`) but does not call back to RadLex / ICD-11 to verify the term exists. Hosts can therefore type a plausible-looking RadLex CID for a non-existent term. Phase B may add a vocabulary-resolution service if false-term entries become a real problem.
- **No JSON-LD `@context` expansion.** The validator's normalizer recognises a fixed prefix list (`sc:`, `cr:`, `rai:`, `prov:`, `odrl:`, `dct:`, `foaf:`, `duo:`, `bio:`); manifests with custom `@context` aliases will fail validation against the layered Zod schemas. We accept this: every Croissant manifest in the wild uses the standard prefixes, and bringing in `jsonld.js` (~600 KB minified, with its own Node-vs-browser quirks) is more cost than benefit until a real-world failure forces our hand.
- **Inhomogeneous coverage of ontologies.** RadLex covers imaging well but is silent on lab values, histopathology, and multi-omics; ICD-11 covers diseases but not procedures. Datasets in the long-tail will end up with mixed vocabulary references. We document this explicitly — the v0.1 draft does not pretend to be exhaustive.

### Neutral

- The validator is layered into separate Zod schemas (1.0, 1.1 deltas, RAI, BIOCroissant) that compose at validate time. Adding a future layer (e.g. a Croissant 2.0 when it appears, or a regional health profile from FG-AI4H) is a matter of adding one schema file and one detection branch.
- The catalog's database stores only the manifest JSONB plus a few derived columns (slug, visibility, conformance version). Manifest content is the source of truth for everything else; no schema migration is needed when BIOCroissant v0.1 → v1.0 happens.

## Alternatives considered

- **Pin Croissant 1.0 only, add BIOCroissant later.** Rejected: locks us out of PROV-O / DUO / ODRL just as the broader ecosystem moves to 1.1, and the deltas are backwards-compatible — there's no upgrade pain.
- **Define our own JSON-Schema metadata format from scratch.** Rejected: forfeits the ~700K-dataset interoperability story and burdens every consumer with custom translation layers. Croissant + extensions gets us 95% of what a custom schema would have, with everyone else's tooling for free.
- **Wait for WG-Data to publish BIOCroissant v1.0 before validating health-specific fields.** Rejected: the catalog needs to ingest health datasets _now_ for Phase B annotation work; a v0.1 draft we can iterate is less risky than a frozen catalog. The provisional namespace gives us a clear migration story.
- **Use SNOMED CT as the imaging/disease vocabulary.** Rejected for v0.1: SNOMED CT requires a UMLS account for everyone who handles a manifest (programmatic readers, regulators outside member-country licensing). RadLex + ICD-11 are open-licence and cover ~90% of what OCI initially needs. Phase E may revisit for clinical-system interop where SNOMED is unavoidable.

## References

- [Croissant 1.0 Specification](https://docs.mlcommons.org/croissant/docs/croissant-spec.html)
- [What's New in Croissant 1.1 — MLCommons (Feb 2026)](https://mlcommons.org/2026/02/croissant-1-1-standard/)
- [Croissant 1.1 spec source](https://raw.githubusercontent.com/mlcommons/croissant/main/docs/croissant-spec-1.1.md)
- [Croissant Responsible AI extension](https://raw.githubusercontent.com/mlcommons/croissant/main/docs/croissant-rai-spec.md)
- [Data standards for health AI — AI for Good event (BIOCroissant context)](https://aiforgood.itu.int/event/data-standards-for-health-ai-benchmarking-metadata-and-federated-data-discovery/)
- [SPDX licence list](https://spdx.org/licenses/)
- [RadLex playbook](https://radlex.org/)
- [ICD-11 (open release)](https://icd.who.int/)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [DUO — Data Use Ontology](https://github.com/EBISPOT/DUO)
- [W3C ODRL](https://www.w3.org/TR/odrl-model/)
