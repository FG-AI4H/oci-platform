import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
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
  /**
   * Email address to forward inbound `oci-act@<env>.oci.ai4h.net` mail to.
   * SES sandbox: this address must be verified via
   *   aws sesv2 create-email-identity --email-identity <addr> --region eu-central-1
   * before forwarding will succeed. In production (post-sandbox) any address works.
   */
  inboundForwardTo: string;
}

/**
 * Amazon SES per-env outbound mail (#193, ADR-0004).
 *
 * Verifies a domain identity for `<env>.oci.ai4h.net` with Easy-DKIM,
 * publishes the supporting Route53 records (DKIM CNAMEs, MX for inbound,
 * SPF, DMARC), and wires an inbound-forwarder (S3 + Lambda + receipt rule
 * set) that delivers mail addressed to `oci-act@<env>.oci.ai4h.net` to
 * props.inboundForwardTo.
 *
 * SMTP credentials for outbound DocuSeal mail are NOT managed by CDK:
 * the AWS organisation SCP blocks `iam:CreateUser` for all principals in
 * this account, including the CFN execution role and the
 * AdministratorAccessRole. Outbound DocuSeal email currently uses DocuSeal's
 * built-in Postmark integration. A follow-up PR will revisit SMTP once
 * the SCP constraint is resolved or an alternative path (e.g. SES API via
 * task role, or a dedicated SMTP relay using IAM roles) is available.
 *
 * Operator runbook: docs/for-operators/ses.md.
 */
