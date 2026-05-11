# Feature status

The live capability matrix. Updated on every shipped feature (per the [orchestrator skill's docs step](../../.claude/skills/oci-fullstack-feature-scaffold/SKILL.md#9-update-the-audience-documentation)).

Last update: **2026-05-09** (after the six-PR DAP-foundation slice — #115/#116/#117/#118/#119/#120 all live).

## At a glance

- ✅ **Foundation (Phase A)** complete: monorepo, CDK, three environments, Cognito, NestJS + Next.js skeletons, full CI/CD.
- ✅ **Catalog (Phase B core)** shipped: list + detail + faceted search + manifest wizard + raw-JSON view + JSON-LD discoverability + federation harvest.
- ✅ **Access governance (Phase B basics)** shipped: structured intended-use form, DUO matcher, status-aware access CTA, post-submit confirmation flow.
- ✅ **User UI preferences** shipped: dark mode + density + locale (PR M, #144).
- ✅ **Access governance (Phase B Phase-1)** shipped: tiered access model (#115), email-domain classifier (#116), certification quiz (#117), click-wrap with SHA-256 + KMS receipt (#118), commercial-use terms (#119), builder-vs-researcher form variants (#120). All committed in [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md).
- 🚧 **Access governance (Phase B Phase-2)** — ORCID, GA4GH Passport (RP + issuer), DocuSeal AdES + DUA templates, renewal cron. Tracked as #125-130.
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

[ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md) commits the platform to a tiered identity assurance + GA4GH-Passport-first model, with researchers AND AI solution developers as first-class audiences. Plain-English explainer at [overview/access-governance.md](./access-governance.md). Strategy positioning at [for-strategy/access-governance-positioning.md](../for-strategy/access-governance-positioning.md). Field research at [research/access-governance-2026-05-08.md](../research/access-governance-2026-05-08.md).

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

| Capability                                                                   | Status     | Tracked                                                    |
| ---------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| ORCID OAuth integration                                                      | ✅ Live    | [#125](https://github.com/FG-AI4H/oci-platform/issues/125) |
| GA4GH Passport relying party (verify Visas from ELIXIR AAI / NIH RAS / Sage) | ✅ Live    | [#126](https://github.com/FG-AI4H/oci-platform/issues/126) |
| OCI as Passport issuer (JWKS endpoint, sign own Visas)                       | ✅ Live    | [#127](https://github.com/FG-AI4H/oci-platform/issues/127) |
| DocuSeal self-hosted on Fargate (AdES DUA signing)                           | 🚧 Planned | [#128](https://github.com/FG-AI4H/oci-platform/issues/128) |
| DUA template engine (researcher + builder + LMIC variants)                   | ✅ Live    | [#129](https://github.com/FG-AI4H/oci-platform/issues/129) |
| Renewal cron (BullMQ) — 30-day pre-expiry email + auto-revoke                | ✅ Live    | [#130](https://github.com/FG-AI4H/oci-platform/issues/130) |

### Phase 3 (6–12 months, gated on demand)

| Capability                                               | Status     | Tracked                                                    |
| -------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Yousign QES via AWS Marketplace (SENSITIVE-tier signing) | 🚧 Planned | [#131](https://github.com/FG-AI4H/oci-platform/issues/131) |
| eduGAIN SP via SWITCHaai (academic SAML SSO)             | 🚧 Planned | [#132](https://github.com/FG-AI4H/oci-platform/issues/132) |
| OCI ACT operator review UI (SENSITIVE-tier inbox)        | 🚧 Planned | [#133](https://github.com/FG-AI4H/oci-platform/issues/133) |
| Validated User flow (ID-document review pipeline)        | 🚧 Planned | [#134](https://github.com/FG-AI4H/oci-platform/issues/134) |
| WHO Innovation Hub accreditation pre-grant Visa          | 🚧 Planned | [#135](https://github.com/FG-AI4H/oci-platform/issues/135) |

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
| Field research synthesis at `docs/research/access-governance-2026-05-08.md`        | ✅ Live            | PR M                                                            |
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

## Tooling & governance

| Capability                                                             | Status       | Shipped in                                                           |
| ---------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| `/roadmap-audit` skill — doc/board/feature-status reconciliation       | ✅ Live      | (project-scoped skill, gitignored)                                   |
| GitHub issue templates (feature / follow-up / steering / adr-blocked)  | 🚧 In flight | [#143](https://github.com/FG-AI4H/oci-platform/issues/143) → PR #145 |
| `feedback_track_tasks_in_github` rule (memory) — every task → GH issue | ✅ Live      | (memory-only; project-scoped rule for all sessions)                  |

## Legend

- ✅ **Live** — shipped to `main`.
- ✅ Live (proposed) — for ADRs that are proposed but not yet endorsed by Steering Committee. Architectural commitment is in the repo.
- 🚧 **In flight** — open PR or actively being implemented this week.
- 🚧 **Planned** — issue is open and scoped; implementation hasn't started.
- ❌ Out of scope (none currently).

## How this matrix stays accurate

1. The `oci-fullstack-feature-scaffold` orchestrator skill mandates updating this table when a feature ships.
2. The `roadmap-audit` skill cross-checks this matrix against the GitHub project board, ADRs, and merged PRs to surface drift.
3. The `feedback_track_tasks_in_github` rule ensures every task discussed in a Claude Code session lands as a GitHub issue, so the matrix has something concrete to point to.

If you spot drift, file a `[follow-up]` issue (template available) and tag `documentation`.
