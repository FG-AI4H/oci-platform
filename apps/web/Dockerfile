# =============================================================================
# OCI Platform — apps/web Dockerfile
# Multi-stage; distroless final image; non-root user.
# Build context: monorepo root.
#
# Build: docker build -f apps/web/Dockerfile -t oci-web .
# Image: gcr.io/distroless/nodejs24-debian12:nonroot (UID 65532, no shell)
# =============================================================================

FROM node:24-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/web/package.json apps/web/
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
COPY apps/web apps/web
RUN pnpm --filter @oci/shared-types build \
 && pnpm --filter @oci/auth build \
 && pnpm --filter @oci/ui build \
 && pnpm --filter @oci/web build

# Next.js standalone output assembles a self-contained server.js + minimal
# node_modules under apps/web/.next/standalone/. The .next/static folder
# must be copied alongside (Next standalone does NOT bundle it).
FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /repo/apps/web/.next/standalone /app
COPY --from=build --chown=nonroot:nonroot /repo/apps/web/.next/static /app/apps/web/.next/static
# (apps/web/public/ is optional — Next.js skips it if it doesn't exist.
#  Re-add the COPY line when static assets are introduced under public/.)
USER nonroot
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENTRYPOINT ["/nodejs/bin/node", "apps/web/server.js"]
