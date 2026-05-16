-- Identity-admin audit log (#241). Records every admin group grant /
-- revoke action so another admin can inspect the change history of a
-- given user. The `identity` schema already exists from earlier
-- migrations.

CREATE TABLE "identity"."identity_admin_audit_events" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "actor_sub"       UUID         NOT NULL,
    "actor_username"  TEXT         NOT NULL,
    "target_sub"      UUID         NOT NULL,
    "target_username" TEXT         NOT NULL,
    "action"          TEXT         NOT NULL,
    "group_name"      TEXT         NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- Per-target history lookup (admin detail page) — newest first.
CREATE INDEX "identity_admin_audit_events_target_sub_created_at_idx"
    ON "identity"."identity_admin_audit_events" ("target_sub", "created_at" DESC);

-- Global timeline (future ops dashboard).
CREATE INDEX "identity_admin_audit_events_created_at_idx"
    ON "identity"."identity_admin_audit_events" ("created_at" DESC);
