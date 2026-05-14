# ADR-0004: Amazon SES with per-env subdomain identity and inbound forwarder

- **Status:** proposed
- **Date:** 2026-05-14
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:platform` `area:operations` `area:governance`

## Context

The platform has had no outbound mail capability until now. DocuSeal (#128, ADR-0003 Decision 5) needs to email signers when a Data Use Agreement is sent for signature; the API will need to send access-request status notifications; operator runbooks reference a placeholder admin alias (`oci-act@ai4h.net`) that doesn't resolve to anything. None of the platform domains carry MX, SPF, DKIM, or DMARC records today.

Constraints:

- **Compliance audience reads governance docs.** ADR-0003 and `docs/for-governance/` claim a controlled, auditable platform. Sending mail from a domain without DKIM + SPF + DMARC undermines that claim and risks bounce-on-delivery from major receivers (Gmail and Yahoo enforce DMARC since 2024).
- **Three environments.** `dev`, `int`, `prod`. Dev mailbox leaks must not affect prod sender reputation; prod bounce-rate spikes must not freeze dev sends.
- **DocuSeal first.** DocuSeal authenticates to SMTP, not the SES API. Whatever we build has to expose SMTP credentials, not just an IAM role.
- **Receive at a real address.** Today the runbook says "use a shared `oci-act@ai4h.net` distribution-list address (TBD with the OCI ACT)." We need an alias that actually delivers — to a person initially, to a team mailbox once one exists.

## Decision

Verify a **per-environment SES domain identity** (`dev.oci.ai4h.net`, `int.oci.ai4h.net`, `oci.ai4h.net`) with Easy-DKIM, SPF, and DMARC. Each env owns its own SMTP IAM user + secret, its own bounce/complaint topic, and its own inbound rule set writing to a per-env S3 bucket. A Lambda forwarder rewrites `From:` and forwards `oci-act@<env>.oci.ai4h.net` to `ml@mllab.ai` (replaceable when a team alias exists).

The apex zone `ai4h.net` is left untouched — no records added at the apex, no identity verified there.

DocuSeal is the first sender. The OCI API gains SES API access via task-role grants in a follow-up (#193 lists it as out-of-scope for the initial roll-out).

## Consequences

### Positive

- **Deliverability.** Real SPF + DKIM + DMARC means Gmail/Yahoo/Microsoft accept mail without warning banners. Audit-friendly.
- **Blast radius.** A dev SMTP-credential leak only damages `dev.oci.ai4h.net`'s reputation, not prod.
- **No mailbox vendor dependency.** Inbound forwarding via SES → S3 → Lambda → SES-send avoids signing the org up for Google Workspace / M365 just to receive ten messages a year.
- **CDK-native.** Identities, rule sets, IAM users, and Route53 records are all in the existing CDK monorepo. No console-clicks.

### Negative

- **SES sandbox.** Each env starts in SES sandbox (recipient-verification + 200/day limit). Production access requires a manual support case per region/account. We track this as a separate manual step in #193.
- **Inbound forwarder maintenance.** A Lambda that parses MIME and re-sends mail is small but non-trivial — header rewriting, attachment handling, bounce-loop guards. We pin to a well-known shape (SES + S3 + Lambda, AWS reference architecture) but it's still code to maintain.
- **Apex untouched is a trade-off.** Mail from `mlecoultre@ai4h.net` won't be possible without later verifying the apex — an explicit "future me" item if anyone tries to use a non-env address.
- **DMARC starts at `p=none`.** Strict policy (`quarantine` / `reject`) needs a few weeks of aggregate-report observation first. We document the hardening path in the runbook so it doesn't drift.

### Neutral

- Adds a new CDK stack `oci-<env>-mail` parallel to the existing per-env stacks. Deploy order: `network → identity → observability → data → api → docuseal → mail → web`. Mail has no runtime dependents at deploy time; it sits after the data path so the bounce-handler IAM role can reference shared logging.
- DocuSeal Settings → Email config moves out of the operator-runbook "TBD" column into "configure once via admin UI, post-bootstrap step."

## Alternatives considered

- **Single apex identity (`ai4h.net`).** Simpler DNS, one DKIM key, one SPF/DMARC. Rejected: env isolation matters more than DNS simplicity, especially since DMARC enforcement on the apex would affect any future email-using project under `ai4h.net`.
- **Both apex and per-env identities.** Apex for outbound from-addresses, per-env for bounce/complaint domains. Most flexible but most DNS surface. Rejected for now as gold-plating — we have no current need for the flexibility.
- **SES API (not SMTP) for DocuSeal.** DocuSeal upstream supports SMTP only; would require forking or running a sidecar SMTP-to-SES bridge. Rejected: forking DocuSeal for one feature is disproportionate.
- **Mailgun / Postmark.** Lower friction for "just send the email." Rejected: another vendor for credential management, billing, and bounce handling, when SES is already in our trust + cost envelope. Also adds a `From:` address outside the platform's verified domains.
- **Google Workspace / Microsoft 365 for inbound.** Real mailbox, no Lambda. Rejected for now: the team is too small to justify per-seat licensing; we revisit when the OCI ACT formalises and the team grows.

## References

- Issue: [FG-AI4H/oci-platform#193](https://github.com/FG-AI4H/oci-platform/issues/193) — tracking implementation
- ADR-0001 — domain choice (`ai4h.net`); this ADR follows the same per-env subdomain convention
- ADR-0003 §Decision 5 — DocuSeal as the e-signature anchor; the trigger for needing outbound mail
- AWS docs — [SES domain identity verification](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [SES inbound rule sets](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules.html), [SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- M3AAWG / RFC 7489 — DMARC operational guidance
