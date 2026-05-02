# OCI Platform Modernization & Consolidation — Assessment & Plan

**Date:** 2026-05-02
**Author:** Marc Lecoultre
**Decision needed by:** Q3 2026 kickoff (per OCI 2026-2027 milestones)
**Audience:** Simao Campos, Bilel Jamoussi, WG-Data leadership

---

## TL;DR

The OCI today is **three independent platforms** (Eval / Annotation / Reporting) on **three different stacks** (Django, Spring Boot, ad-hoc) with **multiple frontend technologies** (AngularJS, Angular 7, React 18). Several stacks are end-of-life (Django 2.2 since 2022, Angular 7, AngularJS, CRA). The annotation track has been on maintenance mode since Nov 2024 and ~30% of features that have been reported to Simao were never actually shipped (see `annotation-project-gap-analysis.md`).

**Recommendation:** consolidate to a **TypeScript-first stack** — **NestJS** (backend) + **Next.js 14 with shadcn/ui** (frontend) — in a **monorepo (Turborepo)** with shared types and UI components. Migrate via **strangler fig** over 12-18 months: current platforms keep running, new NestJS services take over one bounded context at a time. Drop Python entirely; sunset Spring Boot in favour of NestJS to standardise the team on a single language.

This unlocks: feature reactivation (the Nov-2024 backlog), full WG-Data DMXP / BIOCroissant integration, cross-package single sign-on, regulator-ready audit trail (one codebase, one log stream, one identity).

---

## 1. Current state

### 1.1 Three platforms, three stacks

| Track | Repo | Backend | Frontend | Status |
|---|---|---|---|---|
| **OCI Evaluation** | `fgai4h-evaluation-platform` | **Django 2.2** (EOL April 2022!), Python 3.9, Celery 4.3, DRF 3.10 | `frontend_ai4good/` AngularJS (gulp/bower era) + `frontend_v2/` Angular 7 | Active, production at `health.aiaudit.org` |
| **Annotation** | `annotation-tool` + `annotation-frontend` | **Spring Boot 3.2.5**, Java 17, JPA, MySQL | React 18, **MUI 5**, AWS Amplify v4, CRA / `react-scripts 5` (deprecated) | Maintenance mode since Nov 2024 |
| **Reporting** | `Reporting-Package` (FG-AI4H org) | (separate, less inspected here) | — | Integration in progress (Golam) |

### 1.2 Common infrastructure

- AWS account `601883093460` (eu-central-1)
- ECS for workers; EC2 + Docker Compose for the eval platform; (mostly) Cognito for annotation auth
- Aurora MySQL + Aurora PostgreSQL, S3, SQS, SES, CloudWatch Logs
- GitHub Actions (limited), SonarCloud (annotation-tool only)

### 1.3 Critical EOL / risk inventory

| Component | Version | Status | Risk |
|---|---|---|---|
| Django | 2.2.20 | EOL April 2022 | **Critical** — 4 years of unpatched CVEs. Already showing in ECR scan: ~30 critical / 228 high findings traced to Django + Pillow + PyYAML + ImageMagick (per March 2026 security remediation report) |
| Python | 3.9.21 | Security-only support to Oct 2025; EOL 2025 | **High** |
| Angular | 7.2.15 | EOL since 2020 | **High** |
| AngularJS (1.x in `frontend_ai4good`) | (legacy) | LTS ended Dec 2021 | **Critical** |
| `react-scripts` (CRA) | 5.0.1 | Deprecated by React team | Medium |
| AWS Amplify | v4 | 2 majors behind (current v6) | Medium |
| AWS SDK v2 (frontend) | 2.1130.x | Maintenance mode | Medium |
| boto3 | 1.28.78 | Recent enough | Low |
| Spring Boot | 3.2.5 | Current major (3.x), patches available | Low |
| Java | 17 | LTS active | Low |

### 1.4 Architectural pain points (from monthly reports)

