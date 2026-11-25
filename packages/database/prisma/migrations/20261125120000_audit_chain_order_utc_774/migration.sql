-- Audit chain: link order and time zone (#774, amends ADR-0014 §2).
--
-- Replaces the body of the BEFORE INSERT chain trigger from
-- 20260517100000_audit_events_257. Two faults in it:
--
-- 1. Order. `sequence_number` came from its BIGSERIAL default, evaluated
--    before the trigger took the chain lock, and the trigger linked the
--    row to the last row numbered below it. Numbers are handed out in one
--    order and the lock is granted in another, so a row could be linked
--    while a lower-numbered row was still waiting for the lock: two rows
--    then point at the same predecessor, and a verifier walking in
--    sequence order reports a previous-hash break that is not tampering.
--    A transaction that writes two events while another insert waits
--    does it every time.
--
--    Now the trigger takes the lock first, reads the last row of the
--    chain, and gives the new row the next number and that row's hash.
--    `sequence_number` is the chain order and the commit order, with no
--    gaps from here on; the BIGSERIAL default still fills the column and
--    the trigger overwrites it.
--
-- 2. Time zone. The record hash formats `occurred_at AT TIME ZONE 'UTC'`,
--    which for this `timestamp` column is a `timestamptz`, and `to_char`
--    prints a `timestamptz` in the session's time zone. A session in any
--    other zone stored a hash no verifier reproduces.
--
--    Now the function runs with `TimeZone = 'UTC'` whatever the session
--    says, so the expression prints the stored value as UTC, which is
--    what the verifier (`recordHash` in @oci/audit) prints.
--
-- Existing rows. The hash formula is unchanged, character for character.
-- In a UTC session (Aurora and the containers run in UTC, and the
-- one-off runner sets it) the old function printed exactly what this one
-- prints, so every row that verified before still verifies; a row a
-- non-UTC session wrote never verified and still does not. The verifier
-- still walks in sequence order. Nothing is rewritten and no verifier
-- needs to know where the new rule starts.
--
-- Correctness under READ COMMITTED. The lock is a transaction-level
-- advisory lock, the same key as before, held until the inserting
-- transaction commits or rolls back. In a VOLATILE PL/pgSQL function
-- every statement takes a new snapshot, so the SELECT below, run after
-- the lock is granted, sees every row of every transaction that held the
-- lock before (they have all ended), plus this transaction's own rows,
-- including earlier rows of the same multi-row INSERT. No other
-- transaction can have an uncommitted chain row, since it would hold
-- the lock. So the row it reads is the true end of the chain.
--   - A transaction that inserts and then rolls back takes its rows and
--     the lock with it; the next writer reads the same end and reuses
--     the number. No gap, no fork.
--   - A transaction that holds the lock for long (it wrote an event
--     early and keeps working) makes every other audit insert wait until
--     it ends. That was already so with the old trigger: same lock, same
--     duration.
--   - Under REPEATABLE READ or SERIALIZABLE the SELECT uses the
--     transaction's older snapshot and may miss the newest rows. The
--     number it computes is then already taken, and the unique index on
--     `sequence_number` rejects the insert: an error, never a fork.
--
-- Locks taken by this migration: none on audit_events. CREATE OR REPLACE
-- FUNCTION updates the function's catalog row and keeps its OID, so the
-- existing trigger uses the new body from the commit on: an insert whose
-- trigger starts after the commit runs the new body. No table rewrite,
-- no index build, nothing that waits on readers or writers.

CREATE OR REPLACE FUNCTION "platform"."audit_events_chain_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET "TimeZone" = 'UTC'
AS $$
DECLARE
    last_sequence BIGINT;
    prev_hash TEXT;
    canonical TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5('platform.audit_events'), 1, 16))::bit(64)::bigint
    );

    SELECT "sequence_number", "record_hash"
      INTO last_sequence, prev_hash
      FROM "platform"."audit_events"
     ORDER BY "sequence_number" DESC
     LIMIT 1;

    NEW."sequence_number" := COALESCE(last_sequence, 0) + 1;
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

