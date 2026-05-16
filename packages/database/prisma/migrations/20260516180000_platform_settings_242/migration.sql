-- Platform settings singleton (#242). Cross-cutting operator-managed
-- configuration; first consumer is the maintenance banner, future
-- consumers will extend the JSONB value shape (#214 tool registry,
-- #235 phase 2 license defaults). The Zod schema in @oci/shared-types
-- is the source of truth for the JSONB shape.

CREATE SCHEMA IF NOT EXISTS "platform";

CREATE TABLE "platform"."platform_settings" (
    "key"                       TEXT         NOT NULL,
    "value"                     JSONB        NOT NULL,
    "last_updated_by_sub"       UUID,
    "last_updated_by_username"  TEXT,
    "updated_at"                TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- Seed the singleton row with default settings (no banner). The API
-- always upserts on the key='current' row; seeding avoids a "first
-- write creates" race the read path would have to handle.
INSERT INTO "platform"."platform_settings"
    ("key", "value", "updated_at")
VALUES
    ('current', '{"maintenanceBanner": null}'::jsonb, CURRENT_TIMESTAMP);
