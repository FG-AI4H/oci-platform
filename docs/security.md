# Security baseline

Security is non-negotiable for this platform. It handles regulator-facing assessment artefacts
and (over time) federated health data. This page is the operating contract.

## Identity & access

- **Cognito** is the only IdP. No application-level passwords, no per-app secrets, no API keys.
- **MFA** is optional in dev/int; **required** for `admin`, `regulator`, `supervisor` roles in prod.
- **Cognito advanced security (PLUS)** is enabled in prod for compromised-credential and adaptive risk checks.
- **JWT verification** uses `aws-jwt-verify` (JWKS-backed). All API endpoints require a valid Cognito JWT except `/health` and `/docs` (the latter only enabled in dev).
- **Roles via Cognito groups**: `admin`, `host`, `participant`, `annotator`, `reviewer`, `supervisor`, `regulator`. No application-defined role tables.
- **GitHub Actions** authenticate to AWS via **OIDC**, never via long-lived keys.

## Data protection

- **At rest**: KMS-CMK encryption on Aurora and S3. Each environment has its own CMK, keys auto-rotate annually.
- **In transit**: TLS 1.3 only at the ALB and CloudFront (security policy `TLS13_RES`). No TLS 1.0/1.1/1.2 fallback.
- **S3 buckets**: `BlockPublicAccess.BLOCK_ALL` + `enforceSSL: true` + `BUCKET_OWNER_ENFORCED` ownership + versioning. Prod artifact bucket has **Object Lock** enabled (compliance mode for assessment reports).
- **Aurora**: not publicly accessible, in private isolated subnets, IAM database auth enabled, audit logging exported to CloudWatch.

## Network

- 3 AZs, public subnets only host the ALB; everything else is private.
- WAFv2 attached to the ALB in int/prod with **AWSManagedRulesCommonRuleSet**, **KnownBadInputs**, **AmazonIpReputationList**.
- VPC flow logs to CloudWatch (REJECT in dev/int, ALL in prod).

## Code & supply chain

Every PR runs:
1. **ESLint** with `eslint-plugin-security`
2. **TypeScript strict mode** (errors, no `any` without explicit suppression)
3. **Vitest** unit & integration tests
4. **Trivy filesystem scan** for vulnerable dependencies (`CRITICAL`, `HIGH`)
5. **Gitleaks** for committed secrets
6. **CycloneDX SBOM** generation, uploaded as artifact

Every Docker image build runs:
- **Trivy image scan** (CRITICAL/HIGH must be 0; build fails otherwise)
- Distroless Node 20 base image (no shell, no package manager — minimal CVE surface)

`Dependabot` (configured in `.github/dependabot.yml`) opens PRs weekly for npm + GHA + Docker.

## Secrets management

- **No secrets in `.env` files in the repo**. `.env.example` files document keys; real values for dev/int/prod are stored in **AWS Secrets Manager** (one secret per env per service) and read at runtime by the application via IAM role.
- **`.env.local`** is git-ignored and only used for local dev.
- Cognito client IDs and Cognito region are NOT secrets — they're public.

## Logging & audit

- Structured JSON logs (pino) → CloudWatch with environment-specific retention (1mo dev, 6mo prod).
- All write operations on `identity`, `prediction`, `reporting` modules emit an `AuditEvent` to a dedicated audit log group (Phase D — fed by the `reporting` audit-trail module).
- CloudFront access logs to S3 (intelligent tiering, 90-day retention dev / 1-year prod).

## Incident response

- Alarms → SNS → email + (Phase A2) PagerDuty rotation.
- Runbooks in [`docs/runbooks/`](./runbooks/).
- Quarterly Security Hub remediation cadence (continued from current OCI eval platform; see `docs/security-remediation-2026-03-02.md`).

## What you must NOT do

- Don't disable `BlockPublicAccess` on S3 buckets, ever. (One affected access point in March 2026; see remediation doc.)
- Don't run certbot on a host (current eval platform pattern); use ACM via CDK.
- Don't store AWS credentials in `.env`. The current eval platform's history of AWS credential expiration issues comes from this anti-pattern.
- Don't commit Cognito user-pool IDs or client IDs into hard-coded source — pull from CDK outputs / SSM at runtime.
- Don't bump major versions of `next`, `nestjs`, `prisma`, `aws-cdk-lib` without an ADR.

## Threat model

We track an STRIDE-style threat model in [`docs/security-threat-model.md`](./security-threat-model.md) (Phase A1 deliverable).

## Standards alignment

- ISO/IEC 27001 control framework (Phase E target — formal audit)
- NIST 800-53 Moderate baseline as engineering reference
- GDPR — data residency in EU; access logs; right-to-erase via Cognito + Prisma soft-delete
- HIPAA — applicable when partners onboard PHI; baseline controls already cover most §164.312 requirements
