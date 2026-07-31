# Deployment

All AWS infrastructure for OCI Platform is **defined as code** in [`infra/cdk/`](../infra/cdk/) and deployed via **GitHub Actions** using **AWS OIDC** (no static AWS credentials anywhere).

## Environments

| Env  | Domain              | AWS account  | Purpose                                          | Auto-deploy?         |
| ---- | ------------------- | ------------ | ------------------------------------------------ | -------------------- |
| dev  | dev.oci.aiaudit.org | 601883093460 | Continuous integration target; ephemeral data    | ✓ on merge to `main` |
| int  | int.oci.aiaudit.org | 601883093460 | Pre-prod / regulator demos / partner UAT         | manual via Actions   |
| prod | oci.aiaudit.org     | 601883093460 | Production. Approval required, broadening review | manual + 2 approvers |

(Today all 3 envs share one AWS account. **Phase A2 task:** split `prod` into its own account
under AWS Organizations; control-tower style.)

## OIDC roles

Three IAM roles, one per environment, trusted by `token.actions.githubusercontent.com`:

```
arn:aws:iam::601883093460:role/gha-oci-deploy-dev
arn:aws:iam::601883093460:role/gha-oci-deploy-int
arn:aws:iam::601883093460:role/gha-oci-deploy-prod
```

Each role's trust policy restricts:

- repo: `FG-AI4H/oci-platform`
- branch: `main` (dev) or `refs/heads/main` (int/prod via workflow_dispatch)
- environment: must match `inputs.environment`

The roles are **provisioned by the bootstrap CDK stack `infra/cdk/lib/bootstrap-oidc-stack.ts`**
(separate from the app stacks because they need to exist before any deployment workflow runs).

## Pipeline

```
push to main
  ├─ CI (lint, test, typecheck, build, Trivy, Gitleaks, SBOM)
  └─ on green:
     └─ deploy-dev:
        ├─ build & push docker images to ECR (with Trivy scan)
        ├─ cdk deploy oci-dev-* (no approval)
        └─ run prisma migrate deploy

manual workflow_dispatch (target=int)
  └─ deploy-int (require GitHub environment approval from a reviewer):
     ├─ build & push images
     ├─ cdk deploy oci-int-* (any-change approval)
     └─ migrate

manual workflow_dispatch (target=prod)
  └─ deploy-prod (require 2 environment approvals):
     ├─ build & push images
     ├─ cdk diff posted as PR comment
     ├─ cdk deploy oci-prod-* (broadening approval)
     └─ migrate
```

## Promotion semantics

There is **no auto-promotion** to int or prod. Operators promote a known-good `main` SHA to int,
exercise it, then promote the same SHA to prod. The Actions workflow uses the `GITHUB_SHA` to tag
images, so rolling back to a previous SHA is a workflow re-run with the older commit checked out.

## Rollback

1. **App rollback**: re-run the Deploy workflow targeting a previous commit on `main`.
2. **Database rollback**: Prisma migrations are forward-only; rolling back schema changes requires
   a new migration that compensates. Snapshot per env exists; `cdk` has `RemovalPolicy.RETAIN` on
   prod so a destroy-by-accident is impossible.

## Smoke checks after deploy

Each deploy job runs a final job that hits `/health` on the deployed ALB and waits for green.
A second smoke job exercises a known-stable `/v2/healthz/db` endpoint that performs a read-only
Postgres query.

## Runtime configuration (operator-tunable)

Most runtime config is injected by CDK into the ECS task definition. The variables below are the
ones an operator may reasonably want to change per environment without a code change. All are
optional — the API boots with the documented default when unset. See `apps/api/.env.example` for
the local-development set.

| Variable                      | Default              | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OCI_BULK_DOWNLOAD_MAX_BYTES` | `2147483648` (2 GiB) | Cap on the total size of a whole-dataset ZIP from `GET /v2/catalog/datasets/:slug/download`. Summed over the eligible distributions' `contentSizeBytes` **before** streaming starts; over the cap the request gets `413` with the total, the cap, and a pointer to the per-file download route. Raise with care: the archive streams through the Fargate task, so a larger cap means longer-lived connections and more egress per request. A non-numeric or non-positive value is ignored (logged as a warning) and the default applies. |

## Pinned tooling versions

See `package.json` (authoritative) and `.nvmrc`. Anything that pins must also be present in
`.github/workflows/_deploy-env.yml`.
