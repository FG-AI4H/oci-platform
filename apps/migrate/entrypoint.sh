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
# NOTHING, except bundled fixture manifests which refresh on conflict
# when their content differs) — re-runs leave the row's existing id intact.
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
./node_modules/.bin/prisma migrate deploy

# Demo-data seed (#249, #251). Skipped in prod because the seed
# references fake created_by_id values + placeholder dataset rows that
# don't belong in a production catalogue. CDK MigrateTaskDef passes
# OCI_ENV straight from the stack's envName.
if [ -n "${OCI_ENV:-}" ] && [ "${OCI_ENV}" != "prod" ]; then
  # Step 1 — upload bundled fixture files (#251). Walks every
  # `./seed/fixtures/<slug>/` directory, reads `manifest.json`, and
  # PUTs each FileObject file to s3://${OCI_DATASETS_BUCKET}/<slug>/
  # <distribution-@id>/<filename>. Idempotent via HEAD-check.
  if [ -f ./upload-fixtures.mjs ] && [ -n "${OCI_DATASETS_BUCKET:-}" ]; then
    echo "seed: uploading bundled fixtures to s3://${OCI_DATASETS_BUCKET}"
    node ./upload-fixtures.mjs
  else
    echo "seed: skipping fixture upload (OCI_DATASETS_BUCKET=${OCI_DATASETS_BUCKET:-unset})"
  fi

  # Step 2 — replay the SQL seed. References the keys the upload
  # step just wrote to, so the dataset rows + S3 bytes stay in sync.
  if [ -f ./seed/demo.sql ]; then
    echo "seed: OCI_ENV=${OCI_ENV} — replaying demo-data seed (./seed/demo.sql)"
    # Prepend a `SET` for the bucket-name GUC the OCI-demo section
    # reads — keeps the SQL self-contained while letting the
    # per-environment bucket flow in from the task env.
    SEED_SCRIPT=$(mktemp)
    {
      echo "SET app.datasets_bucket = '${OCI_DATASETS_BUCKET:-oci-datasets-local}';"
      cat ./seed/demo.sql
    } > "${SEED_SCRIPT}"
    # Prisma 7 removed the `--url` flag on `prisma db execute`; the
    # datasource URL is now resolved from prisma.config.ts, which reads
    # DATABASE_URL from the environment (we exported it above).
    ./node_modules/.bin/prisma db execute --file "${SEED_SCRIPT}"
    rm -f "${SEED_SCRIPT}"
    echo "seed: done"
  fi
else
  echo "seed: OCI_ENV=${OCI_ENV:-unset} — skipping demo-data seed"
fi
