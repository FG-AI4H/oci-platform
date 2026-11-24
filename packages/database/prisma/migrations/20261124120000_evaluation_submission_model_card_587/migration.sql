-- Validation evidence on the model card (#587).
--
-- WHY. The platform scores submissions, but a score never reached the model
-- card it measured: there was no link from `Submission` to `ModelCard`, so the
-- Model Facts label could only say "no evaluation results are linked". A
-- submission now names the card it scored, and the label reads its
-- `performance` rows from the linked submissions.
--
-- ADDITIVE ONLY: one nullable column, one index, one foreign key.
--
--   1. `submissions.model_card_id`: nullable, no default, so PostgreSQL adds
--      it in the catalog without rewriting the table. Null for every existing
--      submission: no row is backfilled, because which card an old result
--      measured was never recorded and guessing it would invent evidence.
--
--   2. An index on it: the Model Facts read lists every submission of one card.
--
--   3. The foreign key, ON DELETE RESTRICT. A model card leaves the record by a
--      status change to WITHDRAWN, never by a DELETE (no delete path exists,
--      and the parent-version FK on `model_cards` is RESTRICT for the same
--      reason). SET NULL would let a delete quietly strip a validation result
--      of the model it was produced for; RESTRICT makes that a loud error. A
--      plain ADD CONSTRAINT is safe: the column is new and all-null, so no
--      existing row can violate it and the validation scan is trivial.
--
-- Cross-schema (evaluation -> prediction), like the existing
-- annotation -> catalog keys.

-- AddColumn
ALTER TABLE "evaluation"."submissions"
    ADD COLUMN "model_card_id" UUID;

-- CreateIndex
CREATE INDEX "submissions_model_card_id_idx"
    ON "evaluation"."submissions" ("model_card_id");

-- AddForeignKey
ALTER TABLE "evaluation"."submissions"
    ADD CONSTRAINT "submissions_model_card_id_fkey"
    FOREIGN KEY ("model_card_id") REFERENCES "prediction"."model_cards" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
