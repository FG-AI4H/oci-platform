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
# It fails on purpose when the stored evaluation answer key has drifted
# from the repo (#464); `set -eu` then fails this task and the deploy.
#
# Seed profiles (#644). OCI_SEED_PROFILES is a comma-separated list of
# directories under ./seed/profiles/, set per environment by CDK and empty
# by default. With it empty or unset this script does exactly what it did
# before profiles existed. Each listed profile is replayed after the demo
# seed, and only when ./seed-profile-check.mjs finds its files in place; a
# profile that is not ready is skipped and the deploy continues.
#
# Profile reset (#644). Launched with OCI_SEED_RESET=<profile>, the task
# runs ./reset-profile.mjs and nothing else: no migration, no seed.
#
# One-off statement (#739). Launched with OCI_SQL_STATEMENT=<name>, the task
# runs ./run-statement.mjs and nothing else: a reviewed statement from
# ./statements/, a dry run unless confirmed. docs/runbooks/one-off-sql.md.
set -eu

: "${DB_USERNAME:?DB_USERNAME not set (expected from Aurora secret)}"
: "${DB_PASSWORD:?DB_PASSWORD not set (expected from Aurora secret)}"
: "${DB_HOST:?DB_HOST not set (expected from Aurora secret)}"
: "${DB_PORT:?DB_PORT not set (expected from Aurora secret)}"
: "${DB_NAME:?DB_NAME not set (expected from Aurora secret)}"

# URL-encode the password (Aurora-managed secrets can include @ : / ? & = etc).
DB_PASSWORD_ENC=$(node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))")

export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

# A one-off launch does one thing. Both set is a launch mistake.
if [ -n "${OCI_SEED_RESET:-}" ] && [ -n "${OCI_SQL_STATEMENT:-}" ]; then
  echo "one-off: REFUSED. OCI_SEED_RESET and OCI_SQL_STATEMENT are both set; launch one at a time." >&2
  exit 2
fi

# One-off statement (#739). The script refuses anything but dev and local
# and is a dry run unless confirmed; see its header. `exec` so its exit code
# is the task's.
if [ -n "${OCI_SQL_STATEMENT:-}" ]; then
  # Refused here as well as in the script: two places would have to be wrong.
  if [ "${OCI_ENV:-}" = "prod" ]; then
    echo "one-off: REFUSED. A one-off statement never runs on prod." >&2
    exit 2
  fi
  echo "one-off: OCI_SQL_STATEMENT=${OCI_SQL_STATEMENT}, running the statement instead of migrate and seed"
  exec node ./run-statement.mjs
fi

# One-off reset of a seed profile's objects (#644). The script refuses
# anything but dev and local, and is a dry run unless confirmed; see its
# header. `exec` so its exit code is the task's.
if [ -n "${OCI_SEED_RESET:-}" ]; then
  # Refused here as well as in the script: two places would have to be wrong.
  if [ "${OCI_ENV:-}" = "prod" ]; then
    echo "reset: REFUSED. A profile reset never runs on prod." >&2
    exit 2
  fi
  echo "reset: OCI_SEED_RESET=${OCI_SEED_RESET}, running the profile reset instead of migrate and seed"
  exec node ./reset-profile.mjs
fi

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

  # Step 3 — seed profiles (#644), after the demo seed so a profile can
  # build on it. Nothing runs here unless OCI_SEED_PROFILES names one.
  if [ -n "${OCI_SEED_PROFILES:-}" ]; then
    for SEED_PROFILE in $(echo "${OCI_SEED_PROFILES}" | tr ',' ' '); do
      case "${SEED_PROFILE}" in
        *[!a-z0-9-]*)
          echo "seed-profile: ignoring '${SEED_PROFILE}' (not a profile name)"
          continue
          ;;
      esac
      # The check is the only step allowed to say no without failing the
      # deploy: files not uploaded yet, or stand-in content.
      if node ./seed-profile-check.mjs "${SEED_PROFILE}"; then
        echo "seed-profile: ${SEED_PROFILE}: uploading its bundled files"
        SEED_FIXTURES_DIR="./seed/profiles/${SEED_PROFILE}/fixtures" SEED_FIXTURES_PROFILE=1 \
          node ./upload-fixtures.mjs
        echo "seed-profile: ${SEED_PROFILE}: replaying ./seed/profiles/${SEED_PROFILE}/seed.sql"
        PROFILE_SCRIPT=$(mktemp)
        {
          echo "SET app.datasets_bucket = '${OCI_DATASETS_BUCKET:-oci-datasets-local}';"
          cat "./seed/profiles/${SEED_PROFILE}/seed.sql"
        } > "${PROFILE_SCRIPT}"
        ./node_modules/.bin/prisma db execute --file "${PROFILE_SCRIPT}"
        rm -f "${PROFILE_SCRIPT}"
        echo "seed-profile: ${SEED_PROFILE}: done"
      else
        # 3 is the check's "not ready". Any other code means the check itself
        # broke: said louder, and still not a reason to fail everyone's deploy.
        CHECK_STATUS=$?
        if [ "${CHECK_STATUS}" -ne 3 ]; then
          echo "seed-profile: ${SEED_PROFILE}: the readiness check did not run properly (exit ${CHECK_STATUS})" >&2
        fi
        echo "seed-profile: ${SEED_PROFILE}: SKIPPED, reason above. The deploy continues."
      fi
    done
  fi
else
  echo "seed: OCI_ENV=${OCI_ENV:-unset} — skipping demo-data seed"
fi
