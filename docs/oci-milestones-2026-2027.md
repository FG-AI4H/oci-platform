# OCI Milestones 2026 – 2027

**Initiative:** Open Code Infrastructure (OCI) — ITU-WHO-WIPO Global Initiative on AI for Health (GI-AI4H)
**Author:** Marc Lecoultre (Co-Chair, WG-Data)
**Date:** 2026-04-21
**Audience:** Bilel / Program leadership

---

## Overview

The OCI delivers a public-good, end-to-end framework for developing and rigorously assessing health AI algorithms, organised into six interoperable packages. The milestones below tie each OCI package to the corresponding **WG-Data work stream** and to the formal WG-Data deliverable timeline (short-term 6-12 months, medium-term 12-24 months, long-term 24-36 months).

| OCI Package            | WG-Data Work Stream                                                       |
| ---------------------- | ------------------------------------------------------------------------- |
| Data Acquisition (DAP) | WS-1 Data Indexing and Cataloguing                                        |
| Data Storage (DP)      | WS-2 Transaction Protocols (DMXP) + WS-3 Privacy-Preserving Data Exchange |
| Data Annotation (AP)   | WS-1 (quality metadata) + WS-4 Synthetic Data                             |
| Prediction (PP)        | WS-2 DMXP (model exchange) + WS-6 Implementation & Validation             |
| Evaluation (EP)        | WS-5 LLM Evaluation for Healthcare                                        |
| Reporting (RP)         | WS-6 Implementation & Validation + cross-cutting audit trail              |

Legend: **[M]** = Milestone · **[D]** = Dependency.

---

## Data Acquisition Package (DAP) — WS-1

_Secure ingestion and registration of health data_

### 2026

- **Q2 — [M] Healthcare Croissant Extension Specification v1.0 — ingestion support**
  Accept and validate dataset manifests compliant with MLCommons Croissant + healthcare extensions. _(Aligns with WG-Data short-term deliverable.)_
- **Q3 — [M] Data indexing good-practices adopted in platform**
  Implement the WG-Data data-indexing guidance for healthcare AI datasets (imaging/DICOM, genomics, EHR/HL7 FHIR, clinical notes).
- **Q4 — [M] Federated catalogue meta-index MVP**
  Prototype unified browsing across contributing data vendors; metadata-only (no raw data movement).

### 2027

- **Q1 — [M] Ontology compatibility layer** — mappings to ICD-10/11, SNOMED CT, UMLS, LOINC surfaced in search and filtering.
- **Q2 — [M] Catalogue meta-index v1.0** — production cross-vendor catalogue (WG-Data medium-term deliverable).
- **Q3 — [M] Bias & representativeness metadata** — mandatory quality metadata fields at ingestion (subgroup coverage, geography, demographics).

---

## Data Storage Package (DP) — WS-2 + WS-3

_Protected storage and controlled data access_

### 2026

- **Q2 — [M] Production storage security baseline**
  KMS-encrypted, VPC-isolated, fully audit-logged (delivered Q1-Q2 2026: Aurora audit logging + S3 access-point hardening).
- **Q3 — [M] Universal SSO via AWS Cognito**
  Replace legacy EvalAI auth; unified identity across all OCI packages. [D: coordination with AP, PP]
- **Q4 — [M] DMXP v0.1 design document**
  First draft of the Data and Model Exchange Protocol: data authentication, provenance, usage-rights specification, audit trails. Compatibility with Model Context Protocol (MCP) considered.

### 2027

- **Q1 — [M] DMXP v1.0 specification** _(WG-Data medium-term deliverable)_
- **Q2 — [M] Privacy-preserving federated-learning reference architecture** _(WG-Data medium-term deliverable)_ — multi-institutional training without centralising data.
- **Q3 — [M] GDPR / HIPAA compliance mapping** — documented control mapping and data-residency framework; regional deployments available for EU and WHO Member States with local data-residency requirements.
- **Q4 — [M] DMXP reference implementation** _(WG-Data long-term deliverable)_ — open tooling for secure data & model exchange.

---

## Data Annotation Package (AP) — WS-1 + WS-4

_Annotation campaigns and expert collaboration_

### 2026

- **Q2 — [M] Annotation-tool re-activation**
  Dependency & security upgrade of the Spring Boot / React stack (last major release Nov 2024); bring back under active maintenance.
