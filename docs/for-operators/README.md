# For operators

You're deploying or running an OCI instance. The platform is designed to run as a fleet — the global instance at `oci.ai4h.net`, plus member-state and regional-office instances that federate with it.

| Guide                                        | Read when                                                       |
| -------------------------------------------- | --------------------------------------------------------------- |
| [Deployment](../deployment.md)               | First-time deploy of a new environment.                         |
| [Architecture](../architecture.md)           | High-level reference for what's where.                          |
| [Security baseline](../security.md)          | The controls expected on every instance (KMS, WAF, OIDC, etc.). |
| [Runbooks](../runbooks/)                     | Day-2 operations: incidents, rotations, restores.               |
| [Observability](./observability.md) _(stub)_ | What to wire to your CloudWatch / X-Ray / Grafana.              |

## Trust model summary

- **Cognito** is the only identity provider in production (PLUS plan in `prod`; standard in `dev`/`int`). MFA mandatory for admin/regulator/supervisor in `prod`.
- **OIDC-only deploys** — no static AWS keys. Three GitHub Actions roles per environment: `gha-oci-deploy-{dev,int,prod}`.
- **All AWS resources via CDK.** No console clicks for anything that isn't a one-time investigation.
- **Three environments**, scaled per [`infra/cdk/lib/environments.ts`](../../infra/cdk/lib/environments.ts).

## What every instance ships

| Layer             | Production-grade default                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network           | VPC, public + private isolated subnets, NAT in non-dev, private endpoints for S3/SSM/SecretsManager.                                                                                  |
| Identity          | Cognito user pool + client; SSM-published primitives for the API to read at runtime.                                                                                                  |
| Data              | Aurora Postgres Serverless v2 (multi-AZ in int/prod), KMS-CMK, automated backups, Performance Insights in int/prod. S3 buckets (KMS, versioned, public-block-on, server-access logs). |
| API               | ECS Fargate (NestJS, distroless), behind ALB, WAFv2 in int/prod.                                                                                                                      |
| Web               | ECS Fargate (Next.js 16, distroless), same cluster + ALB.                                                                                                                             |
| Federation worker | ECS Fargate scheduled task; consumes the federation index from peer catalogues.                                                                                                       |
| Observability     | CloudWatch Logs (structured JSON), X-Ray, ALB access logs to S3.                                                                                                                      |
| Storage           | `oci-datasets-<env>` S3 bucket with multipart upload + 7-day abort + object-lock in prod.                                                                                             |

## What an instance can be configured to _not_ ship

- The CLI tool ([#88](https://github.com/FG-AI4H/oci-platform/issues/88)) is independent — instances can run without it.
- The federation harvester worker can be disabled if your instance is purely a producer (only outbound `/.well-known/croissant-catalog.json`).
- The evaluation surface (Phase C) is on a separate stack and can be omitted entirely.

## Federating

Federation is mutual but optional. To register your instance with a peer:

1. Confirm your `/.well-known/croissant-catalog.json` is reachable from the peer (it's a no-auth public endpoint; CORS is open).
2. The peer's admin uses `/catalog/remotes` to register your URL + a slug.
3. The peer's harvester runs on a schedule (default 4× daily); your datasets appear under `?source=federated`.
4. Reciprocally, your admin registers the peer.

There is no central federation registry. Each instance maintains its own peer list.

## Per-environment configuration

| Setting                        | dev                | int                                     | prod                                    |
| ------------------------------ | ------------------ | --------------------------------------- | --------------------------------------- |
| Domain                         | `dev.oci.ai4h.net` | `int.oci.ai4h.net`                      | `oci.ai4h.net`                          |
| Aurora ACU                     | 0.5 / 2            | 0.5 / 4                                 | 1 / 16                                  |
| Fargate min/max                | 1 / 2              | 2 / 4                                   | 3 / 12                                  |
| WAF                            | off                | on                                      | on                                      |
| Multi-AZ                       | no                 | yes                                     | yes                                     |
| RemovalPolicy                  | DESTROY            | SNAPSHOT                                | RETAIN                                  |
| Cognito MFA                    | optional           | required for admin/regulator/supervisor | required for admin/regulator/supervisor |
| Object Lock on artefact bucket | off                | off                                     | on                                      |

Source: [`infra/cdk/lib/environments.ts`](../../infra/cdk/lib/environments.ts).

## Deploying

```bash
# Bootstrap (one-time per AWS account, then per environment)
pnpm --filter @oci/cdk exec cdk deploy oci-shared-bootstrap
pnpm --filter @oci/cdk exec cdk deploy oci-{env}-bootstrap --context env={env}

# Subsequent deploys via GitHub Actions OIDC
# (see .github/workflows/deploy.yml)
```

Manual `cdk deploy` from a developer laptop against `int` or `prod` is forbidden. Dev deploys from a laptop are tolerated only with SSO-assumed roles.

## Common operational tasks

- **Rotating a Cognito user-pool client**: see [`docs/runbooks/`](../runbooks/) (TODO: add specific runbook).
- **Restoring from snapshot**: Aurora's automated backups + the SNAPSHOT removal policy on int. Restore via CDK by changing the `clusterIdentifier` and re-deploying.
- **Recovering from a failed federation harvest**: the worker is idempotent; re-run by triggering the scheduled task. Stuck rows are visible in the admin's `/catalog/remotes` page with their `lastError`.

## Where to ask

- Operations channel (TODO add Slack/email).
- Security incidents: see [`docs/security.md`](../security.md) for the response process.
