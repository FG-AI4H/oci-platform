# OCI Modernization — GitHub Project items

**Target project:** https://github.com/orgs/FG-AI4H/projects/3/views/1
**Issue host repo:** `FG-AI4H/annotation-tool` (issues live here, project pulls them in)

Structure: **Phase → Epic → Issue (Feature/Task)**. Each issue title is prefixed with the phase letter so the project board can group naturally.

---

## Phase A — Foundation (months 1-2)

### Epic A1: Monorepo + tooling baseline

- **[A] Initialise `oci-platform` monorepo (Turborepo + pnpm workspaces)**
  Set up apps/ packages/ infra/, ESLint, Prettier, TypeScript strict, Vitest. Lock Node 20 LTS.
- **[A] CI pipeline (GitHub Actions)**: lint + typecheck + test + build matrix; reusable workflows in `.github/workflows`.
- **[A] CDK skeleton in `infra/cdk/`**: VPC reuse, ECR, ECS Fargate cluster, ALB, RDS Aurora PG, Cognito user pool, S3 + CloudFront.
- **[A] Distroless Node 20 base image** for app + worker containers; SBOM generation in CI.
- **[A] Observability baseline**: OpenTelemetry SDK, CloudWatch + structured logs, Sentry-equivalent (or AWS Embedded Metrics).

### Epic A2: Cognito as unified IdP

- **[A] Provision Cognito user pool + groups** (annotator, reviewer, supervisor, host, participant, regulator, admin) via CDK.
- **[A] Federate Django allauth users → Cognito** (one-shot migration script with email-verification preservation).
- **[A] Token-bridge middleware** so legacy Django and new NestJS accept Cognito JWT during dual-running.
- **[A] Replace annotation-tool Cognito wiring** to use the unified pool (vs. existing per-app pool).

### Epic A3: NestJS + Next.js skeletons

- **[A] NestJS API skeleton** with health, OpenAPI docs, JWT-auth guard against Cognito JWKS.
- **[A] Prisma schema (initial)**: users, organizations, sessions; first migration applied to Aurora PG.
- **[A] Next.js 14 web app skeleton** (App Router, RSC, shadcn/ui + Tailwind installed, Cognito Hosted UI integration).
- **[A] Reverse-proxy routing strategy**: ALB rules + nginx config to fan out `/api/v2/*` → new NestJS while everything else stays on Django.
- **[A] Staging environment deployed end-to-end**: CDK up, sample request hits new NestJS, returns 200.

---

## Phase B — Annotation reactivation (months 3-6)

### Epic B1: Port annotation domain to NestJS

- **[B] Port `Campaign` model + endpoints to NestJS module** (preserve API contract for FE migration).
- **[B] Port `Task / Sample / Annotation` models + endpoints**.
- **[B] Port `Dataset / DatasetMetadata` (~30 metadata fields) to Prisma**.
- **[B] Port `DataCatalog / DataAccessRequest` flows** including AWS Glue integration.
- **[B] Port `AnnotationTool` registry + `DatasetRole` permissions**.
- **[B] Reuse OpenAPI spec from `annotation-tool/src/main/resources/api/openapi.yaml`** as the NestJS contract; verify with contract tests.
- **[B] One-shot migration: Aurora MySQL → Aurora Postgres** for annotation data; keep MySQL snapshot for 90 days.

### Epic B2: Implement reported-but-not-shipped features (Nov 2024 backlog)

- **[B] Annotation conflict management** (reviewer / supervisor adjudication workflow).
- **[B] Consent management for datasets** (consent records + revocation API + audit trail).
- **[B] Burndown chart** in operator dashboard (per Oct 2024 report).
- **[B] Pre-annotation engine** wiring (currently only schema fields on `CampaignEntity`): connect a generic Docker-based annotation tool, including HPI's pre-annotation Docker.
- **[B] Visian 3D annotation embedded integration** (currently only a name reference).
- **[B] Per-image annotation progress visualisation** (replaces hardcoded demo UUID in `CampaignProgress`).

### Epic B3: New Next.js annotation UI

- **[B] Replace `annotation-frontend` (CRA + MUI + Amplify v4)** with Next.js 14 routes under `/annotation/*`.
- **[B] Migrate Kanban board** (`@dnd-kit`) into shared UI package.
- **[B] Migrate Croissant ingestion modal** into shared UI package.
- **[B] Replace AWS SDK v2 with v3 modular packages** in any client-side code that remains.

