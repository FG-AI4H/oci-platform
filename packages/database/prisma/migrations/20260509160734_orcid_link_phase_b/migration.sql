-- ORCID iD link (Phase B · DAP, #125, ADR-0003 Phase 2). One row per
-- user — a Cognito identity has at most one linked ORCID. The
-- identity-context normalizer queries this table to lift the requester
-- score to ORCID_LINKED (rank 2 — between EMAIL_DOMAIN_VERIFIED and
-- QUIZ_PASSED) per ADR-0003 Decision 2.
--
-- Greenfield table; no backfill required. Empty until the first user
-- completes the OAuth dance.

-- CreateTable
CREATE TABLE "identity"."user_orcid_links" (
    "user_id"        UUID         NOT NULL,
    "orcid_id"       TEXT         NOT NULL,
    "full_name"      TEXT,
    "primary_email"  TEXT,
    "affiliation"    TEXT,
    "verified_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_orcid_links_pkey" PRIMARY KEY ("user_id")
);

-- One ORCID iD belongs to at most one OCI account. Re-linking a
-- different OCI user to a previously-claimed ORCID will fail at this
-- constraint — that's intentional; it prevents identity-shifting.
CREATE UNIQUE INDEX "user_orcid_links_orcid_id_key"
    ON "identity"."user_orcid_links" ("orcid_id");
