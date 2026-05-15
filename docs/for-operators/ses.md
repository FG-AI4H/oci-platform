# Amazon SES — operator runbook

The OCI Platform sends outbound mail via Amazon SES on a per-environment domain identity (`dev.oci.ai4h.net`, `int.oci.ai4h.net`, `oci.ai4h.net`). Inbound mail addressed to `oci-act@<env>.oci.ai4h.net` is captured by SES and forwarded to the operator mailbox by a Lambda.

This runbook covers the parts CDK doesn't automate: SES production-access requests, activating the inbound receipt rule set, DMARC tightening, and troubleshooting bounces. Day-to-day, the stack is hands-off — DKIM rotates inside SES and the DMARC posture stays where you set it.

The architecture rationale lives in [ADR-0004](../adr/0004-ses-mail-per-env-identity.md).

## Outbound mail — SMTP-to-SES relay (ADR-0005)

The AWS organisation SCP (`p-onj7rgr2`) blocks `iam:CreateUser`, so SES SMTP via an IAM user is not deployable. Instead, mail-stack ships a small Fargate service (`apps/smtp-relay`) that accepts SMTP from inside the VPC and forwards every message to SES via the task IAM role. DocuSeal connects to it via Cloud Map service discovery — no SMTP credentials, no secrets rotation.

### Architecture

```
DocuSeal task ──SMTP/TCP 2525──▶ smtp-relay.oci-<env>.internal ──ses:SendRawEmail──▶ SES Frankfurt
```

- Endpoint: `smtp-relay.oci-<env>.internal:2525` (private DNS via AWS Cloud Map).
- Auth: none — SG-to-SG ingress is the boundary. Only DocuSeal's task SG can connect.
- Sizing: 1 task on `dev`, 2-task HA pair on `int` / `prod`.

### Health checks

```bash
# Relay running?
AWS_PROFILE=ai4h aws ecs list-services --cluster oci-<env>-api --region eu-central-1 \
  --query 'serviceArns[?contains(@, `RelayService`)]' --output text

# Relay logs (most recent forwarded messages)
AWS_PROFILE=ai4h aws logs tail /oci/<env>/api --filter-pattern 'relay:forwarded' \
  --region eu-central-1 --since 30m --format short
```

A successful forward logs `relay:forwarded` with the from/to/bytes/elapsedMs envelope. Failures log `relay:failed` with the SES error message; DocuSeal retries on the next signing event because the relay surfaces SES errors as SMTP `451 4.3.0` (transient) rather than permanent rejections.

### Cost

~$7/month (single task, ARM/Graviton) on `dev`; ~$15/month (2-task HA) on `int` / `prod`. SES outbound itself stays within the 62k/month in-AWS-sender free tier at expected volume.

### When the relay is unhealthy

- **`smtp-relay.oci-<env>.internal` doesn't resolve from inside the VPC** → Cloud Map registration missing. Check `aws servicediscovery list-services --region eu-central-1` and the relay's ECS service for `RUNNING` tasks.
- **DocuSeal logs `Connection refused`** → task is RUNNING but listener died (rare). Force a new deployment: `aws ecs update-service --cluster oci-<env>-api --service <RelayService-…> --force-new-deployment`.
- **SES says `Email address is not verified`** → DocuSeal's `SMTP_FROM_EMAIL` env var is set to `oci-act@<env>.oci.ai4h.net` by CDK; verify that the identity is `VerifiedForSendingStatus: true` per the section above.

## Provisioning

```bash
pnpm --filter @oci/cdk exec cdk deploy oci-<env>-mail --context env=<env>
```

Provisions:

- `AWS::SES::EmailIdentity` for `<env>.oci.ai4h.net` with Easy-DKIM and a `bounce.<env>.oci.ai4h.net` mail-from subdomain.
- 3× DKIM CNAME records + SPF (`v=spf1 include:amazonses.com -all`) + DMARC (`p=none` to start) + MX record (SES inbound) on the `ai4h.net` hosted zone.
- S3 bucket `oci-<env>-ses-inbound` (7-day lifecycle) + inbound-forwarder Lambda + SES receipt rule set `oci-<env>-inbound`.

CFN takes ~3–5 minutes including DNS-record propagation; SES finishes verifying the identity within ~15 minutes of the records appearing in Route53.

## Verifying the identity is healthy

```bash
aws ses get-identity-verification-attributes \
  --identities dev.oci.ai4h.net \
  --region eu-central-1
```

`VerificationStatus` should be `Success`. If it's `Pending` more than 30 minutes after deploy, check `aws ses get-identity-dkim-attributes --identities dev.oci.ai4h.net` — `DkimEnabled=true` + `DkimVerificationStatus=Success` is the green-flag combination.

