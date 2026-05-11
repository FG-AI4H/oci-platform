# Local setup

Bring the OCI stack up on your laptop in ~5 minutes.

> **Looking for the contributor onboarding?** This page is the _up-and-running_ path. The end-to-end onboarding is at [`docs/getting-started.md`](../getting-started.md).

## Prerequisites

- Node 24 LTS + pnpm 10.33+ (`corepack enable && corepack prepare pnpm@10.33.2 --activate`).
- Docker Desktop or OrbStack.
- AWS CLI v2 (only needed for `cdk synth` against your own account).
- `gh` CLI (optional, for managing GitHub project state).

## First-time bootstrap

```bash
git clone git@github.com:FG-AI4H/oci-platform.git
cd oci-platform
pnpm install

cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local

docker compose -f infra/local/docker-compose.yml up -d
pnpm --filter @oci/database db:migrate:dev

pnpm dev
```

That should give you:

- API on `http://localhost:3000` (with Swagger UI at `/docs`).
- Web on `http://localhost:3001`.
- Postgres on `localhost:5432` (user `oci` / pw `oci` / db `oci_dev`).
- Redis on `localhost:6379`.
- MinIO on `localhost:9000` (console at `:9001`, creds `minioadmin` / `minioadmin`). Bucket `oci-datasets-local` is auto-created with CORS for `http://localhost:3001`.

Sign in via the local-dev Credentials provider — the form at `/signin` accepts any User + Roles combo. Type `bob` + `host` for the host workflow; `eve` + `participant` for the requester workflow.

## What the env files hold

The `.env.local` files are gitignored. Required:

- `apps/api/.env.local`: `DATABASE_URL`, `REDIS_URL`, `OCI_ENV=local`, MinIO/S3 vars (`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `OCI_DATASETS_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- `apps/web/.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3001`.

The `.env.example` files are the canonical reference.

## Running the test suites

```bash
# Vitest (co-located unit specs)
pnpm --filter @oci/api test
pnpm --filter @oci/web test
pnpm --filter @oci/croissant test

# Playwright E2E (requires the local stack to be up)
pnpm --filter @oci/web exec playwright test

# Type + lint
pnpm --filter @oci/api typecheck
pnpm --filter @oci/web typecheck
pnpm --filter @oci/web lint
```

The full verification gate (run before opening a PR):

```bash
pnpm --filter @oci/shared-types build
pnpm --filter @oci/api typecheck
pnpm --filter @oci/api test
pnpm --filter @oci/web typecheck
pnpm --filter @oci/web lint
pnpm --filter @oci/web exec playwright test
```

## Common workflows

### Add a database column

Edit `packages/database/prisma/schema.prisma`, generate a migration via `pnpm --filter @oci/database db:migrate:dev --name <descriptive>`, regenerate the client (`pnpm --filter @oci/database build`).

### Add a new API endpoint

Follow the existing module structure under `apps/api/src/modules/<feature>/`: `<feature>.module.ts` + `.service.ts` + `.controller.ts` + `.repository.ts` + `.service.spec.ts`. Request bodies use Zod schemas exported from `@oci/shared-types`; responses are plain TS interfaces. See the `catalog/` or `access-request/` modules as reference.

### Add a new web page

Add a route folder under `apps/web/src/app/<path>/` with a server-component `page.tsx`. Forms use server actions with Zod parsing (re-using the same schema as the API). Add a Playwright spec under `apps/web/e2e/` covering the happy path and at least one error state.

### Add a fullstack feature

Define the shared Zod schema in `packages/shared-types/src/index.ts` first, then implement the API side, then the web side. End with a Playwright spec that exercises the real API (no mocks) plus an axe-core check on the new page.

## Troubleshooting

- **Port 3000 in use.** Kill the prior `tsx watch src/main.ts` (it's the API). `lsof -i :3000` to confirm.
- **`Prisma Client not generated`.** `pnpm --filter @oci/database build`.
- **Migrations don't apply.** Check `DATABASE_URL` — the dev DB name is `oci_dev`, not `oci`.
- **MinIO `NoSuchBucket`.** The bootstrap container runs once at compose-up; if it raced the API, restart with `docker compose -f infra/local/docker-compose.yml up -d --force-recreate minio-bootstrap`.
- **`@oci/croissant` not found in web.** `pnpm install` after pulling. Workspace deps are linked, but the lockfile drives the symlinks.
