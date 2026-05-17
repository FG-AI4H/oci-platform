# Feature status

The live capability matrix. Updated on every shipped feature — docs deltas are part of definition-of-done.

Last update: **2026-05-16** (annotation architecture locked across 7 ADRs — 0006-0012; umbrella epic #212 + 14 sub-epics + 8 cross-cutting sub-issues ready for Phase B.A.1 implementation).

## At a glance

- ✅ **Foundation (Phase A)** complete: monorepo, CDK, three environments, Cognito, NestJS + Next.js skeletons, full CI/CD.
- ✅ **Catalog (Phase B core)** shipped: list + detail + faceted search + manifest wizard + raw-JSON view + JSON-LD discoverability + federation harvest.
- ✅ **Access governance (Phase B basics)** shipped: structured intended-use form, DUO matcher, status-aware access CTA, post-submit confirmation flow.
- ✅ **User UI preferences** shipped: dark mode + density + locale (PR M, #144).
- ✅ **Access governance (Phase B Phase-1)** shipped: tiered access model (#115), email-domain classifier (#116), certification quiz (#117), click-wrap with SHA-256 + KMS receipt (#118), commercial-use terms (#119), builder-vs-researcher form variants (#120). All committed in [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md).
- ✅ **Access governance (Phase B Phase-2)** shipped: ORCID (#125), GA4GH Passport RP + issuer (#126/#127), DocuSeal AdES (#128), DUA template engine (#129), renewal cron (#130).
- ✅ **Outbound + inbound mail in AWS Frankfurt** — SES per-env identity + inbound forwarder + SMTP-to-SES relay (ADR-0004 / ADR-0005). DocuSeal signing emails verified end-to-end in dev.
- 🚧 **Annotation track (Phase B.A)** — architecture locked across 7 ADRs (0006-0012): integration-hub orchestrator, tool-integration contract, DICOM SR/FHIR/Croissant-RAI persistence, task-routing + multi-rater + intra-rater + STAPLE, metadata blinding, sample rejection, annotator agreement + licensing. Implementation tracked under umbrella [#212](https://github.com/FG-AI4H/oci-platform/issues/212) with 14 sub-epics + 8 sub-issues. Phase B.A.1 (re-activation) starts next.
- 🚧 **Phase C (evaluation)** — Django port not yet started.
- 🚧 **Phase D (reporting)** — not yet started.
- 🚧 **Phase E (DMXP / federation v1.0)** — DMXP v0.1 design in progress; full v1.0 in Phase E.

## Catalogue

| Capability                                                                                              | Status     | Shipped in                                                         |
| ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Public dataset listing + search                                                                         | ✅ Live    | PR C ([#76](https://github.com/FG-AI4H/oci-platform/pull/76))      |
| Faceted search (modality / region / disease / anonymization / license / DUO) + offset pagination + sort | ✅ Live    | PR L.1 ([#100](https://github.com/FG-AI4H/oci-platform/pull/100))  |
| Dataset detail page                                                                                     | ✅ Live    | PR C / PR G (visual pass)                                          |
| Tabbed detail view (Summary / Full manifest / Raw JSON)                                                 | ✅ Live    | PR L.2 ([#101](https://github.com/FG-AI4H/oci-platform/pull/101))  |
| JSON-LD discoverability (Google Dataset Search, sitemap, robots)                                        | ✅ Live    | PR C ([#76](https://github.com/FG-AI4H/oci-platform/pull/76))      |
| Host workflow — create draft, publish manifest                                                          | ✅ Live    | PR D ([#78](https://github.com/FG-AI4H/oci-platform/pull/78))      |
| Croissant manifest wizard — guided publish flow                                                         | ✅ Live    | PR K ([#98](https://github.com/FG-AI4H/oci-platform/pull/98))      |
| Croissant 1.1 manifest validation (Croissant + RAI + BioCroissant)                                      | ✅ Live    | `@oci/croissant`                                                   |
| Federation — peer registration + harvester                                                              | ✅ Live    | PRs E.1 / E.2 / E.3                                                |
| Source filter (`local` / `federated` / `all`)                                                           | ✅ Live    | PR E.2                                                             |
| Public Croissant catalogue endpoint (federation outbound)                                               | ✅ Live    | PR C                                                               |
| Three rich seed fixtures (PUBLIC + RESTRICTED + PRIVATE) for local UI testing                           | ✅ Live    | PR M ([#144](https://github.com/FG-AI4H/oci-platform/pull/144))    |
| Commercial-use badge + filter                                                                           | ✅ Live    | PR [#156](https://github.com/FG-AI4H/oci-platform/pull/156) (#119) |
| Access-tier badge on dataset detail                                                                     | ✅ Live    | PR [#154](https://github.com/FG-AI4H/oci-platform/pull/154) (#115) |
| WHO health-priority filter on catalog list                                                              | 🚧 Planned | [#121](https://github.com/FG-AI4H/oci-platform/issues/121)         |
| Dataset version history UI                                                                              | 🚧 Planned | [#91](https://github.com/FG-AI4H/oci-platform/issues/91)           |

## Storage & distributions

| Capability                                                                     | Status     | Shipped in                                                    |
| ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------- |
| Upstream URL distributions (manifest references external host)                 | ✅ Live    | PR D                                                          |
| Self-hosted distributions — multipart upload                                   | ✅ Live    | PR I ([#95](https://github.com/FG-AI4H/oci-platform/pull/95)) |
| Self-hosted distributions — gated download (visibility + access-request aware) | ✅ Live    | PR I                                                          |
| Manifest republish adopts platform-hosted contentUrls back into S3 metadata    | ✅ Live    | PR I                                                          |
| CLI tool for TB-scale uploads                                                  | 🚧 Planned | [#88](https://github.com/FG-AI4H/oci-platform/issues/88)      |
| External S3 mount for petabyte datasets                                        | 🚧 Planned | [#89](https://github.com/FG-AI4H/oci-platform/issues/89)      |

## Access governance

### Live today (Phase B basics)

| Capability                                                                                             | Status  | Shipped in                                                      |
| ------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| Access request — create / list / decide                                                                | ✅ Live | PR F ([#86](https://github.com/FG-AI4H/oci-platform/pull/86))   |
| Structured intended-use form (project + DUO terms + IRB + retention + redistribution + output)         | ✅ Live | PR J.1 ([#96](https://github.com/FG-AI4H/oci-platform/pull/96)) |
| DUO permission terms on the dataset (`consentCode`)                                                    | ✅ Live | PR J.1                                                          |
| Auto-matcher (MATCHED / CONFLICT / UNCLEAR)                                                            | ✅ Live | PR J.1                                                          |
| Publish-time fail-closed for non-PUBLIC without DUO terms                                              | ✅ Live | PR J.1                                                          |
| Status-aware access CTA on dataset detail (PENDING / APPROVED / DENIED inline)                         | ✅ Live | PR L.3 ([#99](https://github.com/FG-AI4H/oci-platform/pull/99)) |
| Post-submit confirmation banner — redirect back to dataset detail                                      | ✅ Live | PR M ([#144](https://github.com/FG-AI4H/oci-platform/pull/144)) |
| Tiered access (OPEN / REGISTERED / CONTROLLED / SENSITIVE) + identity score + tier-mismatch CONFLICT   | ✅ Live | [#154](https://github.com/FG-AI4H/oci-platform/pull/154) (#115) |
| Email-domain classifier (institutional / corporate / public / disposable) + dataset allowlist          | ✅ Live | [#154](https://github.com/FG-AI4H/oci-platform/pull/154) (#116) |
| Certification quiz (15 questions, 80% pass, 1-yr validity) at `/certification`                         | ✅ Live | [#159](https://github.com/FG-AI4H/oci-platform/pull/159) (#117) |
| Click-wrap policy acceptance — SHA-256 + optional KMS receipt — `POST /v2/identity/policy-acceptances` | ✅ Live | [#162](https://github.com/FG-AI4H/oci-platform/pull/162) (#118) |
| Commercial-use band (OK / NCO / case-by-case) + clauses + catalog filter                               | ✅ Live | [#156](https://github.com/FG-AI4H/oci-platform/pull/156) (#119) |
| Builder vs. researcher request-form variants + `builderContext` JSONB                                  | ✅ Live | [#160](https://github.com/FG-AI4H/oci-platform/pull/160) (#120) |

### Architectural commitment landed (ADR-0003, 2026-05-08)

[ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md) commits the platform to a tiered identity assurance + GA4GH-Passport-first model, with researchers AND AI solution developers as first-class audiences. Plain-English explainer at [overview/access-governance.md](./access-governance.md). Strategy positioning at [for-strategy/access-governance-positioning.md](../for-strategy/access-governance-positioning.md). Field research at `docs/research/access-governance-2026-05-08.md` _(internal companion repo)_.

### Phase 1 (delivered 2026-05-09)

| Capability                                                                                                                                                                                                            | Status  | Shipped in                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Tiered access model — `Dataset.accessTier` (OPEN/REGISTERED/CONTROLLED/SENSITIVE) + identity-context normalizer + tier-aware DUO matcher                                                                              | ✅ Live | PR [#154](https://github.com/FG-AI4H/oci-platform/pull/154) (#115) |
| Email-domain classifier — disposable blocklist + per-dataset allowlist + form-side guard                                                                                                                              | ✅ Live | PR [#154](https://github.com/FG-AI4H/oci-platform/pull/154) (#116) |
| Certification quiz module — 15-question bank, 1-yr validity, attempt history, `/certification` UI                                                                                                                     | ✅ Live | PR [#159](https://github.com/FG-AI4H/oci-platform/pull/159) (#117) |
| Click-wrap policy acceptance — SHA-256 hash + optional KMS-signed receipt + `/v2/me/policy-acceptances` audit trail                                                                                                   | ✅ Live | PR [#162](https://github.com/FG-AI4H/oci-platform/pull/162) (#118) |
| Commercial-use terms — `Dataset.commercialUseTerms` band + clauses + catalog filter + badge                                                                                                                           | ✅ Live | PR [#156](https://github.com/FG-AI4H/oci-platform/pull/156) (#119) |
| Builder-vs-researcher request-form variants — `AccessRequest.audience` + `builderContext` (legal entity, deployment countries, regulatory pathway, WHO priority, accreditations, royalty plan, post-market data flow) | ✅ Live | PR [#160](https://github.com/FG-AI4H/oci-platform/pull/160) (#120) |

### Phase 1 still planned (LMIC + signup polish)

| Capability                                       | Status     | Tracked                                                    |
| ------------------------------------------------ | ---------- | ---------------------------------------------------------- |
| WHO priority filter on catalog                   | 🚧 Planned | [#121](https://github.com/FG-AI4H/oci-platform/issues/121) |
| Email verification (OTP)                         | 🚧 Planned | [#122](https://github.com/FG-AI4H/oci-platform/issues/122) |
| Self-service signup flow                         | 🚧 Planned | [#123](https://github.com/FG-AI4H/oci-platform/issues/123) |
| i18n scaffold (FR / ES / PT / AR for LMIC users) | 🚧 Planned | [#124](https://github.com/FG-AI4H/oci-platform/issues/124) |

### Phase 2 (1–3 months)

| Capability                                                                   | Status  | Tracked                                                    |
| ---------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| ORCID OAuth integration                                                      | ✅ Live | [#125](https://github.com/FG-AI4H/oci-platform/issues/125) |
| GA4GH Passport relying party (verify Visas from ELIXIR AAI / NIH RAS / Sage) | ✅ Live | [#126](https://github.com/FG-AI4H/oci-platform/issues/126) |
| OCI as Passport issuer (JWKS endpoint, sign own Visas)                       | ✅ Live | [#127](https://github.com/FG-AI4H/oci-platform/issues/127) |
| DocuSeal self-hosted on Fargate (AdES DUA signing)                           | ✅ Live | [#128](https://github.com/FG-AI4H/oci-platform/issues/128) |
| DUA template engine (researcher + builder + LMIC variants)                   | ✅ Live | [#129](https://github.com/FG-AI4H/oci-platform/issues/129) |
| Renewal cron (BullMQ) — 30-day pre-expiry email + auto-revoke                | ✅ Live | [#130](https://github.com/FG-AI4H/oci-platform/issues/130) |

### Phase 3 (6–12 months, gated on demand)

| Capability                                               | Status                                       | Tracked                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Yousign QES via AWS Marketplace (SENSITIVE-tier signing) | 🚧 Planned                                   | [#131](https://github.com/FG-AI4H/oci-platform/issues/131)                                                              |
| eduGAIN SP via SWITCHaai (academic SAML SSO)             | 🚧 Planned                                   | [#132](https://github.com/FG-AI4H/oci-platform/issues/132)                                                              |
| OCI ACT operator review UI (SENSITIVE-tier inbox)        | 🚧 Planned                                   | [#133](https://github.com/FG-AI4H/oci-platform/issues/133)                                                              |
| Validated User flow (ID-document review pipeline)        | 🚧 Planned                                   | [#134](https://github.com/FG-AI4H/oci-platform/issues/134)                                                              |
| `BuilderStatus` Visa Type (design exploration only)      | 🔬 Speculative — no candidate issuer engaged | [#141](https://github.com/FG-AI4H/oci-platform/issues/141) · [#135](https://github.com/FG-AI4H/oci-platform/issues/135) |

### Steering decisions blocking advanced phases

| Decision                                                                         | Tracked                                                    |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Endorse ADR-0003                                                                 | [#136](https://github.com/FG-AI4H/oci-platform/issues/136) |
| Charter OCI ACT (named reviewers from convening organisations)                   | [#137](https://github.com/FG-AI4H/oci-platform/issues/137) |
| Mandate legal review of DUA template (researcher + builder + LMIC clauses)       | [#138](https://github.com/FG-AI4H/oci-platform/issues/138) |
| Decide tier-mapping policy (which dataset categories require QES vs AdES vs SES) | [#139](https://github.com/FG-AI4H/oci-platform/issues/139) |
| Add access-governance to OCI–Sage Bionetworks technical sync agenda              | [#140](https://github.com/FG-AI4H/oci-platform/issues/140) |
| Propose `BuilderStatus` Visa Type extension to GA4GH WG-Data                     | [#141](https://github.com/FG-AI4H/oci-platform/issues/141) |

## User UI preferences

| Capability                                                                     | Status                                          | Shipped in                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| Per-user `UserPreferences` API + DB persistence (`/v2/preferences/me`)         | ✅ Live                                         | PR M ([#144](https://github.com/FG-AI4H/oci-platform/pull/144))   |
| `/settings` page with theme / density / locale form                            | ✅ Live                                         | PR M                                                              |
| Dark mode — system + explicit light/dark override (cookie-driven SSR, no FOUC) | ✅ Live                                         | PR M                                                              |
| Locale validation (BCP-47) — persisted preference                              | ✅ Live (preference) / 🚧 Planned (string i18n) | PR M / [#124](https://github.com/FG-AI4H/oci-platform/issues/124) |

## Documentation surface

| Capability                                                                         | Status             | Shipped in                                                      |
| ---------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| Multi-audience documentation framework (overview + 6 audience folders)             | ✅ Live            | PR #97                                                          |
| AI-builder audience folder (`docs/for-ai-builders/`)                               | ✅ Live            | PR M ([#144](https://github.com/FG-AI4H/oci-platform/pull/144)) |
| Plain-English access-governance master at `docs/overview/access-governance.md`     | ✅ Live            | PR M                                                            |
| ADR-0003: tiered identity assurance + GA4GH-first                                  | ✅ Live (proposed) | PR M                                                            |
| Field research synthesis (internal companion repo, see ADR-0003 ref)               | ✅ Live            | PR M                                                            |
| Strategy positioning brief at `docs/for-strategy/access-governance-positioning.md` | ✅ Live            | PR M                                                            |

## Annotation, evaluation, reporting

| Capability                                          | Status     | Shipped in                                                    |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| Annotation tool (legacy Spring Boot) port to NestJS | 🚧 Phase B | [#45](https://github.com/FG-AI4H/oci-platform/issues/45) epic |
| Evaluation engine (legacy Django) port to NestJS    | 🚧 Phase C | [#46](https://github.com/FG-AI4H/oci-platform/issues/46) epic |
| Regulator reporting portal                          | 🚧 Phase D | [#47](https://github.com/FG-AI4H/oci-platform/issues/47) epic |
| DMXP v1.0 federated connectors                      | 🚧 Phase E | [#48](https://github.com/FG-AI4H/oci-platform/issues/48) epic |

## Security & operations

| Capability                                                             | Status     | Shipped in |
| ---------------------------------------------------------------------- | ---------- | ---------- |
| AWS CDK end-to-end (network / data / api / web / observability)        | ✅ Live    | Phase A    |
| Cognito (3 environments)                                               | ✅ Live    | Phase A    |
| Aurora Postgres Serverless v2 (multi-AZ in int/prod)                   | ✅ Live    | Phase A    |
| KMS encryption (CMK rotated annually)                                  | ✅ Live    | Phase A    |
| WAFv2 on int/prod                                                      | ✅ Live    | Phase A    |
| Trivy + Gitleaks + CycloneDX SBOM in CI                                | ✅ Live    | Phase A    |
| OIDC-only deploys (no static AWS keys)                                 | ✅ Live    | Phase A    |
| Deploy hygiene — Node 24 actions + `@oci/croissant` build in web image | ✅ Live    | PR #102    |
| OpenTelemetry / X-Ray instrumentation                                  | 🚧 Partial | Ongoing    |
| Platform-wide audit feed — `@oci/audit` + `AuditEvent` (ADR-0014)      | ✅ Live    | #257       |

## Annotation track

Architecture locked in ADR-0006…0012 (2026-05-15/16); implementation tracking under umbrella epic [#212](https://github.com/FG-AI4H/oci-platform/issues/212) with 14 sub-epics + 8 cross-cutting sub-issues. Phase B.A.1 (re-activation) starts with #213/#214/#215/#222/#223/#225 + sub-issues; Phase B.A.2 brings the 3-gate SOP to full multi-annotator workflows; Phase B.A.3 lands persistence (DICOM SR / FHIR / Croissant-RAI) + audit + retention; Phase B.A.4 closes the Croissant ingestion loop annotation-side.

| Capability                                                                                                                 | Status         | Tracked in                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture locked** — 7 ADRs covering orchestrator + contract + persistence + workflow + blinding + rejection + rights | ✅ Live        | [ADR-0006](../adr/0006-annotation-integration-hub-orchestrator.md) → [ADR-0012](../adr/0012-annotation-rights-licensing-annotator-agreement.md)                                                                                                                   |
| Domain port to Prisma (no legacy MySQL ETL — L9)                                                                           | 🚧 Planned     | [#213](https://github.com/FG-AI4H/oci-platform/issues/213) (E1)                                                                                                                                                                                                   |
| Tool-integration contract + registry (RFC 8693, presigned URLs, `metadataBundle`)                                          | 🚧 Planned     | [#214](https://github.com/FG-AI4H/oci-platform/issues/214) (E2) + sub-issue [#231](https://github.com/FG-AI4H/oci-platform/issues/231)                                                                                                                            |
| Workflow engine + 3-gate SOP + sample rejection + output-license declaration                                               | 🚧 Planned     | [#215](https://github.com/FG-AI4H/oci-platform/issues/215) (E3) + sub-issues [#229](https://github.com/FG-AI4H/oci-platform/issues/229) / [#232](https://github.com/FG-AI4H/oci-platform/issues/232) / [#235](https://github.com/FG-AI4H/oci-platform/issues/235) |
| IRR scoring (Krippendorff α, Cohen's κ, Dice, Hausdorff) + intra-rater + STAPLE                                            | 🚧 Planned     | [#216](https://github.com/FG-AI4H/oci-platform/issues/216) (E4)                                                                                                                                                                                                   |
| Audit + provenance + EU MDR retention + RTBF pseudonymisation                                                              | 🚧 Planned     | [#217](https://github.com/FG-AI4H/oci-platform/issues/217) (E5) + sub-issue [#236](https://github.com/FG-AI4H/oci-platform/issues/236)                                                                                                                            |
| Persistence outputs — DICOM SR (TID-1500/1410/1411) + FHIR R5 + Croissant-RAI                                              | 🚧 Planned     | [#218](https://github.com/FG-AI4H/oci-platform/issues/218) (E6)                                                                                                                                                                                                   |
| Annotation UI port (Next.js + shadcn/ui) + per-task instructions + rejection UI + blinding-aware                           | 🚧 Planned     | [#222](https://github.com/FG-AI4H/oci-platform/issues/222) (E10) + sub-issues [#230](https://github.com/FG-AI4H/oci-platform/issues/230) / [#233](https://github.com/FG-AI4H/oci-platform/issues/233)                                                             |
| Catalog ↔ annotation linkage (FK + manifest-version + new-distribution write-back)                                         | 🚧 Planned     | [#223](https://github.com/FG-AI4H/oci-platform/issues/223) (E11)                                                                                                                                                                                                  |
| Consent management + annotator-agreement signing (reuses DocuSeal AdES #128)                                               | 🚧 Planned     | [#224](https://github.com/FG-AI4H/oci-platform/issues/224) (E12) + sub-issue [#234](https://github.com/FG-AI4H/oci-platform/issues/234)                                                                                                                           |
| Documentation suite (developers / operators / hosts / governance)                                                          | 🚧 Planned     | [#225](https://github.com/FG-AI4H/oci-platform/issues/225) (E14)                                                                                                                                                                                                  |
| Decommission legacy `health.aiaudit.org/annotation` (Aurora MySQL + EB)                                                    | 🚧 Planned     | [#226](https://github.com/FG-AI4H/oci-platform/issues/226) (E13)                                                                                                                                                                                                  |
| MONAI Label integration (AI-assist + active learning + pre-annotation)                                                     | 🔬 C+ deferred | [#220](https://github.com/FG-AI4H/oci-platform/issues/220) (E8)                                                                                                                                                                                                   |
| OHIF Viewer integration (DICOM 2D)                                                                                         | 🔬 C+ deferred | [#221](https://github.com/FG-AI4H/oci-platform/issues/221) (E9)                                                                                                                                                                                                   |
| Visian re-integration (3D brain) — dormant student project; reactivation requires only adapter config                      | 🔬 C+ deferred | [#219](https://github.com/FG-AI4H/oci-platform/issues/219) (E7)                                                                                                                                                                                                   |

## Mail & operator notifications

| Capability                                                                                           | Status  | Shipped in                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SES per-env domain identity (`<env>.oci.ai4h.net`) — Easy-DKIM + SPF + DMARC + mail-from             | ✅ Live | [ADR-0004](../adr/0004-ses-mail-per-env-identity.md) · PR [#194](https://github.com/FG-AI4H/oci-platform/pull/194) · runbook [docs/for-operators/ses.md](../for-operators/ses.md)                                                                                                       |
| SES inbound forwarder — `oci-act@<env>.oci.ai4h.net` → operator mailbox via S3 + Lambda              | ✅ Live | PR [#197](https://github.com/FG-AI4H/oci-platform/pull/197) (+ fixes in [#199](https://github.com/FG-AI4H/oci-platform/pull/199) / [#200](https://github.com/FG-AI4H/oci-platform/pull/200))                                                                                            |
| SMTP-to-SES relay — in-VPC Fargate service so DocuSeal (and future senders) reach SES via plain SMTP | ✅ Live | [ADR-0005](../adr/0005-smtp-to-ses-bridge-for-docuseal.md) · PR [#203](https://github.com/FG-AI4H/oci-platform/pull/203) (+ fixes through [#209](https://github.com/FG-AI4H/oci-platform/pull/209)) · all outbound notifications stay inside AWS Frankfurt (no third-party mail vendor) |
| SES production access (out of sandbox in eu-central-1)                                               | ✅ Live | AWS Support case (one-time, account-wide)                                                                                                                                                                                                                                               |

## Tooling & governance

| Capability                                                            | Status       | Shipped in                                                           |
| --------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| GitHub issue templates (feature / follow-up / steering / adr-blocked) | 🚧 In flight | [#143](https://github.com/FG-AI4H/oci-platform/issues/143) → PR #145 |

## Legend

- ✅ **Live** — shipped to `main`.
- ✅ Live (proposed) — for ADRs that are proposed but not yet endorsed by Steering Committee. Architectural commitment is in the repo.
- 🚧 **In flight** — open PR or actively being implemented this week.
- 🚧 **Planned** — issue is open and scoped; implementation hasn't started.
- ❌ Out of scope (none currently).

## How this matrix stays accurate

1. Updating this table is part of definition-of-done for every shipped feature.
2. The matrix is cross-checked against the GitHub project board, ADRs, and merged PRs periodically; drift surfaces as `[follow-up]` issues.

If you spot drift, file a `[follow-up]` issue and tag `documentation`.
