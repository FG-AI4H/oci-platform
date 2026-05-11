# ADR-0001: Custom domain — ai4h.net with `oci` prefix

- **Status:** proposed
- **Date:** 2026-05-03
- **Deciders:** mlecoultre
- **Tags:** `area:platform`, `area:dns`, `area:tls`

## Context

Phase A2-2 brought the dev environment up end-to-end via the direct ALB
(`http://oci-de-ApiSe-...-eu-central-1.elb.amazonaws.com/health` returns 200),
but CloudFront → ALB still 504s. Root cause: the ALB intentionally listens
on port 80 only (no TLS cert provisioned yet) while the CDN was wired to
talk to its origin via HTTPS only. Resolving that requires a real TLS cert
on the ALB and a custom domain on CloudFront.

Hard constraints:

- The platform must serve only over TLS 1.2+ (`docs/security.md`).
- Three environments: `dev`, `int`, `prod`.
- All AWS resources via CDK (`CLAUDE.md` rule 3).
- ALB cert must live in `eu-central-1` (regional). CloudFront cert MUST
  live in `us-east-1` (CloudFront only consumes ACM certs from N. Virginia).
- We don't want to touch the legacy `aiaudit.org` zone; `health.aiaudit.org`
  continues to serve the legacy stack until Phase C cutover.

Domain discovery: `ai4h.net` is already a Route 53 hosted zone in account
`601883093460` (`Z09716362NE75KQEXM9N9`, 12 records). It is shared with
other FG-AI4H tenants — `annotation.ai4h.net`, `eval.ai4h.net`,
`www.ai4h.net`, `*.fateboard.ai4h.net`, `*.notebook.ai4h.net`,
`eks-eu-central-1.ai4h.net`. No further delegation is required; we add
records additively under a dedicated subzone.

The original `oci.aiaudit.org` plan documented in `CLAUDE.md` is
superseded — that zone is now reserved for the legacy `health.aiaudit.org`
deployment until Phase C decommissions it.

## Decision

The OCI Platform uses **`ai4h.net` with an `oci` prefix** for all
environments:

- `dev.oci.ai4h.net` → dev
- `int.oci.ai4h.net` → int
- `oci.ai4h.net` (apex of the `oci` subzone) → prod

Each environment provisions:

1. **One** ACM cert in `eu-central-1` for its FQDN, DNS-validated
   against the existing `ai4h.net` hosted zone.
2. The cert is attached to the regional ALB on an HTTPS listener
   (port 443) using the AWS-recommended TLS policy. Port 80 redirects
   to 443; no plaintext path remains.
3. Route 53 `A` + `AAAA` alias records pointing the FQDN to the ALB.
4. **CloudFront is removed from the per-env path for Phase A2.** The
   `web-stack` is retired; the ALB serves clients directly.

Security headers (HSTS, CSP, frame-options, referrer-policy) move from
the CloudFront response-headers policy to the NestJS application layer
via `@fastify/helmet` (already wired in `apps/api/src/main.ts`).

WAF (int/prod) continues to attach to the regional ALB — same as
before, no behaviour change.

100% of OCI Platform AWS resources now live in `eu-central-1`.

`environments.ts` `domainName` field is updated:

| env  | old (in CLAUDE.md)    | new                |
| ---- | --------------------- | ------------------ |
| dev  | `dev.oci.aiaudit.org` | `dev.oci.ai4h.net` |
| int  | `int.oci.aiaudit.org` | `int.oci.ai4h.net` |
| prod | `oci.aiaudit.org`     | `oci.ai4h.net`     |

## Consequences

### Positive

- HTTPS works end-to-end with a single ACM cert in `eu-central-1`. No
  cross-region reference machinery, no us-east-1 footprint.
- Public URLs are clean (`dev.oci.ai4h.net/v2/...`) and obviously
  identify the OCI Platform vs. other `ai4h.net` tenants.
- HSTS / CSP / frame-options on real responses (no longer over a
  `*.cloudfront.net` URL we don't control).
- Cognito callback / logout URLs already templated against
  `domainName` in `identity-stack.ts` start working correctly.
- Phase C legacy cutover gets simpler: `health.aiaudit.org` stays put,
  the new platform is on a separate apex.
- Architecture matches data-residency posture (everything in Frankfurt
  / EU).

### Negative

- We give up CloudFront's edge cache (already disabled — API responses
  are not cacheable) and edge ACL features (CFR1 geo / CFR2 WAF). WAF
  remains attached to the regional ALB in int/prod.
- We give up CloudFront's small DDoS-absorption value at the edge.
  AWS Shield Standard still applies to the ALB. If prod ever needs
  edge-based DDoS or Anycast routing, we revisit (this ADR explicitly
  permits revisiting for prod with a dedicated us-east-1 cert).
- DNS validation requires write access to the `ai4h.net` hosted zone.
  The `gha-oci-deploy-{env}` role's PowerUserAccess covers it; the
  Phase A2 narrowing PR has to keep `route53:ChangeResourceRecordSets`
  on the FG-AI4H zone.
- We share the apex zone with other FG-AI4H tenants — accidental
  changes to `ai4h.net` zone records could affect them. Mitigated by
  scoping all records under the `oci` subdomain.

### Neutral

- The `oci.aiaudit.org` plan in `CLAUDE.md` is superseded; CLAUDE.md
  needs an update (separate PR, after this ADR lands).
- Cognito user-pool domain remains the Cognito-managed
  `oci-{env}.auth.eu-central-1.amazoncognito.com` for now; mapping to
  `auth.dev.oci.ai4h.net` is a Phase A2 follow-up.

## Alternatives considered

- **Apex `dev.ai4h.net` / `int.ai4h.net` / `ai4h.net`** — no `oci`
  prefix. Rejected: the apex `ai4h.net` is shared with other tenants,
  taking the apex for the OCI Platform would create implicit ownership
  the other services don't expect.
- **Stay on `oci.aiaudit.org` plan** — register and delegate that zone
  to Route 53. Rejected: requires owning a second apex and extra
  delegation; `ai4h.net` is already there.
- **Self-signed cert on the ALB** with the CDN doing TLS termination
  end-to-end via PKI. Rejected: brittle, fails AWS WAF and
  many security scanners; AWS recommends ACM end-to-end.
- **CDN origin policy `HTTP_ONLY` permanently** — keeps the ALB on
  HTTP forever. Rejected: in-VPC plaintext hop violates
  `docs/security.md` ("All data … in transit (TLS 1.3 only)").

## References

- `docs/security.md` — TLS-only mandate.
- AWS docs:
  [CloudFront ACM cert region requirement](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html#https-requirements-aws-region)
- Phase A2-2 deploy memory:
  `~/.claude/projects/-Users-mlecoultre-src-oci-platform/memory/project_phase_a2_status.md`
