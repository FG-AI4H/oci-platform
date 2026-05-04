# OCI Platform

> Open Code Infrastructure — unified platform for the **ITU-WHO-WIPO Global Initiative on AI for Health (GI-AI4H)**. Consolidates the GI-AI4H **evaluation**, **annotation**, and **reporting** packages onto a single TypeScript-first stack. Builds on the work of the prior FG-AI4H Focus Group (2018-2023).

[![CI](https://github.com/FG-AI4H/oci-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/FG-AI4H/oci-platform/actions/workflows/ci.yml)
[![Project](https://img.shields.io/badge/plan-Project%20%233-blue)](https://github.com/orgs/FG-AI4H/projects/3)

## What's in here

```
apps/
  api/           NestJS 11 — modular monolith (identity, catalog, storage, annotation, prediction, evaluation, reporting)
  web/           Next.js 16 — public + operator + regulator UI
  worker-eval/   Python sandbox runner for participant Docker images (only Python in repo)
  worker-ingest/ TS SQS consumer for Croissant manifest ingestion
packages/
  database/      Prisma schema + generated client
  shared-types/  Zod schemas shared FE/BE
  ui/            shadcn/ui + design tokens
  auth/          Cognito helpers FE/BE
  croissant/     BIOCroissant validators / ingest helpers
infra/
  cdk/           AWS CDK — VPC, Cognito, Aurora, ECS, ALB, CloudFront, WAF, S3, Logs
.github/workflows/  CI + dev/int/prod deploy via OIDC
docs/             Architecture, getting-started, security, deployment, ADRs, migration plan
.claude/skills/   Project-scoped Claude Code skills (security review, ADR, scaffold, migrations, …)
scripts/          Bootstrap & maintenance
```

## Strategic context

This monorepo replaces three legacy stacks (originally built under the FG-AI4H Focus Group, now under GI-AI4H):

| Legacy                                    | Stack                             | Status                                             |
| ----------------------------------------- | --------------------------------- | -------------------------------------------------- |
| `fgai4h-evaluation-platform`              | Django 2.2, Python 3.9, AngularJS | Production — absorbed Phase C                      |
| `annotation-tool` + `annotation-frontend` | Spring Boot 3.2.5 + React/CRA     | Maintenance mode since Nov 2024 — absorbed Phase B |
| `Reporting-Package`                       | Mixed                             | Coordination Phase D (Golam)                       |

The plan is a 5-phase strangler-fig migration over 12-18 months. See:

- [`docs/platform-modernization-assessment.md`](./docs/platform-modernization-assessment.md) — strategy
- [`docs/architecture.md`](./docs/architecture.md) — current architecture summary
- [`docs/migration/strangler-plan.md`](./docs/migration/strangler-plan.md) — operational plan
- [`docs/oci-milestones-2026-2027.md`](./docs/oci-milestones-2026-2027.md) — package roadmap aligned with WG-Data
- [`docs/security.md`](./docs/security.md) — security baseline (non-negotiable)
- [`docs/deployment.md`](./docs/deployment.md) — dev/int/prod via GHA OIDC
- [`docs/links.md`](./docs/links.md) — every reference

## Quick start

```bash
git clone git@github.com:FG-AI4H/oci-platform.git
cd oci-platform
./scripts/bootstrap.sh
docker compose -f infra/local/docker-compose.yml up -d
pnpm --filter @oci/database db:migrate:dev
pnpm dev
```

Open `http://localhost:3000/docs` (NestJS Swagger) and `http://localhost:3001` (Next.js).

Full setup details: [`docs/getting-started.md`](./docs/getting-started.md).

## Stack (verified 2026-05-02)

- **Node.js 24 LTS** · **pnpm 10.33** · **Turborepo 2.9** · **TypeScript 6**
- **NestJS 11** + **Fastify 5** + **Prisma 7** + **Aurora Postgres**
- **Next.js 16** (App Router, RSC, Turbopack) + **Tailwind CSS 4** + **shadcn/ui**
- **AWS CDK 2.252** — IaC for VPC, Cognito, Aurora Serverless v2, ECS Fargate (ARM64), ALB, CloudFront, WAFv2, S3, KMS, CloudWatch
- **GitHub Actions OIDC** for dev/int/prod deploy. No static AWS keys, anywhere.

Why these choices: see [`docs/platform-modernization-assessment.md`](./docs/platform-modernization-assessment.md) §2.1.

## Security

- KMS-CMK at rest, TLS 1.3 in transit, WAFv2 on int/prod, Cognito (PLUS in prod) with mandatory MFA for privileged roles.
- Trivy + Gitleaks + CycloneDX SBOM in every PR.
- Distroless Node 20 base images.
- Quarterly Security Hub remediation cadence.

Full contract: [`docs/security.md`](./docs/security.md).

## License

[BSD 3-Clause](./LICENSE) — same as the rest of GI-AI4H. Built as a global public good under the ITU-WHO-WIPO Global Initiative on AI for Health.

## Maintainers

Marc Lecoultre (@mllabai) — lead architect, WG-Data Co-Chair · Luis Oala (Dotphoton AG) — WG-Data Co-Chair · Eva Keller (ITU) — full-stack support · Vietnam dev team — backend/frontend.
