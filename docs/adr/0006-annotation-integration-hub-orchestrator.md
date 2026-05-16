# ADR-0006: Annotation module — integration-hub orchestrator

- **Status:** accepted
- **Date:** 2026-05-15
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:platform` `area:governance`

## Context

The OCI Platform needs an annotation track. The legacy Spring Boot stack at `health.aiaudit.org/annotation` (FG-AI4H/annotation-tool + annotation-frontend) froze in mid-2022; the Nov-2024 backlog (conflict management, consent, burndown, pre-annotation, Visian re-integration) has effectively zero implementation. The annotation submission endpoint returns a hard-coded UUID, the S3 PUT for annotation bytes is commented out, and the only wired external tool — Visian — is a `window.open` to a public URL with the user's full Cognito JWT in the URL fragment.

Three forces shape the scope of the new module:

1. **The legacy was an integration hub by intent, not reality.** The `AnnotationTool` entity exists; the abstraction was named but never reified — only Visian was ever wired, no other tools (CVAT / MD.ai / MONAI Label / OHIF) referenced in code. `Campaign.annotationTool` is a free-text string with no FK. The pattern was right; the execution wasn't.
2. **The competitive landscape leaves the orchestrator-with-governance quadrant empty.** Label Studio + CVAT ship MIT/Apache cores but paywall the governance features (SSO, RBAC, audit). V7 is pivoting away from annotation toward V7 Go. Synapse approximates the governance posture but doesn't speak GA4GH. MONAI Label is Apache 2.0 with no upsell — but it's an AI-assist runtime, not an orchestrator. The "Croissant + GA4GH Passport + ISO/IEC 5259 + signed receipts + OSS + medical-imaging-native" quadrant has no occupant.
3. **The DRAFT data-annotation standard (ITU-T FG-AI4H DEL05-A03, 2023-01-28) specifies a 3-gate SOP** — independent annotation by n annotators → arbitration → expert review, with configurable consistency thresholds at each gate — but leaves the persistence layer, signing, retention, and standards interop entirely unspecified.

The user-guidance during planning was decisive: _"the legacy annotation tool relied mainly on integrations, specialized UI to annotate specific modalities, like Visian to annotate brain 3D images, the annotation legacy was driving the process."_ This ADR locks that intent.

Full research compiled separately in the internal planning archive (legacy-codebase reverse engineering, DRAFT-standard parse, competitive-landscape survey, standards + papers analysis, legacy-issues triage, integration-architecture deep-dive). The supporting inputs are not part of the public repo.

## Decision

The OCI annotation module is an **integration-hub orchestrator**. It owns:

1. **Campaign + task lifecycle** — DRAFT, READY, RUNNING, COMPLETED, ARCHIVED states; per-task gate state machine (INDEPENDENT, AWAITING_ARBITRATION, AWAITING_EXPERT, COMPLETED, SKIPPED).
2. **Role-based assignment** — campaign manager, task supervisor, annotator, reviewer, arbitration annotator, expert reviewer + the existing OCI ACT (which can be assigned as expert reviewer on SENSITIVE-tier campaigns). Each role is a time-bounded GA4GH Visa Type per campaign, issued through the identity module ([ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) Decision 3). **The task-routing algorithm** (skill match → experience-weighted ranking → bias-prevention sampling → class-balance check, with deterministic tie-break) is locked in [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md).
3. **The 3-gate SOP from DEL05-A03**, with configurable n-annotators and consistency thresholds. The expert-review decision is **final** (closes the DRAFT's TBD on rejection-loop termination). **N-annotator default = 3, soft maximum = 12** (per ADR-0009; the rumoured "FDA mandates N=7" claim is documented in ADR-0009 as inaccurate — no FDA standard prescribes a specific N).
4. **Quality gates and IRR scoring** — campaign-level configuration, defaults locked in [ADR-0008](./0008-annotation-persistence-and-provenance.md).
5. **Audit trail, provenance, and persistence** — per [ADR-0008](./0008-annotation-persistence-and-provenance.md).
6. **The catalog ↔ annotation linkage** — annotations target a catalog dataset by FK at three levels: `Dataset.id` + `DatasetManifest.id` (immutable on the campaign) + `DatasetSample.id`. Completed campaigns contribute the resulting annotations back to the catalog as a new distribution.

It explicitly **does not own** modality-specific viewers/editors. Those plug in as versioned adapters via the contract in [ADR-0007](./0007-annotation-tool-integration-contract.md). The reference adapter set is MONAI Label (AI-assist + active learning) and OHIF Viewer (DICOM 2D). Visian re-integration is deferred (the student project is dormant); the contract still pre-supports its handoff shape so reactivation is a config change.

**OCI defines its own role-name termbase** (above), with a mapping table to each DRAFT-standard variant in `docs/for-governance/annotation-conformance.md`. The DRAFT is treated as one input among many — OCI proposes stances on its TBDs (label fusion, post-processing, expert-review termination) and adds the layers it omits (Croissant / GA4GH / signed receipts / EU MDR retention). Conformance posture reported as "partial / extended".

**The legacy platform is fully decommissioned**: no feature-flag cutover, no dual-running window, no data migration from Aurora MySQL (the legacy DB held only dev/sandbox content). After a final encrypted backup snapshot, RDS + Elastic Beanstalk torn down; `FG-AI4H/annotation-tool` + `FG-AI4H/annotation-frontend` repos archived read-only.

## Consequences

### Positive

- **Clear scope.** The orchestrator + governance + standards layer is what OCI builds. Editor quality is delegated to OSS specialists (MONAI Label, OHIF, 3D Slicer for desktop, Visian when reactivated). No multi-year detour into pixel-level UX.
- **Competitive positioning is sharp.** OCI is the only platform combining the orchestrator-with-governance posture with Croissant + GA4GH Passport + ISO/IEC 5259 + signed audit receipts. That's the unclaimed quadrant.
- **The catalog ↔ annotation FK contract** means annotation can never reference a stale or missing dataset; manifest immutability prevents campaign-mid-flight schema drift; new-distribution write-back closes the federation loop.
- **Role assignment as Visas** integrates the annotation track with the existing identity-tier / GA4GH Passport infrastructure. No parallel ACL system.
- **Termbase + mapping table** future-proofs against the DRAFT standard's eventual revision. If GI-AI4H WG-Data picks one of the two DRAFT-3.2 vocabularies, we update the mapping doc; the API contract doesn't churn.

### Negative

- **The tool-integration contract becomes a long-term commitment.** Every adapter is in-tree CDK + code; breaking changes are versioned with deprecation paths (see [ADR-0007](./0007-annotation-tool-integration-contract.md)).
- **DICOM SR / FHIR / Croissant-RAI persistence is non-trivial per modality.** Three template forms × n modalities × m task types = combinatorial work; this ADR commits to the architecture, [ADR-0008](./0008-annotation-persistence-and-provenance.md) commits to the order.
- **Decommissioning the legacy without a feature-flag cutover** removes the safety net of a dual-running window. If the new module ships incomplete, there's no fallback.
- **No data migration** means dev/sandbox campaigns in the legacy MySQL are abandoned — acceptable per user guidance (the legacy DB held only dev/sandbox content) but worth recording.

### Neutral

- The legacy frontend's leaked API Gateway key (in `annotation-frontend/.../DatasetForm/index.js:109`) is bundled with the decommission (E13) rather than rotated as a standalone action. CloudTrail monitoring covers the interim risk; live credential abuse triggers immediate rotation.
- Pre-annotation registry is deferred to Phase C+ (alongside MONAI Label integration). Workflow ships in Phase B without it; the contract pre-supports it.
- Annotation packages (`@oci/annotation-quality`, `@oci/annotation-persistence`) live in-tree for now; extraction to standalone OSS is a follow-up if/when a community signal emerges.

## Alternatives considered

- **Own the modality-specific viewers/editors.** Rejected — editor quality is a deep specialty where OSS leaders (Visian, OHIF, MONAI Label, 3D Slicer) exist; re-implementing them is a multi-year detour buying nothing. The competitive window is orchestration + governance, not editor quality.
- **Re-use legacy `Campaign.annotationTool` free-text pattern.** Rejected — typos silently break launches; no capability matrix means the workflow engine can't validate any handoff. The legacy's bug, not a feature.
- **Treat the DRAFT standard as authoritative and conform strictly.** Rejected — too many TBDs (label fusion, post-processing, Table 1 modalities, expert-review rejection loop) become risks if the standard moves. We treat the DRAFT as one input and propose stances; conformance reported as "partial / extended".
- **Adopt one of the two DRAFT clause-3.2 termbases verbatim.** Rejected — ties OCI's API DTO names to whichever the WG eventually picks. OCI-defined termbase with a mapping table is more durable.
- **Feature-flagged dual-running cutover from legacy.** Rejected — the legacy submission endpoint is broken, the data is sandbox-only, and the legacy frontend has a leaked API key. Maintaining the dual-run window costs more than it buys.
- **Allow runtime third-party adapter registration via admin UI.** Rejected — bigger E2 scope, larger attack surface, wrong posture for a regulated audience. Curated-only via CDK declarations until the contract is proven; revisit after Phase B.

## Amendments

- **2026-05-16 — Extended by [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md).** ADR-0009 locks the task-routing algorithm (referenced from Decision 2) and the N-annotator defaults + bounds (referenced from Decision 3). It also clarifies that "FDA mandates N=7" — a claim that had been circulating internally — is not supported by any current FDA guidance.

## References

- Issue: [FG-AI4H/oci-platform#45](https://github.com/FG-AI4H/oci-platform/issues/45) — original Phase B annotation epic (closed and replaced by a new umbrella epic when this ADR lands).
- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — role + GA4GH Passport Visa infrastructure that this ADR reuses for annotation-role assignment.
- [ADR-0007](./0007-annotation-tool-integration-contract.md) — the tool-integration contract referenced above.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — the persistence + provenance + IRR + retention policy referenced above.
- [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) — task-routing + N-annotator policy + segmentation fusion (amends this ADR).
- ITU-T FG-AI4H DEL05-A03 (2023-01-28) — "Proposed Standard for Data Annotation in Health" (the DRAFT).
- ISO/IEC 5259 series — AI data quality framework.
- GA4GH Passport v1.2.
- Croissant 1.1 + RAI extension.
