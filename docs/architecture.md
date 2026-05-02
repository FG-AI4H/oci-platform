# OCI Platform — Architecture

> **Source-of-truth strategy doc:** [`platform-modernization-assessment.md`](./platform-modernization-assessment.md)
> This page is a developer-facing summary; read the assessment for context, decisions, and rationale.

## High-level

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CloudFront (global edge)                     │
│              (TLS, WAF, security headers, HTTP/2 + HTTP/3)           │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────────┐
│  ALB  (eu-central-1, multi-AZ, TLS 1.3, WAFv2 managed rules)         │
└──────────┬─────────────────────────────────────┬─────────────────────┘
           │                                     │
   ┌───────┴──────────┐                  ┌───────┴───────────┐
   │  apps/web        │                  │  apps/api         │
   │  Next.js 16      │                  │  NestJS 11        │
   │  Fargate (ARM64) │                  │  Fargate (ARM64)  │
   │  auto-scaled     │                  │  auto-scaled      │
   └──────────────────┘                  └─┬─────────┬───────┘
                                           │         │
                            ┌──────────────┘         └────────────────┐
                            │                                          │
                  ┌─────────┴──────────┐                  ┌────────────┴──────┐
                  │ Aurora PG          │                  │  S3 (KMS,         │
                  │ Serverless v2      │                  │   versioned,      │
                  │ multi-AZ in prod   │                  │   block public,   │
                  │ Performance Ins.   │                  │   Object Lock prod│
                  └─────────┬──────────┘                  └───────────────────┘
                            │
                            ▼
                  ┌──────────────────────┐                  ┌──────────────────────┐
                  │ Redis (ElastiCache)  │                  │ SQS                  │
                  │ for BullMQ jobs      │                  │ submissions, ingest  │
                  └──────────────────────┘                  └──────────┬───────────┘
                                                                       │
                                                  ┌────────────────────┴───────────────────┐
                                                  │                                        │
                                       ┌──────────┴───────────┐              ┌─────────────┴──────────┐
                                       │ apps/worker-eval     │              │ apps/worker-ingest     │
                                       │ Python (sandbox)     │              │ TypeScript (Croissant) │
                                       │ Fargate / Spot       │              │ Fargate                │
                                       └──────────────────────┘              └────────────────────────┘
```

Identity is **Cognito** (one user pool per environment) — federated for the dev ↔ legacy
auth bridge, exclusive once Phase A cutover lands.

## Module map (NestJS API)

| Module       | OCI Package | WG-Data WS | Notes                                                  |
| ------------ | ----------- | ---------- | ------------------------------------------------------ |
| `identity`   | DP          | WS-2       | Users, roles, Cognito federation                       |
| `catalog`    | DAP         | WS-1       | Datasets, Croissant ingestion                          |
| `storage`    | DP          | WS-2 / 3   | Storage permissions, DMXP envelopes                    |
| `annotation` | AP          | WS-1 / 4   | Campaigns, tasks, samples, tools                       |
| `prediction` | PP          | WS-2 / 6   | Challenges, submissions, workers                       |
| `evaluation` | EP          | WS-5       | Metrics, leaderboards, MedEval-GI                      |
| `reporting`  | RP          | WS-6       | Report templates, regulator portal, audit trail        |
| `shared`     | -           | -          | Cross-cutting filters, interceptors, guards            |

## Environments

| Env      | URL                            | Aurora min/max ACU | Fargate tasks | WAF | Multi-AZ | Removal policy |
| -------- | ------------------------------ | ------------------ | ------------- | --- | -------- | -------------- |
| **dev**  | `dev.oci.aiaudit.org`          | 0.5 / 2            | 1 → 2         | off | no       | DESTROY        |
| **int**  | `int.oci.aiaudit.org`          | 0.5 / 4            | 2 → 4         | on  | yes      | SNAPSHOT       |
| **prod** | `oci.aiaudit.org`              | 1 / 16             | 3 → 12        | on  | yes      | RETAIN         |

All defined in code: see [`infra/cdk/lib/environments.ts`](../infra/cdk/lib/environments.ts).

## AWS Well-Architected Framework alignment

| Pillar                  | Implementation                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operational excellence** | IaC (CDK), structured logs (pino → CloudWatch), X-Ray tracing in int/prod, GitHub Actions deploys with environment approvals, alarms → SNS topic                                                                |
| **Security**               | KMS-encrypted at rest (Aurora, S3), TLS 1.3, WAFv2 managed rules, Cognito with MFA, IAM least-priv via OIDC for GitHub Actions, SBOM in CI, Trivy + Gitleaks scans, S3 Object Lock for prod artefacts            |
| **Reliability**            | Multi-AZ in int/prod, ECS deployment circuit breaker, Aurora Serverless v2 auto-scaling, automated backups (35 days prod), health checks every 15s, decoupled job queues (SQS) for resilience                  |
| **Performance efficiency** | ARM64 Fargate (better $/perf), CloudFront edge caching, HTTP/3, Aurora read replicas in int/prod, Performance Insights enabled in int/prod                                                                       |
| **Cost optimisation**      | Aurora Serverless v2 scales to 0.5 ACU in dev, single NAT in dev/int (3 in prod), CloudFront PriceClass100 in dev/int (All in prod), short log retention in dev (1mo) vs prod (6mo), auto-scaling on demand     |
| **Sustainability**         | ARM64 (lower carbon per request), serverless DB, scale-to-min outside business hours via EventBridge schedule (Phase A2)                                                                                          |

## Data residency

Today: single-region eu-central-1 (Frankfurt). Aligned with EU Member State data-residency
expectations. **Phase E** introduces regional deployment templates for jurisdictions that
need national data-residency (multi-region active-passive via Aurora Global Database).

## See also

- [`platform-modernization-assessment.md`](./platform-modernization-assessment.md) — deep-dive
- [`oci-milestones-2026-2027.md`](./oci-milestones-2026-2027.md) — package roadmap
- [`migration/strangler-plan.md`](./migration/strangler-plan.md) — cutover plan
- [`adr/`](./adr/) — Architecture Decision Records