- **Three auth flows** (Django session, Cognito, ad-hoc tokens) — slows every cross-feature work
- **No shared identity** between annotation and evaluation — annotators can't seamlessly host or judge challenges
- **No shared component library** — AI4Good rebrand had to be redone in two frontends
- **Database fragmentation** — Aurora MySQL (annotation) + Aurora PostgreSQL (eval); user records duplicated
- **Operational debt** — see April 2026 cert renewal incident (port-80 conflict between Docker and certbot, silent for 90 days)
- **Vietnam dev team underused** — they're skilled in React/Java, would be productive on a unified TS stack with less context-switching

### 1.5 Where does Python actually hurt?

- **Django 2.2 → 4.x migration is a multi-month effort** that has been deferred for 18+ months. Each deferral compounds.
- **EvalAI is a fork of an upstream project that itself stopped tracking Django updates** — there is no upstream cavalry coming.
- Most of the "platform work" reported in 2025-2026 is fighting Django/Python tooling (boto3 caching, awscli pinning, SES backend, S3 storage `s3boto → s3boto3`, supply-chain attack response). This is non-feature work caused by stack age.

---

## 2. Target architecture

### 2.1 Stack decision

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | **TypeScript** (single, end-to-end) | Eliminates Python/Java/JS context switch; types shared across BE/FE; aligns with Vietnam team's strongest existing skill (React+TS) |
| **Backend framework** | **NestJS** | Decorator-based, DI, modular, OpenAPI-first — most familiar to anyone coming from Spring (annotation team). Excellent for monolith-first that can split into microservices when needed (matches OCI 6-package design). |
| **Frontend framework** | **Next.js 14** (App Router, RSC) | Already aligned with the Shadcn UI redesign mentioned in March 2026 report. RSC reduces client bundle; built-in SSR makes regulator-facing pages fast and accessible. Vercel-style ergonomics; deployable on AWS. |
| **UI library** | **shadcn/ui** + Tailwind | Already in flight for challenge-page redesign. Owned by us (no NPM package), customisable, accessible by default. |
| **Forms & validation** | **react-hook-form + zod** | Schema-first validation usable on FE and BE (single source of truth). |
| **API contract** | **OpenAPI 3** (generated by NestJS Swagger module) **+ tRPC** for internal panel/admin | OpenAPI for external (regulators, partners — keeps DMXP-friendly); tRPC for the operator UI (zero schema duplication). |
| **ORM** | **Prisma** | Schema-first DB modelling, type-safe queries. Migration tooling included. |
| **Database** | **Aurora PostgreSQL** (existing, consolidate annotation MySQL into PG) | Single DB engine, schemas per bounded context (annotation, evaluation, reporting). Already deployed for the eval platform. |
| **Auth** | **AWS Cognito** unified | Already used by annotation-tool. Migrate Django allauth users to Cognito. Per OCI 2027 plan (DP package — universal SSO via Cognito). |
| **Background jobs** | **BullMQ** on Redis (or keep SQS via consumer workers) | Replaces Celery. BullMQ has TypeScript-first API; SQS keeps cost down for AWS-native flows. Use both — SQS for ECS-worker challenge submissions, BullMQ for in-process jobs. |
| **Object storage / CDN** | S3 (continue) + CloudFront (add) | Consolidates serving of media + Croissant manifest assets. |
| **Mono-repo tool** | **Turborepo** + npm workspaces | Lightweight, well-supported. Nx is the heavier alternative if we need code-gen plugins. |
| **Testing** | **Vitest** + Playwright + Testcontainers | Fast unit/integration tests; Playwright for E2E; Testcontainers brings up Postgres + LocalStack. |
| **Container** | Distroless Node 20 LTS images | Smaller, fewer CVEs than current Python/Bullseye. |
| **Deployment** | **ECS Fargate** (drop EC2 + docker-compose stack) + **AWS CDK** (TypeScript) for IaC | Same language for app + infra. Fargate kills the cert-renewal class of bugs (no host-level certbot). |

### 2.2 Repo & module layout