export class MailStack extends cdk.Stack {
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
    });

    // SES exposes the 3 Easy-DKIM CNAME records as
    // `dkimDnsTokenName{1,2,3}` / `dkimDnsTokenValue{1,2,3}`. We add
    // them as records in the apex hosted zone.
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

    new route53.TxtRecord(this, 'SpfRecord', {
      zone,
      recordName: identityDomain,
      values: ['v=spf1 include:amazonses.com -all'],
    });

    new route53.TxtRecord(this, 'DmarcRecord', {
      zone,
      recordName: `_dmarc.${identityDomain}`,
      values: [
        `v=DMARC1; p=none; rua=mailto:${props.dmarcReportTo}; ruf=mailto:${props.dmarcReportTo}; fo=1; adkim=r; aspf=r`,
      ],
    });

    // --- Inbound: MX + S3 + forwarder Lambda + receipt rule set ------
    //
    // Receives mail at @identityDomain, stores raw RFC 2822 in S3, then
    // a Lambda rewrites the envelope headers and re-sends via SES to
    // props.inboundForwardTo.
    //
    // Two manual operator steps after first deploy:
    //   1. Activate the rule set (singleton per region/account):
    //        aws ses set-active-receipt-rule-set \
    //          --rule-set-name oci-<env>-inbound --region eu-central-1
    //   2. (sandbox only) Verify the forward-to address so SES allows sends:
    //        aws sesv2 create-email-identity \
    //          --email-identity <inboundForwardTo> --region eu-central-1
    //      Then click the verification link in the email.
    // See docs/for-operators/ses.md § Inbound forwarder.

    new route53.MxRecord(this, 'InboundMxRecord', {
      zone,
      recordName: identityDomain,
      values: [{ priority: 10, hostName: `inbound-smtp.${this.region}.amazonaws.com` }],
    });

    const inboundBucket = new s3.Bucket(this, 'InboundBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: props.cfg.removalPolicy,
      autoDeleteObjects: props.cfg.removalPolicy === cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
    });

    inboundBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSesDelivery',
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [`${inboundBucket.bucketArn}/inbound/*`],
        conditions: { StringEquals: { 'aws:Referer': this.account } },
      }),
    );

    // Forwarder: reads raw email from S3, rewrites From/To/Subject/Reply-To,
    // re-sends via SES. Uses commonHeaders from the SES event to extract
    // original sender and subject without complex MIME parsing.
    const forwarderFn = new lambda.Function(this, 'InboundForwarderFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        BUCKET_NAME: inboundBucket.bucketName,
        FROM_ADDRESS: `oci-act@${identityDomain}`,
        FORWARD_TO: props.inboundForwardTo,
      },
      code: lambda.Code.fromInline(`
        const{S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
        const{SESClient,SendRawEmailCommand}=require('@aws-sdk/client-ses');
        const s3c=new S3Client({});const sec=new SESClient({});
        async function buf(s){const c=[];for await(const k of s)c.push(Buffer.isBuffer(k)?k:Buffer.from(k));return Buffer.concat(c);}
        exports.handler=async(ev)=>{
          for(const r of ev.Records||[]){
            const m=r.ses&&r.ses.mail;if(!m)continue;
            const obj=await s3c.send(new GetObjectCommand({Bucket:process.env.BUCKET_NAME,Key:'inbound/'+m.messageId}));
            const raw=(await buf(obj.Body)).toString('utf8');
            const fr=((m.commonHeaders&&m.commonHeaders.from)||[])[0]||m.source||'';
            const sub=(m.commonHeaders&&m.commonHeaders.subject)||'(no subject)';
            const fa=process.env.FROM_ADDRESS;const ft=process.env.FORWARD_TO;
            const si=raw.search(/\\r?\\n\\r?\\n/);
            if(si<0){console.error('No sep',m.messageId);continue;}
            const hdr=raw.slice(0,si);const bdy=raw.slice(si);
            const nl=[];let skip=false;
            for(const ln of hdr.split(/\\r?\\n/)){
              const lo=ln.toLowerCase();const isc=/^[ \\t]/.test(ln);
              if(isc){if(!skip)nl.push(ln);continue;}
              skip=false;
              if(lo.startsWith('from:')){nl.push('From: OCI Platform <'+fa+'>');nl.push('Reply-To: '+fr);skip=true;}
              else if(lo.startsWith('to:')){nl.push('To: '+ft);skip=true;}
              else if(lo.startsWith('reply-to:')||lo.startsWith('bcc:')||lo.startsWith('cc:')){skip=true;}
              else if(lo.startsWith('subject:')){nl.push('Subject: '+(sub.startsWith('[Fwd]')?sub:'[Fwd] '+sub));skip=true;}
              else nl.push(ln);
            }
            const email=nl.join('\\r\\n')+bdy;
            await sec.send(new SendRawEmailCommand({Source:fa,Destinations:[ft],RawMessage:{Data:Buffer.from(email)}}));
            console.log('Forwarded',m.messageId,'to',ft);
          }
          return{status:'ok'};
        };
      `),
    });

    inboundBucket.grantRead(forwarderFn);
    forwarderFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendRawEmail'],
        resources: [emailIdentity.emailIdentityArn],
      }),
    );

    // SES invokes the Lambda async on each receipt-rule match.
    // sesActions.Lambda adds the resource-based policy automatically.
    const inboundRuleSet = new ses.ReceiptRuleSet(this, 'InboundRuleSet', {
      receiptRuleSetName: `oci-${env}-inbound`,
    });
    inboundRuleSet.addRule('ForwardRule', {
      recipients: [identityDomain],
      scanEnabled: true,
      tlsPolicy: ses.TlsPolicy.REQUIRE,
      actions: [
        new sesActions.S3({ bucket: inboundBucket, objectKeyPrefix: 'inbound/' }),
        new sesActions.Lambda({
          function: forwarderFn,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
    });

    // --- Outputs ---------------------------------------------------------

    new cdk.CfnOutput(this, 'SesIdentityDomain', {
      value: identityDomain,
      description: 'SES verified domain identity.',
    });
    new cdk.CfnOutput(this, 'DmarcRua', { value: props.dmarcReportTo });
    new cdk.CfnOutput(this, 'InboundRuleSetName', {
      value: `oci-${env}-inbound`,
      description:
        'SES receipt rule set — operator must activate: aws ses set-active-receipt-rule-set --rule-set-name oci-<env>-inbound',
    });

    // --- cdk-nag suppressions ----------------------------------------

    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole on the inbound-forwarder is the standard managed policy for CloudWatch Logs write — minimal and standard.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'ses:SendRawEmail is scoped to the identity ARN; no wildcard on resources.',
        },
        {
          id: 'AwsSolutions-L1',
          reason:
            'Lambda pinned to NODEJS_22_X (current latest LTS at deploy time). Project-wide cadence handles version bumps.',
        },
        {
          id: 'AwsSolutions-S1',
          reason:
            'Inbound email bucket is not internet-accessible (SES write + Lambda read only). Server-access logging adds cost for no security benefit at this traffic volume.',
        },
        {
          id: 'AwsSolutions-S10',
          reason:
            'SES delivery requires PutObject without enforced TLS at the bucket-policy level (SES uses its own transport security). The bucket is not publicly accessible.',
        },
      ],
      true,
    );
  }
}
