-- Click-wrap policy acceptance (#118, ADR-0003 Decision 4) — SES-grade
-- evidence for OPEN/REGISTERED tier flows. Stores the policy text
-- verbatim + its SHA-256 hash so the binding can be re-verified even
-- if the canonical document is later updated. Optional KMS-signed
-- receipt provides tamper-evidence beyond the hash.
--
-- Greenfield table; no data backfill required. The first user-facing
-- consumer is the access-request flow's `pledgeAcceptedAt` step (a
-- form-side widget will land alongside #120 builder/researcher
-- variants); for now the API endpoints stand on their own and the
-- table is empty until clients start writing.

-- CreateTable
CREATE TABLE "identity"."policy_acceptances" (
    "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"            UUID         NOT NULL,
    "policy_url"         TEXT         NOT NULL,
    "policy_version"     TEXT         NOT NULL,
    "policy_text"        TEXT         NOT NULL,
    "text_sha256"        CHAR(64)     NOT NULL,
    "context_type"       TEXT,
    "context_ref"        TEXT,
    "receipt_signature"  TEXT,
    "receipt_key_id"     TEXT,
    "accepted_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_acceptances_pkey" PRIMARY KEY ("id")
);

-- Index supporting "show me a user's acceptance audit trail, newest
-- first". Most read traffic is on this access pattern.
CREATE INDEX "policy_acceptances_user_id_accepted_at_idx"
    ON "identity"."policy_acceptances" ("user_id", "accepted_at" DESC);

-- Index supporting "did this access request have a click-wrap
-- acceptance attached?" — context_type='access_request', context_ref=<id>.
CREATE INDEX "policy_acceptances_context_type_context_ref_idx"
    ON "identity"."policy_acceptances" ("context_type", "context_ref");