```
oci-platform/                          # new monorepo (FG-AI4H/oci-platform)
├── apps/
│   ├── api/                           # NestJS — modular monolith
│   │   ├── modules/
│   │   │   ├── identity/              # users, roles, Cognito federation (DP package)
│   │   │   ├── catalog/               # datasets, Croissant ingestion (DAP package)
│   │   │   ├── storage/               # data-storage permissions, DMXP (DP package)
│   │   │   ├── annotation/            # campaigns, tasks, samples, tools (AP package)
│   │   │   ├── prediction/            # challenges, submissions, workers (PP package)
│   │   │   ├── evaluation/            # metrics, leaderboards (EP package)
│   │   │   ├── reporting/             # report templates, regulator portal (RP package)
│   │   │   └── shared/
│   ├── web/                           # Next.js 14 — public + operator UI
│   │   └── app/
│   │       ├── (public)/              # marketing, challenge browser, leaderboards
│   │       ├── (operator)/            # admin portal: campaign mgmt, dataset curation
│   │       └── (regulator)/           # regulator-facing audit/report portal
│   ├── worker-eval/                   # ECS worker — runs participant Docker images
│   │                                  # (Python OK here — sandbox isolation, never touched in business logic)
│   └── worker-ingest/                 # SQS consumer for Croissant ingestion + Glue catalog refresh
├── packages/
│   ├── database/                      # Prisma schema + generated client
│   ├── shared-types/                  # Zod schemas; shared DTOs
│   ├── ui/                            # shadcn/ui customised; design tokens
│   ├── auth/                          # Cognito helpers shared FE/BE
│   ├── croissant/                     # BIOCroissant validators, generators
│   └── eslint-config/
├── infra/
│   ├── cdk/                           # AWS CDK app — VPC, ECS, RDS, Cognito, S3, CloudFront
│   └── github-actions/                # reusable workflows
└── docs/
```

### 2.3 What stays Python

Only the **submission worker** that runs participant Docker images stays Python (it's a thin SQS-poll + docker-run + result-push wrapper — and EvalAI's worker code is mature). It's behind a stable contract; we don't touch its internals.

Everything else — API, frontend, ingestion, reporting, worker-ingest — becomes TypeScript.

---

## 3. Migration strategy — strangler fig

Keep `health.aiaudit.org` and the annotation tool running unchanged. Build the new platform in parallel. Cut over one bounded context at a time, with feature flags + reverse-proxy routing at the nginx/ALB level.

```
Phase A — bootstrap (months 1-2)
  - Monorepo + CI + CDK
  - Cognito as unified IdP (federate Django users)
  - NestJS + Next.js skeleton, deployed to staging
  - First slice: identity / users (replace Django allauth)

Phase B — annotation reactivation (months 3-6)
  - Port Spring Boot annotation domain → NestJS modules
  - New Next.js annotation UI (replace React/MUI/CRA app)
  - Add the Nov-2024 missing features: conflict mgmt, consent, burndown, pre-annotation pipeline
  - Sunset annotation-tool + annotation-frontend repos

Phase C — challenges / evaluation (months 7-10)
  - NestJS modules for challenge / submission / leaderboard
  - Keep Python eval-worker; new TypeScript-side ingestion
  - Migrate active challenges (KDDI, SoM, OPEA) one at a time behind a feature flag
  - Sunset Django backend

Phase D — reporting + regulator portal (months 11-13)
  - Reporting module + machine-readable JSON-LD reports (RP package)
  - Regulator portal (separate Next.js layout)
  - Audit-trail module (cross-cuts everything)

Phase E — DMXP + federated extensions (months 14-18)
  - DMXP v0.1 → v1.0 implementation (DP package)
  - Federated learning hooks (read-only adapter endpoints first)
  - Croissant aggregator (cross-vendor catalogue, WS-1 / 2027-Q2 deliverable)
```

Feature flags + side-by-side routing make every phase independently reversible. Each cutover is a config change, not a deploy.

---

