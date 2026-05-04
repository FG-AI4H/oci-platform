-- OCI Platform — initial baseline migration.
--
-- Bootstraps the multi-schema layout (identity, catalog, annotation, prediction,
-- evaluation, reporting) and the two seed models declared in schema.prisma:
-- identity.users and catalog.datasets. Subsequent migrations are emitted by
-- `prisma migrate dev` or hand-written and applied to live DBs via the
-- one-shot ECS `migrate` task launched from CI.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "annotation";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "prediction";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "evaluation";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reporting";

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL,
    "cognito_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."datasets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "croissant" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_cognito_id_key" ON "identity"."users"("cognito_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "identity"."users"("email");
