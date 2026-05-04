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

# Bring just enough to run prisma migrate deploy:
#   - schema.prisma          (declares the datasource + previewFeatures)
#   - prisma/migrations/     (the SQL to apply, lock file)
#   - a minimal package.json that pins the prisma CLI version, kept in
#     sync with packages/database/package.json's prisma dependency.
COPY apps/migrate/package.json ./package.json
COPY apps/migrate/entrypoint.sh ./entrypoint.sh
COPY packages/database/prisma ./prisma

# Install only the prisma CLI (no @prisma/client at runtime — we're not
# making queries, just shelling out to the migrate engine). --omit=dev
# keeps the image small.
RUN --mount=type=cache,id=npm-migrate,target=/root/.npm \
    npm install --omit=dev --no-audit --no-fund \
 && chmod +x ./entrypoint.sh

# Non-root for parity with the API container security baseline.
USER node

# entrypoint.sh composes DATABASE_URL from the per-field ECS secrets
# (DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) wired by the
# CDK MigrateTaskDef in api-stack.ts. The password never lands in
# DATABASE_URL via the task definition itself.
ENTRYPOINT ["/app/entrypoint.sh"]
