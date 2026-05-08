# Feature status

The live capability matrix. Updated on every shipped feature (per the [orchestrator skill's docs step](../../.claude/skills/oci-fullstack-feature-scaffold/SKILL.md#9-update-the-audience-documentation)).

Last update: **2026-05-08** (after PR I + PR J.1).

## Catalogue

| Capability | Status | Shipped in |
| --- | --- | --- |
| Public dataset listing + search | ✅ Live | PR C |
| Dataset detail page | ✅ Live | PR C / PR G (visual pass) |
| JSON-LD discoverability (Google Dataset Search, sitemap, robots) | ✅ Live | PR C |
| Host workflow — create draft, publish manifest | ✅ Live | PR D |
| Croissant 1.1 manifest validation (Croissant + RAI + BioCroissant) | ✅ Live | `@oci/croissant` |
| Federation — peer registration + harvester | ✅ Live | PRs E.1 / E.2 / E.3 |
| Source filter (`local` / `federated` / `all`) | ✅ Live | PR E.2 |
| Public Croissant catalogue endpoint (federation outbound) | ✅ Live | PR C |

## Storage & distributions

| Capability | Status | Shipped in |
| --- | --- | --- |
| Upstream URL distributions (manifest references external host) | ✅ Live | PR D |
| Self-hosted distributions — multipart upload | ✅ Live | PR I |
| Self-hosted distributions — gated download (visibility + access-request aware) | ✅ Live | PR I |
| Manifest republish adopts platform-hosted contentUrls back into S3 metadata | ✅ Live | PR I |
| CLI tool for TB-scale uploads | 🚧 Planned | #88 |
| External S3 mount for petabyte datasets | 🚧 Planned | #89 |

## Access governance

| Capability | Status | Shipped in |
| --- | --- | --- |
| Access request — create / list / decide | ✅ Live | PR F |
| Structured intended-use form (project + DUO terms + IRB + retention + redistribution + output) | ✅ Live | PR J.1 |
| DUO permission terms on the dataset (`consentCode`) | ✅ Live | PR J.1 |
| Auto-matcher (MATCHED / CONFLICT / UNCLEAR) | ✅ Live | PR J.1 |
| Publish-time fail-closed for non-PUBLIC without DUO terms | ✅ Live | PR J.1 |
| DUA template generation + e-sign | 🚧 Planned | PR J.2 |
| DAC escalation routing | 🚧 Planned | PR J.2 |
| Email notifications on access-request decisions | 🚧 Planned | #93 |
| Regulator audit-trail export endpoint | 🚧 Planned | Phase D |

## Annotation, evaluation, reporting

| Capability | Status | Shipped in |
| --- | --- | --- |
| Annotation tool (legacy Spring Boot) port to NestJS | 🚧 Phase B | #45 epic |
| Evaluation engine (legacy Django) port to NestJS | 🚧 Phase C | #46 epic |
| Regulator reporting portal | 🚧 Phase D | #47 epic |
| DMXP v1.0 federated connectors | 🚧 Phase E | #48 epic |

## Security & operations

| Capability | Status | Shipped in |
| --- | --- | --- |
| AWS CDK end-to-end (network / data / api / web / observability) | ✅ Live | Phase A |
| Cognito (3 environments) | ✅ Live | Phase A |
| Aurora Postgres Serverless v2 (multi-AZ in int/prod) | ✅ Live | Phase A |
| KMS encryption (CMK rotated annually) | ✅ Live | Phase A |
| WAFv2 on int/prod | ✅ Live | Phase A |
| Trivy + Gitleaks + CycloneDX SBOM in CI | ✅ Live | Phase A |
| OIDC-only deploys (no static AWS keys) | ✅ Live | Phase A |
| OpenTelemetry / X-Ray instrumentation | 🚧 Partial | Ongoing |

## Legend

- ✅ Live in production / shipped to `main`.
- 🚧 Planned / in flight — link points to the GitHub epic or issue.
- ❌ Explicitly out of scope (none currently).
