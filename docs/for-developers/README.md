# For developers

You're integrating with the OCI, contributing to the platform, or both. The platform is a TypeScript monorepo (NestJS API + Next.js web + AWS CDK + shared `@oci/*` packages).

| Guide                                                          | Read when                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Local setup](./local-setup.md)                                | First-time contributor. Bringing the stack up on your laptop.            |
| [Architecture](../architecture.md)                             | Where everything lives, why.                                             |
| [API reference](./api-reference.md)                            | Calling the OCI from outside. Endpoints, auth, payload shapes.           |
| [Croissant manifest reference](./croissant-manifest.md)        | Authoring or parsing manifests. Validator quirks.                        |
| [Contributing](./contributing.md)                              | PR conventions, the orchestrator skills, the verification gate.          |
| [Strangler-fig migration plan](../migration/strangler-plan.md) | Why the legacy Spring Boot + Django are being replaced module by module. |

## Quick orientation

- **Monorepo**: `apps/api` (NestJS), `apps/web` (Next.js 16 App Router), `apps/worker-eval` (Python sandbox — the only Python in repo), `apps/worker-ingest` (TypeScript SQS consumer for federation harvest).
- **Shared packages**: `@oci/database` (Prisma multi-schema), `@oci/shared-types` (Zod schemas, the contract surface), `@oci/ui` (shadcn-customised primitives), `@oci/auth` (Cognito helpers), `@oci/croissant` (validator + DUO registry), `@oci/eslint-config`.
- **Infra**: `infra/cdk` — AWS CDK stacks per environment (`dev` / `int` / `prod`).
- **Local dev**: Docker Compose brings up Postgres + Redis + MinIO; `pnpm dev` runs api + web concurrently.
- **Tests**: Vitest co-located, Playwright in `apps/web/e2e/`. Run them. They're fast.

## What you can do via the API

- `GET /v2/catalog/datasets` — list / search / filter (anonymous returns PUBLIC only).
- `GET /v2/catalog/datasets/:slug` — detail (visibility-aware).
- `POST /v2/catalog/datasets` (host) — create draft.
- `POST /v2/catalog/datasets/:slug/versions` (host) — publish a manifest version.
- `POST /v2/catalog/datasets/:slug/access-requests` (any auth) — file an access request.
- `POST /v2/catalog/access-requests/:id/decision` (host/admin) — APPROVE / DENY / REVOKE.
- `POST /v2/catalog/datasets/:slug/uploads` (host) — initiate a multipart upload.
- `GET /v2/catalog/datasets/:slug/distributions/:id/download` — gated download (302 to presigned URL).
- `GET /v2/catalog/.well-known/croissant-catalog.json` — federation outbound; PUBLIC + PUBLISHED only.

Full auth + payload shapes in [api-reference.md](./api-reference.md). OpenAPI spec in dev/int at `/docs`.

## Trust boundaries

- **Anonymous**: read-only access to PUBLIC + PUBLISHED rows.
- **Authenticated participant**: + RESTRICTED rows (visible, gated downloads), + access-request creation.
- **Host**: + own datasets at any visibility/status, + publish / upload / review-requests.
- **Admin**: + everything.
- **Regulator / supervisor** _(reserved for Phase D)_: + audit trail.

## Where to ask

- File issues at `FG-AI4H/oci-platform`.
- Architecture questions: open a discussion or write an [ADR](../adr/) draft.
- Standards questions (Croissant, DUO): the GI-AI4H WG-Data mailing list.
