#!/bin/sh
# Compose DATABASE_URL from the individual fields injected as ECS secrets
# (DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) so the password
# never appears in the task definition's plaintext env. Then hand off to
# `prisma migrate deploy`. The CDK MigrateTaskDef in api-stack.ts wires
# each DB_* var via ecs.Secret.fromSecretsManager(secret, '<json-field>').
set -eu

: "${DB_USERNAME:?DB_USERNAME not set (expected from Aurora secret)}"
: "${DB_PASSWORD:?DB_PASSWORD not set (expected from Aurora secret)}"
: "${DB_HOST:?DB_HOST not set (expected from Aurora secret)}"
: "${DB_PORT:?DB_PORT not set (expected from Aurora secret)}"
: "${DB_NAME:?DB_NAME not set (expected from Aurora secret)}"

# URL-encode the password (Aurora-managed secrets can include @ : / ? & = etc).
DB_PASSWORD_ENC=$(node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))")

export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

# Hand off (exec — keep PID 1 semantics so ECS can stop us cleanly).
exec npx --no-install prisma migrate deploy
