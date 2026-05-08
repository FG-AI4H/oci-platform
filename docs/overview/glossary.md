# Glossary

Domain terms used throughout the OCI documentation.

## Standards & ontologies

**Croissant** — JSON-LD metadata standard for ML-ready datasets, governed by [MLCommons](https://mlcommons.org/working-groups/data/croissant/). The OCI conforms to Croissant 1.1 (Feb 2026), which adds PROV-O provenance, ODRL usage policy, DUO consent codes, and an extensible vocabulary framework on top of the 1.0 base.

**BioCroissant** — Working group inside the Croissant ecosystem (co-led by MLCommons Medical WG and GI-AI4H WG-Data) defining health-and-life-sciences extensions to Croissant: imaging modality, anatomical region, IRB attestations, cohort characteristics, etc. Note: "BioCroissant" is the _team name_; the resulting vocabulary ships under the Croissant namespace.

**DUO — Data Use Ontology** — GA4GH-approved technical standard for expressing dataset-use permissions in ~30 machine-readable terms (e.g. `DUO_0000042` general research use). The OCI uses DUO to express what a dataset permits + what a requester intends. See [for-governance/duo-and-dua.md](../for-governance/duo-and-dua.md).

**ODRL — Open Digital Rights Language** — W3C standard for usage-policy expression. Croissant 1.1 carries ODRL alongside DUO; the OCI accepts but does not yet author ODRL policies (DUO covers the common cases).

**JSON-LD** — JSON for Linked Data, a W3C standard. Croissant manifests are JSON-LD documents.

**SHACL / RDF** — Shape Constraints Language / Resource Description Framework. Used by Croissant under the hood; the OCI doesn't expose them directly.

**Schema.org Dataset** — the schema.org vocabulary the catalogue uses for Google Dataset Search indexing.

**OBO — Open Biological and Biomedical Ontologies** — the foundry housing DUO and many of the biomedical ontologies BioCroissant references (UMLS, SNOMED CT, ICD, LOINC, MeSH).

## Roles

**Researcher / Participant** — someone who discovers and requests access to datasets to do work.

**Host / Dataset host** — the institution or individual that publishes a dataset on the catalogue. The host owns the data-use decision.

**Admin** — operator with override permissions on access decisions; assigned by the operator of an OCI instance, not the platform itself.

**Regulator** — auditor with read-only access to the audit trail; can verify a model's training-data claims against a manifest hash.

**Supervisor** — role used in evaluation challenges (Phase C); not yet implemented in the catalogue.

## Data-access concepts

**Visibility** — the dataset-level discoverability tier:

- `PUBLIC`: anyone can see it in the catalogue, anyone can pull `cr:dataUseTerms`-permitted distributions.
- `RESTRICTED`: visible in the catalogue; access requires an approved AccessRequest.
- `PRIVATE`: only the host and admins see it (used for drafts).

**Access Request** — a structured record of "researcher X wants to use dataset Y for purpose Z". The OCI captures intended use, IRB attestation, retention, redistribution intent, and output type. The host decides PENDING → APPROVED / DENIED.

**Auto-match** — the platform reduces (dataset DUO terms × requester DUO terms × intended use) to MATCHED / CONFLICT / UNCLEAR. The host inbox shows a badge + the matcher's explanations; CONFLICT is denial-by-default unless the host overrides; UNCLEAR triggers manual review.

**DUA — Data Use Agreement** — the formal contractual layer (PR J.2 territory). When a DUO term requires a formal agreement (`RTN`, `COL`, `MOR`, `US`/`PS`/`IS`), a DUA template is generated for countersigning. _Out of scope for J.1._

**DAC — Data Access Committee** — a governing body (often institution-level) that reviews access requests for sensitive datasets. The OCI supports DAC escalation as a configuration; details land with PR J.2.

**IRB — Institutional Review Board** — the ethics committee approving research that involves human subjects. The OCI captures the _fact_ of approval and the reference number; it does not perform IRB review.

**DPIA — Data Protection Impact Assessment** — required under GDPR for high-risk processing; the OCI surfaces the requester's DPIA reference for the host's record.

## Architecture

**Catalog** — the dataset registry; the API module is `apps/api/src/modules/catalog`.

**DAP — Dataset Access Package** — internal name for the catalogue + access-request slice (Phase B). Used in some commit messages and ADRs.

**Federation** — the OCI's mechanism for linking peer catalogues. A peer publishes `/.well-known/croissant-catalog.json`; the OCI's harvester ingests that index into a `RemoteDataset` table and surfaces the rows under `?source=federated`.

**Manifest** — synonym for "Croissant document". A manifest describes one dataset version.

**DMXP — Data and Model Exchange Protocol** — WG-Data's protocol the OCI implements.

**Fail-closed** — security default where, when in doubt, the answer is "no". For example: a non-PUBLIC dataset must declare DUO terms at publish time; if it doesn't, the publish is rejected rather than left undefined.

## Phase labels

- **Phase A**: Foundation. NestJS + Next.js + Cognito + CDK reproducible end-to-end in `dev`. _(Largely complete.)_
- **Phase B**: Catalog + access governance + annotation reactivation. _(In flight.)_
- **Phase C**: Evaluation surface (port from legacy Django). _(Planned.)_
- **Phase D**: Reporting & regulator portal. _(Planned.)_
- **Phase E**: DMXP v1.0, federation worker, MedEval-GI. _(Down-payment shipped; full rollout planned.)_

See [`docs/migration/strangler-plan.md`](../migration/strangler-plan.md) and [`docs/oci-milestones-2026-2027.md`](../oci-milestones-2026-2027.md) for the long-form plan.

## External references

- [GA4GH DUO](https://www.ga4gh.org/product/data-use-ontology-duo/) | [EBISPOT/DUO](https://github.com/EBISPOT/DUO) (the OWL ontology source)
- [MLCommons Croissant](https://docs.mlcommons.org/croissant/) | [Croissant 1.1 spec](https://docs.mlcommons.org/croissant/docs/croissant-spec.html)
- [W3C ODRL Information Model 2.2](https://www.w3.org/TR/odrl-model/)
- [Schema.org Dataset](https://schema.org/Dataset)
