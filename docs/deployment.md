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
     └─ deploy-dev (not while dev is frozen, see "Deploy freeze on dev"):
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

## Deploy freeze on dev

`dev` redeploys on every merge to `main`. When that must not happen, for instance while a workshop runs on `dev`, set the **repository** variable `DEPLOY_FREEZE_DEV` to `true` (Settings → Secrets and variables → Actions → Variables). It has to be a repository variable: one defined on the `dev` environment is not visible to the job that reads it.

| Trigger                                         | `DEPLOY_FREEZE_DEV` | What the Deploy run does                                                                                          |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Push to `main`                                  | unset or `false`    | Deploys `dev`, as before.                                                                                         |
| Push to `main`                                  | `true`              | Stops in `freeze-gate` with a notice naming the commit. The other jobs are skipped; the run is green, not failed. |
| Manual run, target `dev`, `override_freeze` off | `true`              | Fails in `freeze-gate` with an error naming the variable and the input. Nothing is deployed.                      |
| Manual run, target `dev`, `override_freeze` on  | `true`              | Deploys `dev`, with a notice naming who overrode the freeze.                                                      |
| Manual run, target `dev`                        | unset or `false`    | Deploys `dev`. `override_freeze` has no effect.                                                                   |
| Manual run, target `int` or `prod`              | any                 | Unaffected. The freeze applies to `dev` only.                                                                     |

Things to know:

- **A frozen push leaves `dev` behind `main`.** Each stopped run carries a notice and a run summary with the commit that was not deployed. Nothing deploys it later on its own.
- **Ending the freeze.** Set `DEPLOY_FREEZE_DEV` to `false`, then run the Deploy workflow by hand on `main` with target `dev` (or wait for the next merge). That one run carries every migration and every change merged during the freeze, so do it when nobody is using `dev`. To see what was held back: `gh run list --workflow deploy.yml --event push`, and open the runs whose only completed job is `freeze-gate`. Do not use "Re-run" on one of them to catch up: a re-run belongs to that run's commit, which is the head of `main` only if nothing was merged after it.
- **Only `true` freezes** (in any letter case). Any other non-empty value except `false` is read as not frozen, and the run says so in a warning.
- **A docs-only merge starts no Deploy run at all**, frozen or not, so it leaves no notice either.
- **The freeze is a guard against accidents, not an access control.** Anyone who can run the workflow can tick `override_freeze`, and a change to `.github/workflows/deploy.yml` itself takes effect with the push that carries it.
- A frozen push runs outside the `deploy-dev` concurrency group, so it can neither wait behind nor cancel a deploy dispatched with `override_freeze`.

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

### Not tunable: the DICOM finding digest key

`OCI_DICOM_FINDING_DIGEST_KEY` is generated by CDK (`DicomFindingDigestKey` in `infra/cdk/lib/api-stack.ts`), kept in Secrets Manager and injected into the API task only. The API stores a keyed digest of each flagged DICOM header value, never the value (ADR-0026).

- **Do not rotate it.** Recorded digests would stop matching, and every DICOM file with findings would be held again.
- **Without it**, a DICOM upload that has findings is refused with a 503. No file is listed or served unchecked: the upload gets no distribution row and the API deletes the object it had just stored. On a versioned bucket that leaves a delete marker over the bytes, which an operator removes with the object version.
- Locally (`OCI_ENV=local`) a fixed development key is used.

### Not tunable: the audit pseudonym key

`OCI_AUDIT_PSEUDONYM_KEY` is generated by CDK (`AuditPseudonymKey` in `infra/cdk/lib/api-stack.ts`): 64 letters and digits, kept in Secrets Manager and injected into the API task only. The API turns each person's id in the audit trail into a pseudonym for a `regulator`, a keyed HMAC-SHA256 of the id (see `docs/for-operators/reading-the-audit-trail.md`). It needs at least 32 characters.

- **Do not rotate it.** Every pseudonym would change, and exports a regulator already holds could no longer be matched person by person with new ones.
- **Without it**, a regulator sees every actor as `withheld`, never in clear.
- It is retained when the `int` or `prod` stack is deleted, and destroyed with a `dev` stack, as the DICOM key is.
- Locally (`OCI_ENV=local`) a fixed development key is used.

## Pinned tooling versions

See `package.json` (authoritative) and `.nvmrc`. Anything that pins must also be present in
`.github/workflows/_deploy-env.yml`.
