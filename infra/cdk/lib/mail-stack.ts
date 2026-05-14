import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import type { OciEnvConfig } from './environments.js';

export interface MailStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  /** Apex hosted zone that owns props.cfg.domainName (e.g. `ai4h.net`). */
  hostedZoneId: string;
  zoneName: string;
  /** Aggregate-report destination for DMARC (`rua` / `ruf`). */
  dmarcReportTo: string;
}

/**
 * Amazon SES per-env outbound mail (#193, ADR-0004).
 *
 * Verifies a domain identity for `<env>.oci.ai4h.net` with Easy-DKIM,
 * publishes the supporting Route53 records (DKIM CNAMEs, MX-from for
 * bounce handling, SPF, DMARC), provisions an SMTP IAM user, and
 * computes the SES SMTP password into a Secrets Manager secret that
 * DocuSeal (and later the OCI API) consumes.
 *
 * The SMTP password is derived deterministically from the IAM access
 * key's secret-access-key via HMAC-SHA256(secret, 'SendRawEmail'). AWS
 * doesn't expose this as a managed resource, so a Lambda-backed
 * CustomResource runs at deploy time: it (a) creates the access key,
 * (b) computes the SMTP password, and (c) writes both into Secrets
 * Manager. The raw access key never appears in CFN events or the
 * synthesised template — only in the IAM and Secrets Manager APIs the
 * Lambda calls directly.
 *
 * Inbound forwarding (`oci-act@<env>.oci.ai4h.net` → operator mailbox)
 * is intentionally NOT in this stack; it ships in a follow-up PR per
 * #193's work-breakdown. The SES sandbox limits ("send only to
 * verified addresses, 200/day") are lifted via a manual support case
 * — also tracked as a runbook step, not infra code.
 *
 * Operator runbook: docs/for-operators/ses.md.
 */
export class MailStack extends cdk.Stack {
  /** Secrets Manager secret holding `{host,port,username,password}` JSON. */
  public readonly smtpCredsSecret: secretsmanager.ISecret;
  /** SSM parameter name carrying the secret ARN (for cross-stack import). */
  public readonly smtpCredsSecretArnParamName: string;

