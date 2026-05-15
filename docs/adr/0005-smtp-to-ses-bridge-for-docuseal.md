# ADR-0005: SMTP-to-SES bridge for DocuSeal outbound mail

- **Status:** accepted
- **Date:** 2026-05-15
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:platform` `area:operations` `area:governance`

## Context

[ADR-0004](./0004-ses-mail-per-env-identity.md) decided on Amazon SES with per-env domain identities and outlined SMTP credentials (an IAM user with a derived SMTP password) as the path for DocuSeal — the only authenticated sender in the platform today, and the only one that speaks SMTP rather than the SES API.

While deploying the mail-stack to `dev` (PR #198), CloudFormation failed creating the SES SMTP IAM user with an explicit `Deny` from an organisation-level Service Control Policy:

```
Service control policy: arn:aws:organizations::454345143581:policy/o-octg8ez6hw/service_control_policy/p-onj7rgr2
Action: iam:CreateUser
Effect: explicit Deny for ALL principals in account 601883093460
```

Manual verification confirmed the SCP denies `iam:CreateUser` for every principal in the account, including `AdministratorAccessRole` and the CloudFormation execution role. SES SMTP uniquely **requires an IAM user**: the SMTP password is derived from the user's secret access key (HMAC-SHA256 + version byte 0x04 + base64), and SES does not accept STS-issued credentials, role assumption results, or any non-IAM-user identity for SMTP authentication.

ADR-0004's SMTP-IAM-user plan is therefore not deployable in this account. The SES inbound forwarder, which uses an IAM role (not a user), is unaffected and works end-to-end.

Constraints driving the replacement design:

- **DocuSeal speaks SMTP, not the SES API.** Patching the upstream Rails app to call SES via AWS SDK is out of proportion for one outbound feature and would diverge us from upstream.
- **Sovereignty matters.** OCI Platform's governance audience (`docs/for-governance/`, `docs/for-strategy/`) reads "data and operations stay inside AWS Frankfurt" as a load-bearing claim. Routing operator and signer notifications through a third-party mail vendor weakens that claim, even if the underlying domain still signs with our DKIM keys.
- **Postmark fallback works for dev** but adds a second billing relationship, a second deliverability dashboard, and a second secret-rotation procedure — friction the operator runbook would have to absorb in perpetuity.
- **Operational cost has to stay small.** The whole mail surface is operator notifications + signing invitations. Sub-thousand emails per month at any realistic scale. A new service should cost low-tens of dollars per month, not hundreds.

## Decision

Run a small **SMTP-to-SES relay** as a Fargate service inside the existing VPC. DocuSeal connects to it over plain SMTP on the private network; the relay authenticates to SES via its task IAM role and calls `ses:SendRawEmail`.

Concretely:

- One Fargate task per env (0.25 vCPU, 0.5 GB, ARM/Graviton), discoverable via AWS Cloud Map at `smtp-relay.oci-<env>.internal:25`. `int` and `prod` run a 2-task HA pair; `dev` runs a single task.
- The relay accepts SMTP from inside the VPC only — no listener exposure, no authentication needed; the security group on the relay's ENI only allows ingress from the DocuSeal task's security group.
- The relay's task role carries a least-privilege `ses:SendRawEmail` grant scoped to the per-env identity ARN. No IAM user, no derived SMTP password, no Secrets Manager rotation.
- DocuSeal's task definition consumes the relay via plaintext env vars: `SMTP_ADDRESS=smtp-relay.oci-<env>.internal`, `SMTP_PORT=25`, `SMTP_FROM_EMAIL=oci-act@<env>.oci.ai4h.net`, `SMTP_FROM_NAME=OCI Platform`. No SMTP_USERNAME / SMTP_PASSWORD — the relay needs none.
- Implementation: an existing OSS image (e.g. `arnaudambro/aws-ses-smtp-relay` or equivalent) **or** a ~50-line TypeScript service using `smtp-server` + `@aws-sdk/client-ses`, written in-tree under `apps/smtp-relay/`. Final image choice deferred to the implementation PR.

The relay lives in its own CDK construct inside `mail-stack` (the SES identity owner) — not in `docuseal-stack` — so future SES senders (the OCI API once it joins) can connect to the same relay without taking a dependency on DocuSeal.

## Consequences

### Positive

- **AWS-only sovereignty.** All operator and signer notifications transit AWS Frankfurt only. Governance docs stay honest.
- **No IAM user.** Sidesteps the SCP entirely. Future cross-account / cross-org policy tightening doesn't break us.
- **No SMTP-credential rotation.** Task-role credentials rotate on the AWS-managed schedule; no Secrets Manager `RotationVersion` bumps; no operator runbook for password rotation.
- **Reusable.** The OCI API, once it joins outbound mail (per [ADR-0004](./0004-ses-mail-per-env-identity.md) follow-on), can use the same relay or the SES API directly — the relay never becomes a blocker.
- **Cheap.** Single-task dev: ~$7/month. HA prod: ~$15/month. SES outbound itself stays within the in-AWS-sender free tier (62k/month).

### Negative

- **New service to maintain.** SMTP daemons are mature but non-trivial. Pinning to a maintained OSS image plus a thin wrapper keeps the surface small. Either way, this is a new runtime artefact in CI, ECR, the deploy pipeline, and the operator runbook.
- **Single point of failure for outbound mail on dev.** A single-task dev relay has minutes of downtime during task replacement. Acceptable for dev; HA pair on int/prod removes the risk for real signing flows.
- **SMTP port-25 inside the VPC is unauthenticated.** Mitigated by SG-to-SG ingress (only DocuSeal's ENI can connect) and by the relay refusing relays from any source it can't tie to the DocuSeal security group. A misconfigured peer pod would still send mail; the blast radius is "send a few signing invites from the wrong template," not credential theft.
- **One more layer between DocuSeal and SES.** If the relay misbehaves, mail vanishes silently. CloudWatch metrics on `ses:SendRawEmail` calls + a synthetic outbound canary mitigate; both are added in the implementation PR.

### Neutral

- Mail-stack grows a new construct (the relay service). Deploy order is unchanged — `mail` still deploys before `docuseal` so the relay endpoint exists when DocuSeal first reads its env vars.
- DocuSeal admin UI's Settings → Email page no longer needs operator paste; both `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME` arrive as task-def env vars on the first deploy.

## Alternatives considered

- **Postmark** (DocuSeal's built-in default). Zero-infra; ~$15/month at our volume; DocuSeal's first-class supported transport. Rejected: second vendor relationship for a workload comfortably handled in AWS; weakens the sovereignty claim in the governance docs.
- **Wait for the SCP to be amended.** The clean fix would be SES SMTP per ADR-0004's original plan. Rejected: the SCP is an org-level policy outside this account's control; timeline to amend is unknown; we can't block DocuSeal mail on an org governance change.
- **Patch DocuSeal to call SES API directly.** Replaces SMTP with a Rails-side SES adapter via AWS SDK using the task role. Rejected: forking DocuSeal for one transport is disproportionate (ADR-0004 made the same call); upstream churn would be perpetual maintenance.
- **No outbound mail; share signer URLs out-of-band.** Operationally cheapest. Rejected: signing-invitation mail is part of DocuSeal's UX contract; absence works for early dev only, not for any real host onboarding.
- **Lambda-based relay (SMTP listener on Lambda).** Cheapest at idle. Rejected: Lambda doesn't expose long-lived TCP sockets, and SMTP needs them. Workarounds via API Gateway TCP routes etc. exist but are exotic; the Fargate path is straightforward.

## References

- [ADR-0004](./0004-ses-mail-per-env-identity.md) — the SES per-env design this ADR builds on; its SMTP-IAM-user decision is the part this amends
- Issue: [FG-AI4H/oci-platform#193](https://github.com/FG-AI4H/oci-platform/issues/193) — original SES rollout
- Issue: this ADR's implementation issue (to be filed after merge)
- `docs/for-operators/ses.md` § "SES SMTP credentials — SCP constraint"
- AWS docs — [SES SendRawEmail API](https://docs.aws.amazon.com/ses/latest/APIReference/API_SendRawEmail.html), [Cloud Map service discovery for ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-discovery.html)
