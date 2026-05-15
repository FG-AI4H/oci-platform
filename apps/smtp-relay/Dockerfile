# =============================================================================
# OCI Platform — apps/smtp-relay Dockerfile
# Multi-stage; distroless final image; non-root user (uid 65532) — binds 2525
# (unprivileged). See ADR-0005.
#
# Build context: monorepo root.
# Build: docker build -f apps/smtp-relay/Dockerfile -t oci-smtp-relay .
# =============================================================================

FROM node:24-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/smtp-relay/package.json apps/smtp-relay/
COPY packages/croissant/package.json packages/croissant/
COPY packages/database/package.json packages/database/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/auth/package.json packages/auth/
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
COPY apps/smtp-relay apps/smtp-relay
RUN pnpm --filter @oci/smtp-relay build \
 && pnpm --filter @oci/smtp-relay deploy --prod --legacy /out

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out/dist ./dist
COPY --from=build --chown=nonroot:nonroot /out/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /out/package.json ./package.json
USER nonroot
ENV NODE_ENV=production
EXPOSE 2525
ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
