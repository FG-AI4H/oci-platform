# Strangler-fig migration plan

This is the operational playbook that complements [`platform-modernization-assessment.md §3`](../platform-modernization-assessment.md). 5 phases over 12-18 months. The legacy stack keeps running until each context is fully migrated.

## Legacy systems being absorbed

| Legacy                                                | Stack                             | Status              | Replaced by                  |
| ----------------------------------------------------- | --------------------------------- | ------------------- | ---------------------------- |
| `fgai4h-evaluation-platform` (this org's EvalAI fork) | Django 2.2, Python 3.9, AngularJS | Production          | `apps/api` + `apps/web`      |
| `frontend_v2/` (legacy Angular 7 SPA in same repo)    | Angular 7                         | Inactive            | `apps/web`                   |
| `annotation-tool` (FG-AI4H/annotation-tool)           | Spring Boot 3.2.5, Java 17        | Maintenance mode    | `apps/api` modules           |
| `annotation-frontend` (FG-AI4H/annotation-frontend)   | React 18, MUI 5, CRA, Amplify v4  | Maintenance mode    | `apps/web`                   |
| Reporting-Package (FG-AI4H/Reporting-Package)         | Mixed                             | In-progress (Golam) | `apps/api/modules/reporting` |

## Routing during transition

We use the existing nginx fronting `health.aiaudit.org` to fan out:

```
https://health.aiaudit.org/...
  ├─ /api/v2/*    → new ALB → apps/api (NestJS)            ← progressively widened
  ├─ /api/*       → legacy Django                           ← progressively narrowed
  ├─ /annotation/* (Phase B)→ new web                       ← cutover behind feature flag
  ├─ /web/*       → legacy AngularJS (frontend_ai4good)     ← retired in Phase C
  └─ /            → marketing / landing (legacy → new in Phase C)
```

DNS only changes at the very end of Phase C, when `competition.aiforgood.itu.int` is repointed.

## Phase A — Foundation (months 1-2)

| Task                                           | Notes                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Bootstrap monorepo                             | Done as part of this scaffold                                                                       |
| CDK + dev env up                               | `infra/cdk/lib/*` — `cdk deploy --context env=dev`                                                  |
| Cognito unified user pool                      | `IdentityStack`. Phase A1: provision. Phase A2: migration script for Django + annotation-tool users |
| NestJS skeleton + Cognito JWT guard            | `apps/api/src/`                                                                                     |
| Next.js skeleton + Cognito Hosted UI           | `apps/web/src/`                                                                                     |
| GitHub Actions: CI + dev deploy via OIDC       | `.github/workflows/`                                                                                |
| Token-bridge: legacy stacks accept Cognito JWT | One-week dual-running window                                                                        |

## Phase B — Annotation reactivation (months 3-6)

Port the Spring Boot annotation domain → NestJS modules. Ship the Nov-2024 backlog. Sunset
`annotation-tool` and `annotation-frontend`.

Order matters:

1. Port `Dataset / DatasetMetadata / DataCatalog / DataAccessRequest` (no UI dependency)
2. Port `Campaign / Task / Sample / Annotation` (now has data model under it)
3. New Next.js UI for annotators / supervisors
4. Migrate Aurora MySQL data → Aurora Postgres (one-shot with verification)
5. Cutover behind feature flag, soak 2 weeks
6. Archive old repos

## Phase C — Challenges & evaluation (months 7-10)

Port Django apps → NestJS modules:

- `apps/challenges` → `prediction` + `evaluation`
- `apps/jobs` → `prediction/submission`
- `apps/participants` → `identity/participants`
- `apps/hosts` → `identity/hosts`

Python eval-worker stays. Wrap behind a stable SQS contract.

Migrate KDDI / SoM / OPEA challenges one at a time:

1. Read-mirror: new platform serves read-only views from legacy DB (replication via DMS)
2. Write-cutover per challenge: new platform owns writes
3. After 2 weeks per challenge, stop legacy writes for that challenge

DNS cutover for `competition.aiforgood.itu.int` at end of Phase C. Decommission Django.

## Phase D — Reporting + regulator portal (months 11-13)

Wrap Golam's Reporting-Package work. Add audit-trail module. Add regulator-facing portal as a
new Next.js route group `(regulator)`.

Machine-readable JSON-LD report format goes live; tamper-evident lineage records the full chain
dataset → annotation → submission → evaluation → report.

## Phase E — DMXP + federated (months 14-18)

DMXP v0.1 → v1.0 + reference SDK. Federated connectors (read-only first). BIOCroissant ingestion.
MedEval-GI v1 benchmark. Ontology compatibility layer.

## Decommissioning checklist (per legacy system)

- [ ] All endpoints replicated in new stack with feature parity
- [ ] 2-week dual-running soak with no errors above baseline
- [ ] Data migrated and integrity-verified (row counts, hashes, sample diffs)
- [ ] Snapshot backup retained for 90 days post-cutover
- [ ] DNS / routing fully cut over
- [ ] CI workflows and secrets removed
- [ ] Repo archived (read-only) with sunset README pointing at this monorepo
- [ ] Final monthly report to Simao notes the decommission
