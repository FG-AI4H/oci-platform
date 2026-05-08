-- Email-domain allowlist (Phase B · DAP, #116) — per-dataset
-- allow-list of email domains. Empty array means "allowlist disabled":
-- the access-request flow falls back to the `classifyEmailDomain`
-- heuristic (institutional / corporate / public / disposable) for tier
-- decisions. When non-empty, the host has explicitly enumerated the
-- consortium / organisation domains they pre-approve.
--
-- Format mirrors the shared-types `EmailDomainAllowlistEntrySchema`:
-- bare domain (`example.org`) or leading-dot wildcard (`.example.org`).
-- The API validates entries on write; this column stores them as-is.

-- AlterTable
ALTER TABLE "catalog"."datasets"
ADD COLUMN "email_domain_allowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