### Epic B4: Sunset legacy annotation

- **[B] Cutover `health.aiaudit.org/annotation/*` routes to new platform** behind feature flag.
- **[B] Archive `FG-AI4H/annotation-tool` repo (mark read-only)** with sunset README.
- **[B] Archive `FG-AI4H/annotation-frontend` repo (mark read-only)**.
- **[B] Decommission Aurora MySQL cluster** (`fg-ai4h-db`) after 90-day snapshot retention.

---

## Phase C — Challenges / Evaluation (months 7-10)

### Epic C1: NestJS challenge / submission domain

- **[C] Port Django `apps/challenges` + `apps/jobs` + `apps/participants` to NestJS modules**.
- **[C] Submission lifecycle**: create → enqueue (SQS) → run via existing Python eval-worker → write results → publish leaderboard.
- **[C] Leaderboard module** (read-side): keep existing scoring semantics for KDDI / SoM / OPEA challenges.
- **[C] Challenge-host portal in Next.js** (replaces Django admin and `frontend_v2/`).
- **[C] Participant portal in Next.js** (challenge browser, submissions, leaderboards) replacing `frontend_ai4good`.

### Epic C2: Worker reuse strategy

- **[C] Wrap Python eval-worker behind a stable SQS contract** so business logic moves to NestJS but execution sandbox stays Python+Docker.
- **[C] New TypeScript worker-ingest** for Croissant manifest ingestion + Glue catalog refresh (replaces Lambda invocation flow).

### Epic C3: Live-challenge migration

- **[C] Migrate KDDI Research Challenge to new platform** behind feature flag.
- **[C] Migrate Synesthesia of Machines (SoM) Challenge** to new platform.
- **[C] Migrate OPEA Innovation Challenge (#492)** to new platform.
- **[C] DNS cutover for `competition.aiforgood.itu.int`** to point at new ALB.
- **[C] Decommission Django backend**.
- **[C] Decommission `frontend_v2/` and `frontend_ai4good/`**.

---

## Phase D — Reporting + regulator portal (months 11-13)

### Epic D1: Reporting domain

- **[D] Reporting module in NestJS** wrapping existing Reporting-Package work (coordinate with Golam).
- **[D] Report templates** (research, regulator submission, model-card, internal QA).
- **[D] Machine-readable report format** — JSON-LD + signed PDF generation.
- **[D] Audit-trail module (cross-cutting)**: dataset → annotation → model → prediction → metric → report lineage.

### Epic D2: Regulator portal

- **[D] New Next.js `(regulator)` route group**: scoped, locked-down access via Cognito group.
- **[D] Per-AI-device review packet** UI: aggregates dataset, annotation campaign, model submission, metrics, reports.
- **[D] Tamper-evident report signing** (S3 Object Lock + cryptographic signature).

---

## Phase E — DMXP + federated extensions (months 14-18)

### Epic E1: DMXP implementation

- **[E] DMXP v0.1 design doc finalised** (mapped from WG-Data ToR §4.2).
- **[E] DMXP v1.0 protocol implementation** (data authentication, provenance, usage rights, audit trails).
- **[E] DMXP reference implementation + tooling** (CLI + SDK).
- **[E] Compatibility shim with Model Context Protocol (MCP)**.

### Epic E2: Federated extensions

- **[E] Federated storage connectors** (read-only adapters for Azure Blob, GCS, on-prem S3-compatible).
- **[E] Federated learning hooks** (initially: read-only data discovery; full FL deferred to 2028).
- **[E] Croissant aggregator** for cross-vendor catalogue (WG-Data WS-1 medium-term deliverable).

### Epic E3: WG-Data normative deliverables

- **[E] Healthcare Croissant (BIOCroissant) Extension v1.0** ingestion live.
- **[E] Ontology compatibility layer** (ICD-10/11, SNOMED CT, UMLS, LOINC mapping).
- **[E] MedEval-GI benchmark suite v1** integration.

---

## Cross-cutting (each phase)

- **[X] Documentation** — ADRs for every major decision in `docs/adr/NNNN-*.md`.
- **[X] Security baseline** — quarterly Security Hub remediation cadence; SBOM in CI; Dependabot.
- **[X] Performance budget** — page-load < 2s on regulator portal; API p95 < 300ms.
- **[X] Accessibility** — WCAG 2.1 AA baseline.
