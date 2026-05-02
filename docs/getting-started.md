# Getting started

> Local development bootstrap for the OCI Platform monorepo.

## Prerequisites

- **Node.js 24** (LTS Krypton). Use [`fnm`](https://github.com/Schniz/fnm) or `nvm`; `.nvmrc` is set.
- **pnpm 10.33+**. Install via `corepack enable && corepack prepare pnpm@10.33.2 --activate`.
- **Docker Desktop** (or OrbStack on macOS). The local Postgres + Redis + LocalStack come up via Docker Compose.
- **AWS CLI v2** with profile `ai4h` (see `~/.aws/config`).
- **gh CLI** (optional, for managing the GitHub project).

## First-time setup

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

Open:

- `http://localhost:3000/docs` — NestJS Swagger
- `http://localhost:3000/health`
- `http://localhost:3001` — Next.js web

## Day-to-day

```bash
pnpm dev                 # turbo watch — api + web in parallel
pnpm test                # vitest in all packages
pnpm typecheck           # tsc --noEmit everywhere
pnpm lint                # eslint --fix
pnpm format              # prettier --write
```

## Adding a feature

1. Open the relevant epic in [GitHub Project #3](https://github.com/orgs/FG-AI4H/projects/3) and pick a task.
2. If it's a new domain module, run the **`oci-feature-scaffold`** Claude Code skill (defined under `.claude/skills/`) to scaffold module + service + controller + tests + DTO.
3. Write the test first (Vitest for unit, Playwright for E2E).
4. Implement.
5. Open a PR — CI runs lint + typecheck + test + build + Trivy + Gitleaks + SBOM.
6. Merge to `main` → auto-deploy to **dev** via GitHub Actions.

## Deploying

| Target | Trigger                                      |
| ------ | -------------------------------------------- |
| dev    | merge to `main` (automatic)                  |
| int    | manual `gh workflow run Deploy -f target=int` |
| prod   | manual `gh workflow run Deploy -f target=prod`, requires environment approval (Marc + Eva) |

See [`deployment.md`](./deployment.md) for full details.

## Useful Make-equivalent shortcuts

```bash
pnpm cdk synth --filter @oci/cdk -- --context env=dev
pnpm --filter @oci/database db:studio
pnpm --filter @oci/api dev
pnpm --filter @oci/web dev
```

## Troubleshooting

- **`prisma generate` fails**: delete `node_modules/.prisma` then `pnpm --filter @oci/database build`.
- **Cognito local stub**: dev uses real Cognito (cheap); LocalStack pro is not free for Cognito. Sign in with the `oci-dev-test` user provisioned in the Cognito user pool.
- **Stale Turbo cache**: `pnpm clean` then `pnpm install`.
