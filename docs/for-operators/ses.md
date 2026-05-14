# Amazon SES — operator runbook

The OCI Platform sends outbound mail via Amazon SES on a per-environment domain identity (`dev.oci.ai4h.net`, `int.oci.ai4h.net`, `oci.ai4h.net`). DocuSeal is the first sender; the OCI API will join later. Inbound mail addressed to `oci-act@<env>.oci.ai4h.net` is captured by SES and forwarded to the operator mailbox by a Lambda.

This runbook covers the parts CDK doesn't automate: SES production-access requests, activating the inbound receipt rule set, SMTP-credential rotation, DMARC tightening, troubleshooting bounces. Day-to-day, the stack is hands-off — DKIM rotates inside SES, the DMARC posture stays where you set it, and the SMTP creds only churn on explicit `RotationVersion` bumps.

The architecture rationale lives in [ADR-0004](../adr/0004-ses-mail-per-env-identity.md).

## Provisioning

```bash
pnpm --filter @oci/cdk exec cdk deploy oci-<env>-mail --context env=<env>
```

Provisions:

- `AWS::SES::EmailIdentity` for `<env>.oci.ai4h.net` with Easy-DKIM and a `bounce.<env>.oci.ai4h.net` mail-from subdomain.
- 3× DKIM CNAME records + SPF (`v=spf1 include:amazonses.com -all`) + DMARC (`p=none` to start) + MX record (SES inbound) on the `ai4h.net` hosted zone.
- IAM user `oci-<env>-ses-smtp` with `ses:SendRawEmail` + `ses:SendEmail` scoped to the identity.
- Lambda-backed CustomResource that creates an IAM access key, derives the SES SMTP password (HMAC-SHA256, version byte 0x04, base64), and writes `{host,port,username,password,iamAccessKeyId,iamSecretAccessKey}` JSON into Secrets Manager `OciDev/Int/Prod-SesSmtpCreds-*`.
- SSM parameter `/oci/<env>/mail/smtp-creds-secret-arn` so DocuSeal (and the API later) can import by name.
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

## Wire DocuSeal outbound to SES SMTP

DocuSeal sends signing invitation emails and completion notifications. By default it uses its built-in Postmark integration. The SES SMTP route is wired in via `--context mailEnabled=true` on the docuseal-stack deploy:

```bash
pnpm --filter @oci/cdk exec cdk deploy oci-<env>-docuseal \
  --context env=<env> \
  --context docusealEnabled=true \
  --context mailEnabled=true
```

This injects four Secrets Manager-backed env vars into the DocuSeal task (`SMTP_ADDRESS`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`) plus two plaintext vars (`SMTP_FROM_EMAIL=oci-act@<env>.oci.ai4h.net`, `SMTP_FROM_NAME=OCI Platform`).

After the service rolls out (~2 minutes), verify in the DocuSeal admin UI:

1. `Settings → Sending emails` — the host/port/username should match what's in the `OciDev…SesSmtpCreds*` Secrets Manager secret.
2. Set **From name** to `OCI Platform` and **From email** to `oci-act@<env>.oci.ai4h.net` if the admin UI overrides the env vars.
3. **Send test email** → confirm delivery to a verified address (sandbox) or any address (production).

In CI, `vars.MAIL_ENABLED` controls the flag (GitHub Actions repository variable, default `false`). Set it to `true` in Settings → Environments → dev after the above one-time steps are complete.

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

## Rotating SMTP credentials

The CustomResource that writes the secret keys its behaviour on a `RotationVersion` resource property (currently `'1'`). To rotate:

1. Edit `infra/cdk/lib/mail-stack.ts` and bump `RotationVersion` (e.g. `'1'` → `'2'`).
2. Open a PR; merge; the deploy pipeline applies it.
3. On `Update` the Lambda deletes the existing access key, creates a new one, and writes a new SMTP password into the same secret.
4. Force a new DocuSeal deployment so it picks up the new value:
   ```bash
   aws ecs update-service \
     --cluster oci-<env>-api \
     --service $(aws ecs list-services --cluster oci-<env>-api --region eu-central-1 --query 'serviceArns[?contains(@, `Docuseal`)]' --output text) \
     --force-new-deployment --region eu-central-1
   ```
5. Verify a fresh outbound mail (e.g. invite a test signer) lands without being bounced.

## When mail goes wrong

- **Hard bounces immediately on send**: check SES sandbox status (above). New identities outside the sandbox can still bounce on recipients with strict reputation policies — verify the receiving domain's MX / DMARC.
- **Mail goes to spam**: verify DKIM signing in the message headers (`Authentication-Results: ... dkim=pass`). If DKIM is failing, run `aws ses get-identity-dkim-attributes` and re-check the CNAMEs resolve.
- **DocuSeal silently doesn't send**: check the DocuSeal admin UI → Settings → Email Settings. The form here is plain SMTP — username/password/host/port. After the wire-up PR lands these will be populated automatically from the Secrets Manager secret; before then, the operator pastes them manually.
- **CFN deploy fails with `CredentialReportNotPresent`** or similar IAM error on the SMTP user: usually means a prior stack delete didn't clean up the access keys. Use `aws iam list-access-keys --user-name oci-<env>-ses-smtp` then `aws iam delete-access-key` to clear them, then re-deploy.

## When SES is unconfigured

If the SES stack hasn't been deployed yet, DocuSeal's Settings → Email Settings is just empty and the platform sends no mail — sign-in flows, access-request approvals, signing invites all degrade gracefully (DocuSeal returns the signer URL via the API, so signing still works without email). The CONTROLLED-tier signing flow is unaffected.