- **Q3 — [M] Campaign management v2 — multi-annotator workflows**
  Annotator / reviewer / supervisor roles, inter-annotator agreement metrics, audit-trail for each annotation event.
- **Q4 — [M] FG-AI4H DEL 5.3 conformance**
  Full alignment with the ITU-T standard for data annotation in health (design, creation, QA, maintenance).

### 2027

- **Q1 — [M] Synthetic-data quality & validation guidelines adopted** _(WG-Data medium-term deliverable)_
  Metrics for statistical fidelity, utility preservation, and re-identification-risk assessment integrated into the annotation/QA flow.
- **Q2 — [M] Imaging annotation integration (DICOM / Visian)**
  Seamless handoff between catalogue, annotation campaign and storage.
- **Q3 — [M] Active-learning assisted annotation**
  Model-in-the-loop labelling to reduce expert effort on high-volume campaigns; bias mitigation in generation/labelling integrated.

---

## Prediction Package (PP) — WS-2 + WS-6

_Running AI models to generate predictions_

### 2026

- **Q2 — [M] Docker evaluation pipeline — production stable**
  Robust ECS worker orchestration with IAM-role auth, credential auto-refresh, VPC isolation (partially delivered 2025-Q4 / 2026-Q1).
- **Q3 — [M] GPU worker pool** — support radiology, pathology, multi-modal models under controlled cost.
- **Q4 — [M] In-UI submission** — remove CLI-only barrier; direct image-based submission from the web UI. [D: EvalAI-CLI UI integration]

### 2027

- **Q1 — [M] Model-to-data (privacy-preserving) execution mode**
  Run participant models against held-out regulated data without exposing the data or the model — a DMXP execution profile.
- **Q2 — [M] Multi-phase / multi-dataset challenges** with locked test partitions.
- **Q3 — [M] Reproducibility guarantees** — hash-pinned images, deterministic seeds, signed evaluation traces retained alongside results (feeds RP audit trail).

---

## Evaluation Package (EP) — WS-5

_Metrics-based technical and regulatory evaluation_

### 2026

- **Q2 — [M] LLM healthcare evaluation framework — requirements document** _(WG-Data short-term deliverable)_
  Define clinical safety, hallucination, clinical-task, fairness and benchmark-design requirements.
- **Q3 — [M] Standard metrics library v1**
  Versioned Python package covering classification, segmentation, detection, fairness, calibration — recommended by FG-AI4H topic groups.
- **Q4 — [M] Fairness & subgroup evaluation**
  Disaggregated metrics by age, sex, ethnicity, geography surfaced automatically in leaderboards.

### 2027

- **Q1 — [M] MedEval-GI benchmark suite v1** _(WG-Data medium-term deliverable)_
  First cross-institutional benchmark suite for LLMs in healthcare (clinical safety + clinical task + documentation + patient-communication) going beyond USMLE-style MCQ.
- **Q2 — [M] Red-teaming & hallucination-detection protocols** integrated as EP evaluation modes.
- **Q3 — [M] Multi-lingual MedEval benchmarks** — ≥5 languages with an LMIC / rare-disease focus (tropical and neglected conditions). _(Path to WG-Data long-term 10+ languages by 2028.)_
- **Q4 — [M] Regulatory evaluation profiles** — pre-configured bundles mapped to FDA / CE / WHO-prequal expectations.

---

## Reporting Package (RP) — WS-6 + cross-cutting

_Structured, regulator-ready assessment reports_

### 2026

- **Q2 — [M] Reporting-tool integration into platform** (in progress — Golam)
  One-click generation of assessment reports from completed benchmarks.
- **Q3 — [M] Quality management protocols for data assets — initial version** _(WG-Data short-term deliverable)_
  Report templates covering dataset QM, model card, benchmark result.
- **Q4 — [M] Machine-readable report format** — JSON-LD + signed PDF; cross-linkable to dataset and model identifiers (feeds DMXP audit trail).

### 2027

- **Q1 — [M] Regulator-facing portal**
  Secure channel through which a regulator can review all artefacts (dataset → annotation → model → prediction → metric → report) for a given AI device under assessment.
