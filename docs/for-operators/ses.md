# Amazon SES — operator runbook

The OCI Platform sends outbound mail via Amazon SES on a per-environment domain identity (`dev.oci.ai4h.net`, `int.oci.ai4h.net`, `oci.ai4h.net`). Inbound mail addressed to `oci-act@<env>.oci.ai4h.net` is captured by SES and forwarded to the operator mailbox by a Lambda.

This runbook covers the parts CDK doesn't automate: SES production-access requests, activating the inbound receipt rule set, DMARC tightening, and troubleshooting bounces. Day-to-day, the stack is hands-off — DKIM rotates inside SES and the DMARC posture stays where you set it.

The architecture rationale lives in [ADR-0004](../adr/0004-ses-mail-per-env-identity.md).

## SES SMTP credentials — SCP constraint

The AWS organisation SCP (`p-onj7rgr2`) explicitly blocks `iam:CreateUser` for **all** principals in account `601883093460`, including the CloudFormation execution role. SES SMTP requires IAM user access keys for credential derivation (HMAC-SHA256 of the secret key), which means SES SMTP wiring via CDK is not possible in this account.

**DocuSeal uses its built-in Postmark integration for outbound mail.** If SES SMTP is needed in future, the SCP must first be amended at the organisation level.

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
