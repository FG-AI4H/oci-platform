-- Seam intake idempotency (WP4, #408).
--
-- An EvalAI submission pk identifies ONE entry. Without a uniqueness guarantee
-- here, a forwarder that retries after a timeout — the correct transport policy
-- for a 5xx, and the one the EvalAI-side worker implements — creates a SECOND
-- submission for the same entry and spends a SECOND slot out of the entrant's
-- ten. The quota is the anti-overfitting control, so a slot lost to a network
-- blip is not a cosmetic problem and an entrant cannot recover it themselves.
--
-- Scoped to the pair, not to the submission id alone: EvalAI pks are unique per
-- installation, but nothing in this schema guarantees the platform only ever
-- faces one front door, and a collision across challenges would silently
-- reject a legitimate submission.
--
-- Postgres treats NULLs as distinct in a unique index, so the many rows with no
-- external reference at all — every directly-submitted entry, which is the
-- documented fallback path — are unaffected. That is why this can be a plain
-- unique index rather than a partial one Prisma could not express.
CREATE UNIQUE INDEX "submissions_external_ref_key"
    ON "evaluation"."submissions"("external_challenge_id", "external_submission_id");
