-- OCI as GA4GH Passport issuer (Phase B · DAP, #127, ADR-0003 Phase 2).
--
-- Two greenfield tables:
--   - issued_passport_visas: visas the platform mints for users when
--                            internal events warrant assertion (quiz
--                            pass → ResearcherStatus, click-wrap →
--                            AcceptedTermsAndPolicies, AR approval →
--                            ControlledAccessGrants).
--   - passport_signing_keys: registry of the keys we sign with. KMS
--                            ARN or in-memory PEM (dev only). Public
--                            JWK is cached on the row so the JWKS
--                            endpoint doesn't hit KMS on every read.
--
-- The OCI issuer URL is also added to the trusted-issuer list so
-- internal verifiers can self-trust when needed (federation round-trip).

-- CreateTable
CREATE TABLE "identity"."issued_passport_visas" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"      UUID         NOT NULL,
    "visa_type"    TEXT         NOT NULL,
    "value"        TEXT         NOT NULL,
    "source"       TEXT         NOT NULL,
    "jti"          TEXT         NOT NULL,
    "kid"          TEXT         NOT NULL,
    "asserted_at"  TIMESTAMP(3) NOT NULL,
    "expires_at"   TIMESTAMP(3) NOT NULL,
    "revoked_at"   TIMESTAMP(3),
    "context_type" TEXT,
    "context_ref"  TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issued_passport_visas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "issued_passport_visas_jti_key"
    ON "identity"."issued_passport_visas" ("jti");

CREATE INDEX "issued_passport_visas_user_id_visa_type_expires_at_idx"
    ON "identity"."issued_passport_visas" ("user_id", "visa_type", "expires_at");

CREATE INDEX "issued_passport_visas_context_type_context_ref_idx"
    ON "identity"."issued_passport_visas" ("context_type", "context_ref");

-- CreateTable
CREATE TABLE "identity"."passport_signing_keys" (
    "kid"             TEXT         NOT NULL,
    "alg"             TEXT         NOT NULL,
    "kms_key_arn"     TEXT,
    "private_key_pem" TEXT,
    "public_jwk"      JSONB        NOT NULL,
    "status"          TEXT         NOT NULL DEFAULT 'ACTIVE',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at"      TIMESTAMP(3),
    "archived_at"     TIMESTAMP(3),

    CONSTRAINT "passport_signing_keys_pkey" PRIMARY KEY ("kid")
);
