-- AdES DUA signing via self-hosted DocuSeal (Phase B · DAP, #128,
-- ADR-0003 Decision 5). One greenfield table tracking signing
-- requests + completion state. CONTROLLED-tier DUAs route through
-- here; OPEN/REGISTERED continue to use click-wrap (#118 / SES);
-- SENSITIVE uses QES (Yousign, Phase 3 #131).

CREATE TABLE "identity"."dua_signatures" (
    "id"                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                UUID         NOT NULL,
    "access_request_id"      UUID         NOT NULL,
    "status"                 TEXT         NOT NULL DEFAULT 'PENDING',
    "docuseal_submission_id" TEXT,
    "signer_url"             TEXT,
    "document_text"          TEXT         NOT NULL,
    "document_sha256"        CHAR(64)     NOT NULL,
    "signed_pdf_url"         TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at"              TIMESTAMP(3),
    "declined_at"            TIMESTAMP(3),

    CONSTRAINT "dua_signatures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dua_signatures_user_id_created_at_idx"
    ON "identity"."dua_signatures" ("user_id", "created_at");

CREATE INDEX "dua_signatures_access_request_id_idx"
    ON "identity"."dua_signatures" ("access_request_id");
