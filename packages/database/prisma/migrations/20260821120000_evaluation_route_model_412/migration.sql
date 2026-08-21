-- EvaluationRoute model (WP5, #412, ADR-0018).
--
-- Two tables, one enum, one additive SubmissionMode value, two nullable columns
-- on submissions. Additive throughout.
--
-- NO BACKFILL, deliberately. Every currently-scored submission predates the
-- registry and legitimately carries a null route. Backfilling the reference
-- route onto those rows would assert a review that never happened — which is
-- precisely the failure this challenge exists to argue against. They are
-- labelled LEGACY at the read boundary instead (see ScoreAttributionSchema).

-- CreateEnum
CREATE TYPE "evaluation"."RouteReviewStatus" AS ENUM ('DECLARED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum: additive value for Track B (WP8). No execution path accepts it yet.
ALTER TYPE "evaluation"."SubmissionMode" ADD VALUE 'ENCRYPTED';

-- CreateTable
CREATE TABLE "evaluation"."evaluation_routes" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "evaluation"."SubmissionMode" NOT NULL,
    "provider_name" TEXT,
    "is_reference" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation"."route_versions" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "threat_model" JSONB NOT NULL,
    "disclosure_profile" JSONB NOT NULL,
    "operational_envelope" JSONB NOT NULL,
    "review_status" "evaluation"."RouteReviewStatus" NOT NULL DEFAULT 'DECLARED',
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_routes_slug_key" ON "evaluation"."evaluation_routes"("slug");

-- Invariant 5: at most one reference route per mode. A partial unique index
-- makes the database refuse a second one rather than relying on the service.
CREATE UNIQUE INDEX "evaluation_routes_one_reference_per_mode"
    ON "evaluation"."evaluation_routes"("mode") WHERE "is_reference";

-- CreateIndex
CREATE UNIQUE INDEX "route_versions_route_id_version_key" ON "evaluation"."route_versions"("route_id", "version");
CREATE INDEX "route_versions_review_status_idx" ON "evaluation"."route_versions"("review_status");

-- AddForeignKey
ALTER TABLE "evaluation"."route_versions" ADD CONSTRAINT "route_versions_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "evaluation"."evaluation_routes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AlterTable
ALTER TABLE "evaluation"."submissions"
    ADD COLUMN "route_version_id" UUID,
    ADD COLUMN "retracted_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "evaluation"."submissions" ADD CONSTRAINT "submissions_route_version_id_fkey" FOREIGN KEY ("route_version_id") REFERENCES "evaluation"."route_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