## 4. Risk & mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Strangler timeline slips → both old + new run for too long | Medium | High | Hard timeline gates per phase; if Phase B slips by >1 month, narrow scope (defer pre-annotation to later phase) |
| Vietnam team learning curve on NestJS / Prisma | Low | Medium | NestJS is structurally similar to Spring (DI, decorators); 2-week dedicated training + pair-coding via Marc/Eva |
| Cognito user migration loses identities | Medium | High | Run Django + Cognito in parallel with token-bridge for 1 month; run shadow auth checks against both before cutover |
| Database consolidation (MySQL → Postgres for annotation) is destructive | Medium | High | Annotation-tool is in maintenance mode → no live data loss risk; do a one-shot dump+convert+verify, keep MySQL snapshot for 90 days |
| Cost overrun (CDK + Fargate + dual-running) | Medium | Medium | Shut down legacy tasks after each phase; dual-running window capped at 4 weeks per phase |
| Loss of EvalAI upstream features we silently depend on | Low | Medium | Audit current Django endpoints used by frontends before Phase C; replicate exact contract in NestJS |
| Botnar funder concern about "rewrite" optics | Medium | Medium | Frame as "modernisation + feature reactivation" backed by gap analysis showing 30% of reported features were never shipped; tie phases to OCI 2026-2027 milestones already approved |
| Existing reporting-package work has to be re-done | Low | Medium | Coordinate with Golam early in Phase D; design the RP module to **wrap** rather than replace his work where possible |

---

## 5. Costs & capacity

**Team** (today):
- Marc — architect / lead
- Eva — full-stack support (per Simao's Sep 2024 onboarding note)
- Vietnam team — 2 devs (Thanh — backend, Khoa — frontend)
- Marc as coordinator with Golam (RP) and frontend dev (weekly sync)

**Capacity check:** the strangler plan above assumes ~3 FTE-equivalent across 12-18 months. That's tight but feasible if **non-modernisation feature work is paused** during Phase A and **substantially reduced** through Phase C. Need explicit Botnar / Simao buy-in on this trade-off.

**Estimated AWS run-rate impact:** dual-running ECS Fargate + RDS is ~+30% AWS spend during transition (4-8 weeks per phase). Net steady-state should be **lower than today** because:
- Drop EC2 server (one bigger instance) → Fargate (right-sized tasks)
- One Aurora cluster (Postgres) instead of two
- CloudFront caching reduces origin egress

---

## 6. Success criteria

By end of Phase E (~18 months):

- [ ] One stack (TypeScript), one API gateway, one identity provider
- [ ] All current platforms (eval / annotation / reporting) migrated; legacy repos archived
- [ ] All Nov-2024 reported-but-not-shipped features actually shipped (gap analysis closes)
- [ ] BIOCroissant Healthcare Extension v1.0 ingestion live
- [ ] DMXP v1.0 implementation complete
- [ ] First regulator-facing assessment report generated end-to-end on the new stack
- [ ] Aurora MySQL decommissioned
- [ ] Django decommissioned
- [ ] Annotation-tool / annotation-frontend repos archived
- [ ] AWS Security Hub: <10 critical findings (down from current ~30 critical / ~228 high)
- [ ] At least 2 LMIC partner institutions onboarded for federated validation (WS-6)

---

## 7. Open questions for Bilel / Simao

1. **Approval to pause non-modernisation feature work** during Phase A (months 1-2) and reduce it through Phase C (months 7-10). Without this, timeline doubles.
2. **Hiring slot** — can we add one more TypeScript-strong engineer in Vietnam for Phase B-C? Strong ROI given the migration backlog.
3. **Reporting-package coordination** — should Golam's current work be paused/aligned, or do we wrap it in Phase D?
4. **Scope of DMXP in 2027** — full v1.0 implementation, or read-only / partner-onboarding subset first?
5. **Botnar reporting cadence** — modernisation milestones map cleanly to Botnar quarterly reports if we want; do we want to make the modernisation itself a tracked milestone?
