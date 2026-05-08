# What is the OCI?

The **Open Code Infrastructure (OCI)** is a global, open-source, public-good platform that lets:

- **Researchers** discover, request, and use health datasets that are usually invisible across institutional and national boundaries.
- **Dataset hosts** publish their data with machine-readable metadata + machine-checkable access policies, without giving up sovereignty over where the bytes live.
- **Regulators and auditors** trace which model was trained on which version of which dataset, with a permanent record.
- **Member states** federate their own national platforms with the OCI without exporting data.

It is operated as a **public good**: free at the point of use, open-source, and governed under the GI-AI4H mandate (ITU + WHO + WIPO).

## What the OCI is

A federation of **standards-aligned services**:

| Layer | What it does | Standard / Tool |
| --- | --- | --- |
| **Catalogue** | Describes datasets in a machine-readable, search-engine-indexable way. | [MLCommons Croissant 1.1](https://mlcommons.org/2026/02/croissant-1-1-standard/) + biomedical extensions (BioCroissant WG). |
| **Access governance** | Expresses what data may be used for; matches intended use against permissions. | [GA4GH Data Use Ontology (DUO)](https://www.ga4gh.org/product/data-use-ontology-duo/), [W3C ODRL](https://www.w3.org/TR/odrl-model/). |
| **Storage** | Hosts dataset bytes when the host doesn't have its own infrastructure. | S3-compatible (AWS S3 in production, MinIO in local dev), KMS-encrypted, multipart upload. |
| **Identity** | Authenticates researchers, hosts, regulators, admins. | AWS Cognito (production); local-dev stub. |
| **Evaluation** *(Phase C, in flight)* | Runs sandboxed model evaluations against versioned dataset hashes. | Containerised runner; reuses MLCommons MedPerf where appropriate. |
| **Federation** | Discovers peer catalogues via well-known endpoints. | `/.well-known/croissant-catalog.json` (Croissant index), JSON-LD over HTTPS. |

It exposes itself through three surfaces:

- A **public web app** (catalog + dataset detail + JSON-LD discoverability for Google Dataset Search).
- An **authenticated host workflow** (create / publish / upload / review access requests).
- A **JSON over HTTPS API** (`/v2/...`) for integrators — HuggingFace, Kaggle, OpenML, member-state platforms, etc.

## What the OCI is *not*

- **Not a data store of last resort.** Hosts retain ownership and can pull a dataset at any time. The OCI references; it does not appropriate.
- **Not an evaluation arbiter.** Model evaluation results are reproducible and machine-readable, but the *interpretation* (does this model meet a regulatory bar?) belongs to the regulator.
- **Not a single-jurisdiction product.** Compliance posture is configurable per deployment so that an EU member-state instance, a WHO regional-office instance, and an academic instance can all coexist within the federation.
- **Not a replacement for IRB / ethics review.** It records and machine-checks the *fact* of approval; it does not perform it.

## Architecture in one diagram

```
                      ┌─────────────────────────────────┐
                      │         AI for Good             │
                      │   discovery (Google Dataset     │
                      │   Search, Kaggle, HuggingFace,  │
                      │   peer Croissant catalogues)    │
                      └────────────────┬────────────────┘
                                       │
                                  JSON-LD over HTTPS
                                       │
   ┌───────────────────────────────────┴──────────────────────────────┐
   │                       OCI Catalogue (web + API)                  │
   │   • Croissant 1.1 manifest validation + storage                  │
   │   • Federation: harvest peer catalogues into a unified search    │
   │   • DUO permission terms on each dataset                         │
   └─────────┬─────────────────────────┬─────────────────────────┬────┘
             │                         │                         │
   ┌─────────▼──────────┐    ┌─────────▼──────────┐    ┌─────────▼──────────┐
   │ Access governance  │    │      Storage       │    │ Evaluation (P.C)   │
   │ • DUO matcher      │    │ • Self-hosted S3   │    │ • Reproducible     │
   │ • IRB attestations │    │ • Upstream URLs    │    │   sandbox runs     │
   │ • Audit trail      │    │ • Gated download   │    │ • Manifest-hashed  │
   └────────────────────┘    └────────────────────┘    └────────────────────┘
```

The full architecture diagram, including AWS-specific deployment, lives at [`docs/architecture.md`](../architecture.md).

## Where the OCI fits in the GI-AI4H landscape

GI-AI4H has five working groups: Regulatory considerations, Ethics & governance, **Data**, Evaluation, and Intellectual property. The OCI is the operational arm of **WG-Data** — it implements the Data and Model Exchange Protocol (DMXP) the WG defines.

It also feeds:

- **WG-Evaluation**: dataset selection for benchmarking challenges runs through the OCI catalogue.
- **WG-Regulatory**: the audit trail (who trained on what, who approved what access) supports regulator submissions.
- **WG-Ethics**: DUO-based consent codes + IRB attestations operationalise the WG's data-use guidance.
- **WG-IP**: licence + attribution metadata in Croissant 1.1 surfaces upstream rights.

See [Governance](./governance.md) for the formal structure.
