# =============================================================================
# OCI Platform — apps/migrate Dockerfile
# Tiny one-shot container that runs `prisma migrate deploy` against the
# environment's Aurora cluster. Launched by CI as a Fargate one-shot task in
# the same VPC + subnet group as the API, so it can reach the
# VPC-private DB without the runner ever touching it.
#
# Build context: monorepo root.
#   Build: docker buildx build -f apps/migrate/Dockerfile -t oci-migrate .
#
# DATABASE_URL is supplied by the launching task definition (CDK
# `MigrateTaskDef` in api-stack.ts). prisma migrate deploy is idempotent —
# re-runs that find no pending migrations exit zero immediately.
# =============================================================================

FROM node:24-alpine
WORKDIR /app

# Patch the base image's OpenSSL before anything else. node:24-alpine ships
# alpine 3.24.1 with libcrypto3/libssl3 3.5.7-r0, which carries
# CVE-2026-14456 (HIGH) and fails the deploy image scan. The fix (3.5.8-r0)
# is in the alpine repo ahead of the node base-image rebuild, so upgrade the
# two packages rather than suppress the finding. Drop this once node:24-alpine
# ships 3.5.8-r0 or later.
RUN apk --no-cache upgrade libcrypto3 libssl3

# Bring just enough to run prisma migrate deploy:
#   - schema.prisma          (declares the datasource + previewFeatures)
#   - prisma/migrations/     (the SQL to apply, lock file)
#   - a minimal package.json that pins the prisma CLI version, kept in
#     sync with packages/database/package.json's prisma dependency.
COPY apps/migrate/package.json ./package.json
COPY apps/migrate/entrypoint.sh ./entrypoint.sh
COPY apps/migrate/prisma.config.ts ./prisma.config.ts
COPY apps/migrate/upload-fixtures.mjs ./upload-fixtures.mjs
COPY packages/database/prisma ./prisma
# Demo-data seed file + bundled fixtures (#249, #251). Replayed by the
# entrypoint after migrate when OCI_ENV != 'prod'. Idempotent — every
# INSERT uses ON CONFLICT DO NOTHING; upload-fixtures.mjs HEAD-checks
# before PUT. See packages/database/seed/demo.sql for the contract.
COPY packages/database/seed ./seed

# Install only the prisma CLI (no @prisma/client at runtime — we're not
# making queries, just shelling out to the migrate engine). --omit=dev
# keeps the image small.
RUN --mount=type=cache,id=npm-migrate,target=/root/.npm \
    npm install --omit=dev --no-audit --no-fund \
 && chmod +x ./entrypoint.sh \
 # npm is only needed for the install above. Drop it (+ npx) from the runtime
 # image so it doesn't ship npm's bundled tar / brace-expansion CVEs
 # (CVE-2026-59873 CRITICAL / -13149 HIGH — image scan, #374). node stays;
 # entrypoint.sh invokes prisma directly via ./node_modules/.bin/prisma.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Non-root for parity with the API container security baseline.
USER node

# entrypoint.sh composes DATABASE_URL from the per-field ECS secrets
# (DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) wired by the
# CDK MigrateTaskDef in api-stack.ts. The password never lands in
# DATABASE_URL via the task definition itself.
ENTRYPOINT ["/app/entrypoint.sh"]
