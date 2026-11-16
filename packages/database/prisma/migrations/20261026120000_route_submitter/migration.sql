-- Record who registered a route and who declared each version.
--
-- Additive and nullable: rows from before this migration (the seeded reference
-- routes among them) have no recorded submitter, and stay reviewable.
ALTER TABLE "evaluation"."evaluation_routes"
    ADD COLUMN "submitter_user_id" UUID;

ALTER TABLE "evaluation"."route_versions"
    ADD COLUMN "declared_by_user_id" UUID;