`dig +short TXT _amazonses.<env>.oci.ai4h.net` should return the SES-issued verification token; `dig +short CNAME <token>._domainkey.<env>.oci.ai4h.net` should resolve.

## Inbound forwarder

The receipt rule set `oci-<env>-inbound` is created by CDK but **not activated automatically** — SES only allows one active rule set per region/account, and CDK can't manage that singleton without interfering with other environments that share the account.

### Step 1 — Activate the receipt rule set (one-time per env)

```bash
aws ses set-active-receipt-rule-set \
  --rule-set-name oci-<env>-inbound \
  --region eu-central-1
```

Verify it is active:

```bash
aws ses describe-active-receipt-rule-set --region eu-central-1
```

The output's `Metadata.Name` should be `oci-<env>-inbound`.

### Step 2 — Verify the forward-to address (sandbox only)

While the account is in the SES sandbox, sending is limited to verified addresses. The forwarder Lambda sends as `oci-act@<env>.oci.ai4h.net` (on the verified domain — ok) but sends **to** `ml@mllab.ai` (an external address — blocked in sandbox). Fix:

```bash
aws sesv2 create-email-identity \
  --email-identity ml@mllab.ai \
  --region eu-central-1
```

AWS sends a verification email to `ml@mllab.ai`. Click the link. After verification, `aws sesv2 get-email-identity --email-identity ml@mllab.ai` returns `VerifiedForSendingStatus: true`.

Once the account leaves the sandbox (see § Production access below) this step is permanent and need not be repeated for new forward-to addresses.

### Step 3 — Test inbound forwarding

Send a test email to `oci-act@dev.oci.ai4h.net`. Within a few seconds:

- The raw email appears in S3 under `inbound/<messageId>`.
- The Lambda log group (`/aws/lambda/...InboundForwarderFn...`) shows `Forwarded <messageId> to ml@mllab.ai`.
- `ml@mllab.ai` receives the message with `Subject: [Fwd] …` and `Reply-To: <original sender>`.

## Production access (leaving the SES sandbox)

By default every region starts in **SES sandbox**: 200 sends/day, recipient addresses must be verified individually, no real-customer mail. Lifting the gate is a manual support case per region/account:

1. Open the AWS Support Center → **Create case** → **Service limit increase**.
2. Service: **SES Sending Limits**.
3. Provide:
   - **Use case**: "OCI Platform — operator notifications and DocuSeal e-signature workflow. Mail goes to opted-in researchers and host organisations who have explicitly requested access to controlled datasets."
   - **Recipient sourcing**: "Self-service registration via the OCI Platform; explicit consent recorded in the data-use-agreement workflow before any mail is sent."
   - **Bounce / complaint handling**: "DMARC aggregate reports forwarded to operator alias; bounce/complaint webhooks tracked as a follow-up." (Update once SNS handling lands.)
4. Submit. AWS typically responds within 24 hours.

Re-run per env (each environment is a separate identity).

## Tightening DMARC

The stack ships with `p=none` so SES warm-up and any misconfiguration shows up as warnings in aggregate reports, not as bounces. Hardening path:

1. **Week 1–2**: monitor `ml@mllab.ai` for DMARC aggregate reports (`rua` traffic). Look for failures from senders that aren't us (means SPF/DKIM align), or any failures at all.
2. **Week 3**: bump policy to `quarantine`. Edit the DMARC record in `mail-stack.ts` and redeploy. Any legitimate sender we missed gets quarantined, not rejected.
3. **Week 4+ (sustained green reports)**: bump to `reject`.

CDK edit example:

```ts
new route53.TxtRecord(this, 'DmarcRecord', {
  ...,
  values: [
    `v=DMARC1; p=quarantine; rua=mailto:${props.dmarcReportTo}; ruf=mailto:${props.dmarcReportTo}; fo=1; adkim=r; aspf=r`,
  ],
});
```

## When mail goes wrong

- **Hard bounces immediately on send**: check SES sandbox status (above). New identities outside the sandbox can still bounce on recipients with strict reputation policies — verify the receiving domain's MX / DMARC.
- **Mail goes to spam**: verify DKIM signing in the message headers (`Authentication-Results: ... dkim=pass`). If DKIM is failing, run `aws ses get-identity-dkim-attributes` and re-check the CNAMEs resolve.
- **Inbound forwarder Lambda not firing**: check that the receipt rule set is active (`aws ses describe-active-receipt-rule-set`). The Lambda log group (`/aws/lambda/...InboundForwarderFn...`) shows per-message results.

## When SES is unconfigured

If the SES stack hasn't been deployed yet, DocuSeal's Settings → Email Settings is just empty and the platform sends no mail — sign-in flows, access-request approvals, signing invites all degrade gracefully (DocuSeal returns the signer URL via the API, so signing still works without email). The CONTROLLED-tier signing flow is unaffected.
