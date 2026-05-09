-- GA4GH Passport relying party (Phase B · DAP, #126, ADR-0003 Phase 2).
--
-- Two greenfield tables:
--   - passport_trusted_issuers: admin-managed allowlist of issuer URLs.
--                               JWTs are accepted only when iss matches
--                               an active row.
--   - user_passport_visas:      verified Visas held by a user. Ingested
--                               JWT is validated against the issuer's
--                               JWKS, then decoded; the ga4gh_visa_v1
--                               claim is stored verbatim.
--
-- Identity-context normalizer queries user_passport_visas filtered by
-- (userId, expiresAt > now(), revokedAt IS NULL) to lift the requester
-- score to PASSPORT_VERIFIED (rank 5 — top of the ladder) when a
-- ResearcherStatus visa is held per ADR-0003 Decision 3.

-- CreateTable
CREATE TABLE "identity"."passport_trusted_issuers" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "issuer"       TEXT         NOT NULL,
    "display_name" TEXT         NOT NULL,
    "jwks_uri"     TEXT,
    "revoked_at"   TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passport_trusted_issuers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "passport_trusted_issuers_issuer_key"
    ON "identity"."passport_trusted_issuers" ("issuer");

-- CreateTable
CREATE TABLE "identity"."user_passport_visas" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID         NOT NULL,
    "issuer"      TEXT         NOT NULL,
    "visa_type"   TEXT         NOT NULL,
    "jti"         TEXT         NOT NULL,
    "payload"     JSONB        NOT NULL,
    "asserted_at" TIMESTAMP(3) NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at"  TIMESTAMP(3),

    CONSTRAINT "user_passport_visas_pkey" PRIMARY KEY ("id")
);

-- One (user, issuer, visaType, jti) row — re-ingest of the same visa
-- updates verifiedAt rather than creating duplicates.
CREATE UNIQUE INDEX "user_passport_visas_user_id_issuer_visa_type_jti_key"
    ON "identity"."user_passport_visas" ("user_id", "issuer", "visa_type", "jti");

CREATE INDEX "user_passport_visas_user_id_expires_at_idx"
    ON "identity"."user_passport_visas" ("user_id", "expires_at");

CREATE INDEX "user_passport_visas_visa_type_idx"
    ON "identity"."user_passport_visas" ("visa_type");

-- Seed initial trust roots per ADR-0003 Phase 2. These are the
-- deployments confirmed to issue GA4GH-spec Visas today; the Sage
-- broker entry will land when their roadmap solidifies (#131).
-- Operators can `UPDATE … SET revoked_at = now()` to drop a root
-- without losing audit history; the verifier already filters on
-- `revoked_at IS NULL`.
INSERT INTO "identity"."passport_trusted_issuers"
    ("issuer", "display_name", "updated_at")
VALUES
    ('https://login.elixir-czech.org/oidc/', 'ELIXIR AAI', CURRENT_TIMESTAMP),
    ('https://stsstg.nih.gov/', 'NIH RAS', CURRENT_TIMESTAMP)
ON CONFLICT ("issuer") DO NOTHING;
