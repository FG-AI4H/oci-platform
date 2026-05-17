# =============================================================================
# OCI Platform — apps/api Dockerfile
# Multi-stage; distroless final image; non-root user.
# Build context: monorepo root (so pnpm workspace resolution works).
#
# Build:   docker build -f apps/api/Dockerfile -t oci-api .
# Image:   gcr.io/distroless/nodejs24-debian12:nonroot (UID 65532, no shell)
# =============================================================================

FROM node:24-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/audit/package.json packages/audit/
COPY packages/auth/package.json packages/auth/
COPY packages/croissant/package.json packages/croissant/
COPY packages/database/package.json packages/database/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY infra/cdk/package.json infra/cdk/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo .
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @oci/database build \
 && pnpm --filter @oci/shared-types build \
 && pnpm --filter @oci/auth build \
 && pnpm --filter @oci/croissant build \
 && pnpm --filter @oci/audit build \
 && pnpm --filter @oci/api build \
 && pnpm --filter @oci/api deploy --prod --legacy /out

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out/dist ./dist
COPY --from=build --chown=nonroot:nonroot /out/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /out/package.json ./package.json
USER nonroot
EXPOSE 3000
ENV NODE_ENV=production
ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