- **Q2 — [M] Tamper-evident lineage / audit trail** — full traceability across packages, DMXP-compliant.
- **Q3 — [M] Cross-sectorial federated validation — results report** _(WG-Data long-term deliverable)_ — pilot with ≥3 healthcare institutions and ≥2 regulators; LMIC participation secured via Fondation Botnar travel support.
- **Q4 — [M] ITU-T Recommendation candidate input** _(WG-Data long-term deliverable)_ — reporting-schema contributions to the candidate Recommendation document.

---

## Cross-cutting milestones

| Theme                      | 2026                                                                                                         | 2027                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Security & compliance**  | Security Hub clean baseline; quarterly remediation cadence (ongoing)                                         | ISO 27001-style control framework; external security audit              |
| **Open-source governance** | Contribution guide, code of conduct, release cadence published                                               | Open-source foundation / steering-committee model                       |
| **Community**              | Webinar series on data standards (Croissant / BIOCroissant — delivered March 2026); monthly WG-Data meetings | Annual OCI developer conference; challenge-host academy                 |
| **Standards alignment**    | FG-AI4H DEL 5.x, Croissant healthcare extension, HL7 FHIR                                                    | IMDRF reporting schema, ISO/IEC 23053, WHO AI4H guidance                |
| **External liaison**       | Formal liaison with MLCommons Croissant WG, HL7, SNOMED International                                        | IEEE SA, ISO/IEC JTC 1 SC 42, Hugging Face Open Medical-LLM Leaderboard |
| **Implementation (WS-6)**  | 2 pilot institutions                                                                                         | ≥5 pilot institutions across regions incl. ≥2 LMIC                      |

---

## Notes for the meeting with Bilel

- Milestones are aligned with the **WG-Data Terms of Reference** deliverable timeline (short-term 6-12m, medium-term 12-24m, long-term 24-36m) so the OCI platform track and the WG-Data standards track advance together.
- **Hard dependencies worth flagging:**
  - Cognito / universal auth unblocks cross-package identity (AP / DP / PP).
  - DMXP v0.1 in late 2026 is the linchpin for 2027: federated learning, model-to-data execution, and regulator-facing audit trails all depend on it.
  - DAP federated connectors unblock partner onboarding and therefore the entire WS-6 validation plan.
- **Risk areas:**
  - Annotation tool has been on maintenance mode since late 2024 — decide Q2 2026 whether to reinvest or narrow scope.
  - WS-5 (LLM evaluation) is the highest-visibility stream externally (Hugging Face liaison, MedEval-GI) but also the most under-resourced today.
  - LMIC pilots (WS-6) depend on Fondation Botnar travel support continuity.
- **2027 assumes 2026 foundational deliverables land on time.** If Q2-Q3 2026 slips, the 2027 roadmap cascades by roughly one quarter.

---

## Appendix — WG-Data deliverable mapping

| WG-Data deliverable (ToR §5)                       | OCI package(s)     | OCI milestone                                      |
| -------------------------------------------------- | ------------------ | -------------------------------------------------- |
| Healthcare Croissant Extension Specification v1.0  | DAP                | 2026-Q2                                            |
| Data indexing good-practices                       | DAP                | 2026-Q3                                            |
| LLM healthcare evaluation framework requirements   | EP                 | 2026-Q2                                            |
| Standardized formats (DICOM, genomics, FHIR)       | DAP                | 2026-Q3                                            |
| Quality management protocols — initial             | RP                 | 2026-Q3                                            |
| Catalogue meta-index prototype                     | DAP                | 2026-Q4 → 2027-Q2                                  |
| DMXP v1.0                                          | DP                 | 2027-Q1                                            |
| MedEval-GI benchmark suite                         | EP                 | 2027-Q1                                            |
| Synthetic data quality & validation guidelines     | AP                 | 2027-Q1                                            |
| Privacy-preserving federated-learning architecture | DP                 | 2027-Q2                                            |
| Ontology compatibility layer                       | DAP                | 2027-Q1                                            |
| Cross-sectorial federated validation results       | RP                 | 2027-Q3                                            |
| DMXP reference implementation                      | DP                 | 2027-Q4                                            |
| Multi-lingual LLM evaluation (10+ languages)       | EP                 | 2028 (beyond scope of this plan — 2027 targets ≥5) |
| LMIC-focused synthetic data toolkit                | AP / DAP           | 2028 (WS-6 pilots feed into this)                  |
| ITU-T Recommendation candidate documents           | RP + cross-cutting | 2027-Q4 input                                      |
