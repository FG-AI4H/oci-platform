#!/bin/sh
# Compose DATABASE_URL from the individual fields injected as ECS secrets
# (DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) so the password
# never appears in the task definition's plaintext env. Then hand off to
# `prisma migrate deploy`. The CDK MigrateTaskDef in api-stack.ts wires
# each DB_* var via ecs.Secret.fromSecretsManager(secret, '<json-field>').
#
# When OCI_ENV is set and not 'prod', replay the demo-data seed
# (`packages/database/seed/demo.sql`, copied to ./seed/demo.sql in the
# image). The seed is idempotent (every INSERT uses ON CONFLICT DO
# NOTHING) — re-runs leave the row's existing id intact.
set -eu

: "${DB_USERNAME:?DB_USERNAME not set (expected from Aurora secret)}"
: "${DB_PASSWORD:?DB_PASSWORD not set (expected from Aurora secret)}"
: "${DB_HOST:?DB_HOST not set (expected from Aurora secret)}"
: "${DB_PORT:?DB_PORT not set (expected from Aurora secret)}"
: "${DB_NAME:?DB_NAME not set (expected from Aurora secret)}"

# URL-encode the password (Aurora-managed secrets can include @ : / ? & = etc).
DB_PASSWORD_ENC=$(node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))")

export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

echo "migrate: running prisma migrate deploy"
npx --no-install prisma migrate deploy

# Demo-data seed (#241 follow-up). Skipped in prod because the file
# uses fake created_by_id values + placeholder dataset rows that don't
# belong in a production catalogue. CDK MigrateTaskDef passes OCI_ENV
# straight from the stack's envName.
if [ -n "${OCI_ENV:-}" ] && [ "${OCI_ENV}" != "prod" ] && [ -f ./seed/demo.sql ]; then
  echo "seed: OCI_ENV=${OCI_ENV} — replaying demo-data seed (./seed/demo.sql)"
  # `prisma db execute --file` runs raw SQL through the same engine
  # binary that migrate uses — no extra runtime dependency needed.
  npx --no-install prisma db execute \
    --url "${DATABASE_URL}" \
    --file ./seed/demo.sql
  echo "seed: done"
else
  echo "seed: OCI_ENV=${OCI_ENV:-unset} — skipping demo-data seed"
fi
