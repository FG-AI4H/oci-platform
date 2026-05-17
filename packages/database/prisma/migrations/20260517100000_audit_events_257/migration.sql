-- Platform-wide audit feed (ADR-0014, #257).
--
-- Single append-only table that mirrors every domain state change so a
-- regulator can read "everything that happened to dataset X / model Y /
-- user Z" without joining N module tables. Append-only enforcement and
-- hash-chain population live in Postgres triggers (not the application)
-- so the integrity claim survives even if a module forgets to use the
-- @oci/audit emitter — direct INSERTs still get hashed + chained.

CREATE SCHEMA IF NOT EXISTS "platform";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "platform"."audit_events" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitted_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence_number"  BIGSERIAL    NOT NULL,
    "module"           TEXT         NOT NULL,
    "action"           TEXT         NOT NULL,
    "subject_type"     TEXT         NOT NULL,
    "subject_id"       TEXT         NOT NULL,
    "actor_user_id"    UUID,
    "actor_roles"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "payload"          JSONB        NOT NULL,
    "payload_hash"     TEXT         NOT NULL,
    "previous_hash"    TEXT,
    "record_hash"      TEXT         NOT NULL DEFAULT '',
    "retention_class"  TEXT         NOT NULL DEFAULT 'standard-7y',

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_subject_idx"
    ON "platform"."audit_events" ("subject_type", "subject_id", "occurred_at");
CREATE INDEX "audit_events_module_action_idx"
    ON "platform"."audit_events" ("module", "action", "occurred_at");
CREATE UNIQUE INDEX "audit_events_sequence_number_key"
    ON "platform"."audit_events" ("sequence_number");

-- ---------------------------------------------------------------------------
-- Hash-chain population (BEFORE INSERT).
--
-- The chain spans the global stream ordered by sequence_number. To
-- avoid a race where two parallel inserts read the same "previous
-- recordHash", we take a transaction-scoped advisory lock keyed to the
-- audit_events table OID for the duration of the trigger.
--
-- Canonical form for record_hash:
--   sha256(
--     module || '|' ||
--     action || '|' ||
--     subject_type || '|' ||
--     subject_id || '|' ||
--     occurred_at (ISO-8601 UTC) || '|' ||
--     sequence_number || '|' ||
--     COALESCE(actor_user_id::text, '') || '|' ||
--     payload_hash || '|' ||
--     COALESCE(previous_hash, '')
--   )
--
-- payload_hash is computed by the application using RFC 8785 (JCS) so
-- regulators verifying the export bundle offline can reproduce it from
-- the JSON payload alone. The pipe-delimited record_hash form is
-- intentionally simple so an offline verifier in any language can
-- recompute it from the exported NDJSON without a Postgres dependency.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "platform"."audit_events_chain_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    prev_hash TEXT;
    canonical TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5('platform.audit_events'), 1, 16))::bit(64)::bigint
    );

    SELECT "record_hash"
      INTO prev_hash
      FROM "platform"."audit_events"
     WHERE "sequence_number" < NEW."sequence_number"
     ORDER BY "sequence_number" DESC
     LIMIT 1;

    NEW."previous_hash" := prev_hash;

    canonical :=
        NEW."module"        || '|' ||
        NEW."action"        || '|' ||
        NEW."subject_type"  || '|' ||
        NEW."subject_id"    || '|' ||
        to_char(NEW."occurred_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
        NEW."sequence_number"::text || '|' ||
        COALESCE(NEW."actor_user_id"::text, '') || '|' ||
        NEW."payload_hash"  || '|' ||
        COALESCE(NEW."previous_hash", '');

    NEW."record_hash" := encode(digest(canonical, 'sha256'), 'hex');

    RETURN NEW;
END;
$$;

CREATE TRIGGER "audit_events_chain"
BEFORE INSERT ON "platform"."audit_events"
FOR EACH ROW
EXECUTE FUNCTION "platform"."audit_events_chain_fn"();

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
--
-- The UPDATE trigger is unconditional — there is no legitimate reason
-- to mutate a row, period. The DELETE trigger raises by default; the
-- retention sweeper (Phase C #259 follow-up) will run under a separate
-- SECURITY DEFINER role and use `SET LOCAL platform.audit_sweeper = 'on'`
-- inside its transaction to take the carve-out.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "platform"."audit_events_block_update_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_events rows are immutable (ADR-0014); UPDATE denied'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "audit_events_block_update"
BEFORE UPDATE ON "platform"."audit_events"
FOR EACH ROW
EXECUTE FUNCTION "platform"."audit_events_block_update_fn"();

CREATE OR REPLACE FUNCTION "platform"."audit_events_block_delete_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_setting('platform.audit_sweeper', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_events rows are append-only (ADR-0014); DELETE denied (sweeper carve-out required)'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "audit_events_block_delete"
BEFORE DELETE ON "platform"."audit_events"
FOR EACH ROW
EXECUTE FUNCTION "platform"."audit_events_block_delete_fn"();

COMMENT ON TABLE  "platform"."audit_events" IS
    'Append-only platform-wide audit feed (ADR-0014). UPDATE / DELETE blocked by trigger; previous_hash + record_hash populated by trigger on INSERT.';
COMMENT ON COLUMN "platform"."audit_events"."payload_hash" IS
    'sha256 of RFC 8785 (JCS) canonical JSON of payload; computed by @oci/audit before INSERT.';
COMMENT ON COLUMN "platform"."audit_events"."record_hash" IS
    'sha256 of pipe-delimited canonical form (see migration SQL); populated by BEFORE INSERT trigger.';