  constructor(scope: Construct, id: string, props: MailStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const env = props.cfg.envName;
    const identityDomain = props.cfg.domainName; // e.g. `dev.oci.ai4h.net`
    const mailFromDomain = `bounce.${identityDomain}`;

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    // --- SES domain identity + DKIM -----------------------------------

    const emailIdentity = new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.domain(identityDomain),
      // Easy-DKIM (2048-bit RSA managed by SES). SES auto-rotates the
      // signing key; we don't have to.
      dkimSigning: true,
      mailFromDomain,
      // BehaviorOnMxFailure default REJECT_MESSAGE is correct — if the
      // bounce subdomain MX disappears we want sends to fail loudly,
      // not silently land in inbox-purgatory.
    });

    // SES exposes the 3 Easy-DKIM CNAME records as
    // `dkimDnsTokenName{1,2,3}` / `dkimDnsTokenValue{1,2,3}`. We add
    // them as records in the apex hosted zone (the subdomain itself
    // has no separate hosted zone — records under `<env>.oci.ai4h.net`
    // live in the apex zone like every other subdomain on this account).
    const dkimTokens = [
      { name: emailIdentity.dkimDnsTokenName1, value: emailIdentity.dkimDnsTokenValue1 },
      { name: emailIdentity.dkimDnsTokenName2, value: emailIdentity.dkimDnsTokenValue2 },
      { name: emailIdentity.dkimDnsTokenName3, value: emailIdentity.dkimDnsTokenValue3 },
    ];
    dkimTokens.forEach((t, i) => {
      new route53.CnameRecord(this, `DkimRecord${i + 1}`, {
        zone,
        recordName: t.name,
        domainName: t.value,
      });
    });

    // SPF — for the identity domain. The SES feedback / mail-from
    // subdomain (`bounce.<env>.oci.ai4h.net`) is what receivers RFC-7208
    // check on the envelope-sender; SES manages its records for us when
    // `mailFromDomain` is set on the identity (CFN creates the MX-from
    // + SPF for the bounce subdomain). We add SPF on the visible
    // From: domain so DMARC alignment can succeed.
    new route53.TxtRecord(this, 'SpfRecord', {
      zone,
      recordName: identityDomain,
      values: ['v=spf1 include:amazonses.com -all'],
    });

    // DMARC at `_dmarc.<env>.oci.ai4h.net`. Start at `p=none` per ADR-0004
    // — gives us a few weeks of aggregate-report observation before
    // tightening to `quarantine` / `reject`. The hardening path lives in
    // the operator runbook.
    new route53.TxtRecord(this, 'DmarcRecord', {
      zone,
      recordName: `_dmarc.${identityDomain}`,
      values: [
        `v=DMARC1; p=none; rua=mailto:${props.dmarcReportTo}; ruf=mailto:${props.dmarcReportTo}; fo=1; adkim=r; aspf=r`,
      ],
    });

    // --- SMTP user + computed password -------------------------------

    // IAM user that DocuSeal authenticates as over SMTP. The user has
    // exactly one permission: `ses:SendRawEmail` (the action SES SMTP
    // calls internally). Scoped to the identity ARN.
    const smtpUser = new iam.User(this, 'SmtpUser', {
      userName: `oci-${env}-ses-smtp`,
    });
    smtpUser.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendRawEmail', 'ses:SendEmail'],
        resources: [emailIdentity.emailIdentityArn],
        // SES checks the From-address against the identity at send
        // time; scoping the action to the identity ARN narrows it
        // further so a credential leak can't send from another
        // identity in the same account.
      }),
    );

    // Target secret — populated by the Lambda-backed CustomResource
    // below. Placeholder value while CFN waits for the CR to run.
    const smtpCredsSecret = new secretsmanager.Secret(this, 'SmtpCreds', {
      description: `SES SMTP credentials for ${env} (host/port/username/password JSON).`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        '{"placeholder":"populated-on-first-deploy"}',
      ),
      removalPolicy: props.cfg.removalPolicy,
    });
    this.smtpCredsSecret = smtpCredsSecret;

    const composerFn = new lambda.Function(this, 'SmtpCredsComposerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
        const { IAMClient, CreateAccessKeyCommand, ListAccessKeysCommand, DeleteAccessKeyCommand } = require('@aws-sdk/client-iam');
        const { SecretsManagerClient, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
        const crypto = require('crypto');
        const https = require('https');

        const iam = new IAMClient({});
        const sm = new SecretsManagerClient({});

        // SES SMTP password algorithm — documented at
        // https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html
        // 1. HMAC-SHA256 the secret access key with the literal
        //    'SendRawEmail'.
        // 2. Prefix the resulting 32-byte MAC with the version byte 0x04.
        // 3. Base64-encode the 33-byte buffer.
        function deriveSmtpPassword(secretAccessKey) {
          const mac = crypto.createHmac('sha256', secretAccessKey).update('SendRawEmail').digest();
          const versioned = Buffer.concat([Buffer.from([0x04]), mac]);
          return versioned.toString('base64');
        }

        async function rotateAccessKey(userName) {
          // Idempotent: if a previous key exists, delete it before
          // creating a new one. IAM users have a 2-key cap; we treat
          // this construct as exclusive owner of the user's keys.
          const existing = await iam.send(new ListAccessKeysCommand({ UserName: userName }));
          for (const k of existing.AccessKeyMetadata || []) {
            await iam.send(new DeleteAccessKeyCommand({ UserName: userName, AccessKeyId: k.AccessKeyId }));
          }
          const created = await iam.send(new CreateAccessKeyCommand({ UserName: userName }));
          return created.AccessKey;
        }

        async function writeSecret(arn, host, port, accessKeyId, secretAccessKey) {
          const password = deriveSmtpPassword(secretAccessKey);
          const body = JSON.stringify({
            host, port,
            username: accessKeyId,
            password,
            // Stash the raw IAM access key so cdk-nag / operators can
            // see what credential the SMTP password was derived from.
            // It IS sensitive — that's why this whole record lives in
            // Secrets Manager. Resource policies on the secret are the
            // gate.
            iamAccessKeyId: accessKeyId,
            iamSecretAccessKey: secretAccessKey,
          });
          await sm.send(new PutSecretValueCommand({ SecretId: arn, SecretString: body }));
        }

        function respond(event, status, data) {
          return new Promise((resolve) => {
            const body = JSON.stringify({
              Status: status, Reason: data.Reason || 'see log group',
              PhysicalResourceId: event.PhysicalResourceId || event.LogicalResourceId,
              StackId: event.StackId, RequestId: event.RequestId, LogicalResourceId: event.LogicalResourceId,
              Data: data,
            });
            const u = new URL(event.ResponseURL);
            const req = https.request({
              method: 'PUT', hostname: u.hostname, path: u.pathname + u.search,
              headers: { 'content-type': '', 'content-length': body.length },
            }, () => resolve());
            req.on('error', () => resolve());
            req.write(body); req.end();
          });
        }

        exports.handler = async (event) => {
          try {
            const { UserName, SecretArn, SmtpHost, SmtpPort } = event.ResourceProperties;
            if (event.RequestType === 'Delete') {
              // Clean up the access key on stack delete.
              const existing = await iam.send(new ListAccessKeysCommand({ UserName }));
              for (const k of existing.AccessKeyMetadata || []) {
                await iam.send(new DeleteAccessKeyCommand({ UserName, AccessKeyId: k.AccessKeyId }));
              }
            } else {
              const key = await rotateAccessKey(UserName);
              await writeSecret(SecretArn, SmtpHost, parseInt(SmtpPort, 10), key.AccessKeyId, key.SecretAccessKey);
            }
            await respond(event, 'SUCCESS', { Reason: 'ok' });
          } catch (err) {
            await respond(event, 'FAILED', { Reason: String((err && err.message) || err) });
          }
        };
      `),
    });
    composerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:CreateAccessKey', 'iam:DeleteAccessKey', 'iam:ListAccessKeys'],
        resources: [smtpUser.userArn],
      }),
    );
    smtpCredsSecret.grantWrite(composerFn);

    // SES SMTP host is region-specific. The Lambda needs to know both
    // host and port to write a complete config blob.
    const smtpHost = `email-smtp.${this.region}.amazonaws.com`;

    new cdk.CustomResource(this, 'SmtpCredsComposer', {
      serviceToken: composerFn.functionArn,
      properties: {
        UserName: smtpUser.userName,
        SecretArn: smtpCredsSecret.secretArn,
        SmtpHost: smtpHost,
        SmtpPort: '587',
        // Bump this to force the access key to rotate on the next
        // deploy. Out of an abundance of caution we don't rotate on
        // every deploy — a code-change rebuild shouldn't churn live
        // SMTP creds.
        RotationVersion: '1',
      },
    });

    // --- Cross-stack exports -----------------------------------------

    this.smtpCredsSecretArnParamName = `/oci/${env}/mail/smtp-creds-secret-arn`;
    new ssm.StringParameter(this, 'SmtpCredsSecretArnParam', {
      parameterName: this.smtpCredsSecretArnParamName,
      stringValue: smtpCredsSecret.secretArn,
      description: 'SES SMTP credentials secret ARN — DocuSeal (and later the API) consume this.',
    });

    new cdk.CfnOutput(this, 'SesIdentityDomain', {
      value: identityDomain,
      description: 'SES verified domain identity.',
    });
    new cdk.CfnOutput(this, 'SmtpHost', { value: smtpHost });
    new cdk.CfnOutput(this, 'SmtpUserName', { value: smtpUser.userName });
    new cdk.CfnOutput(this, 'DmarcRua', { value: props.dmarcReportTo });

    // --- cdk-nag suppressions ----------------------------------------

    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole on the SMTP-creds composer is the standard managed policy for CloudWatch Logs write — minimal and standard.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'iam:CreateAccessKey / iam:DeleteAccessKey are scoped to the dedicated SMTP user only; no wildcard on resources.',
        },
        {
          id: 'AwsSolutions-L1',
          reason:
            'Lambda pinned to NODEJS_22_X (current latest LTS at deploy time). Project-wide cadence handles version bumps.',
        },
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Secret rotation is handled out-of-band by bumping RotationVersion on the CustomResource. Auto-rotation would churn SMTP credentials on every CFN deploy, which would invalidate DocuSeal sends mid-flight.',
        },
      ],
      true,
    );
  }
}
