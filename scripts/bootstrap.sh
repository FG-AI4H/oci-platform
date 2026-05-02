#!/usr/bin/env bash
set -euo pipefail

# OCI Platform — local bootstrap.
# Brings up everything you need for `pnpm dev` to work end-to-end.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Checking prerequisites"
command -v node >/dev/null     || { echo "node missing — install Node 24 LTS"; exit 1; }
command -v pnpm >/dev/null     || { echo "pnpm missing — corepack enable && corepack prepare pnpm@10.33.2 --activate"; exit 1; }
command -v docker >/dev/null   || { echo "docker missing — install Docker Desktop or OrbStack"; exit 1; }
command -v aws >/dev/null      || { echo "aws CLI v2 missing"; exit 1; }

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "Node major is $NODE_MAJOR; this project needs >=24. See .nvmrc"
  exit 1
fi

echo "==> Installing dependencies"
pnpm install --frozen-lockfile=false

echo "==> Copying .env.example files (only if .env.local missing)"
for app in apps/api apps/web; do
  if [[ ! -f "$app/.env.local" && -f "$app/.env.example" ]]; then
    cp "$app/.env.example" "$app/.env.local"
    echo "    + $app/.env.local"
  fi
done

echo "==> Generating Prisma client"
pnpm --filter @oci/database build || true

echo "==> Done."
echo
echo "Next steps:"
echo "  docker compose -f infra/local/docker-compose.yml up -d   # postgres + redis"
echo "  pnpm --filter @oci/database db:migrate:dev                # apply migrations"
echo "  pnpm dev                                                  # api + web"
echo
echo "Or just scaffold the app modules from project #3:"
echo "  https://github.com/orgs/FG-AI4H/projects/3"
