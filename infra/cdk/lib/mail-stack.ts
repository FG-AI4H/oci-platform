import * as cdk from 'aws-cdk-lib';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
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
  /** Existing VPC from network-stack — the SMTP relay runs inside it. */
  vpc: ec2.IVpc;
  /** Existing ECS cluster from api-stack — the SMTP relay shares it. */
  cluster: ecs.ICluster;
  /** Shared CloudWatch log group for relay container logs. */
  logGroup: logs.ILogGroup;
  /**
   * Container image URI for the SMTP relay (`apps/smtp-relay`). Built and
   * pushed by the Deploy workflow. Undefined locally — synth falls back
   * to a public placeholder so `cdk synth` works without auth.
   */
  smtpRelayImage?: string;
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
 * Outbound mail from DocuSeal (and future SES senders) goes through a
 * small SMTP-to-SES relay (Fargate, ADR-0005) that ships in this stack.
 * The org SCP `p-onj7rgr2` denies `iam:CreateUser`, so SES SMTP via an
 * IAM user is not deployable. The relay calls `ses:SendRawEmail` via
 * its task IAM role and is reachable only inside the VPC.
 *
 * Operator runbook: docs/for-operators/ses.md.
 */
export class MailStack extends cdk.Stack {
  /** Security group of the SMTP relay ENI — DocuSeal opens egress to this. */
  public readonly relaySecurityGroup: ec2.ISecurityGroup;
  /** Cloud Map endpoint DocuSeal uses for SMTP_ADDRESS (e.g. `smtp-relay.oci-dev.internal`). */
  public readonly relayEndpointHost: string;
  /** TCP port the relay listens on (2525 — unprivileged so the container runs as nonroot). */
  public readonly relayEndpointPort: number;
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
    // `dkimDnsTokenName{1,2,3}` / `dkimDnsTokenValue{1,2,3}`. SES returns
    // these as FQDNs (e.g. `{token}._domainkey.dev.oci.ai4h.net`), but
    // because they are CFN tokens (unresolved at synth time) CDK's
    // route53 FQDN-detection can't see that they already end with the
    // zone name. We strip the `.{zoneName}` suffix at deploy time so
    // CDK appends it back correctly.
    const dkimTokens = [
      { name: emailIdentity.dkimDnsTokenName1, value: emailIdentity.dkimDnsTokenValue1 },
      { name: emailIdentity.dkimDnsTokenName2, value: emailIdentity.dkimDnsTokenValue2 },
      { name: emailIdentity.dkimDnsTokenName3, value: emailIdentity.dkimDnsTokenValue3 },
    ];
    dkimTokens.forEach((t, i) => {
      new route53.CnameRecord(this, `DkimRecord${i + 1}`, {
        zone,
        recordName: cdk.Fn.select(0, cdk.Fn.split(`.${props.zoneName}`, t.name)),
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

    // Mail-from subdomain (`bounce.<identity>`) DNS records — SES requires
    // an MX pointing at the regional feedback endpoint plus an SPF TXT
    // record so bounce/complaint mail can be delivered back to SES.
    // Without these the mail-from domain stays in `Pending` and outbound
    // sends use the default `amazonses.com` envelope-from instead of
    // `bounce.<identity>`, which weakens DMARC alignment.
    new route53.MxRecord(this, 'MailFromMxRecord', {
      zone,
      recordName: mailFromDomain,
      values: [{ priority: 10, hostName: `feedback-smtp.${this.region}.amazonses.com` }],
    });
    new route53.TxtRecord(this, 'MailFromSpfRecord', {
      zone,
      recordName: mailFromDomain,
      values: ['v=spf1 include:amazonses.com -all'],
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
    const forwarderLogGroup = new logs.LogGroup(this, 'InboundForwarderLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.cfg.removalPolicy,
    });
    const forwarderFn = new lambda.Function(this, 'InboundForwarderFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      logGroup: forwarderLogGroup,
      environment: {
        BUCKET_NAME: inboundBucket.bucketName,
        FROM_ADDRESS: `oci-act@${identityDomain}`,
        FORWARD_TO: props.inboundForwardTo,
      },
      code: lambda.Code.fromInline(`
        const{S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
        const{SESClient,SendRawEmailCommand}=require('@aws-sdk/client-ses');
        const s3c=new S3Client({});const sec=new SESClient({});
        // Transit headers that SES regenerates on SendRawEmail. Keeping
        // any of these on the re-sent message causes SES to reject with
        // "Duplicate header" (most commonly DKIM-Signature).
        const STRIP=new Set(['dkim-signature','received','return-path','received-spf','authentication-results','arc-seal','arc-message-signature','arc-authentication-results','message-id','feedback-id'].concat(['x-ses-spam-verdict','x-ses-virus-verdict','x-ses-receipt','x-ses-dkim-signature','x-ses-outgoing']));
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
              const isc=/^[ \\t]/.test(ln);
              if(isc){if(!skip)nl.push(ln);continue;}
              const colon=ln.indexOf(':');
              const name=colon>0?ln.slice(0,colon).toLowerCase():'';
              skip=false;
              if(name==='from'){nl.push('From: OCI Platform <'+fa+'>');nl.push('Reply-To: '+fr);skip=true;}
              else if(name==='to'){nl.push('To: '+ft);skip=true;}
              else if(name==='reply-to'||name==='bcc'||name==='cc'){skip=true;}
              else if(name==='subject'){nl.push('Subject: '+(sub.startsWith('[Fwd]')?sub:'[Fwd] '+sub));skip=true;}
              else if(STRIP.has(name)){skip=true;}
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

    // --- Outbound SMTP-to-SES relay (ADR-0005) ----------------------------
    //
    // The org SCP `p-onj7rgr2` denies iam:CreateUser, so SES SMTP via an
    // IAM user is not deployable. Instead, a tiny Fargate service
    // (`apps/smtp-relay`) accepts SMTP from DocuSeal inside the VPC and
    // calls `ses:SendRawEmail` via its task IAM role. DocuSeal connects
    // through a Cloud Map private DNS name and never carries SMTP
    // credentials.

    const relayPort = 2525;
    const relayServiceName = 'smtp-relay';
    const relayNamespaceName = `oci-${env}.internal`;

    const relayNamespace = new cloudmap.PrivateDnsNamespace(this, 'RelayNamespace', {
      name: relayNamespaceName,
      vpc: props.vpc,
      description: `Private DNS for OCI ${env} internal services (SMTP relay, future intra-VPC).`,
    });

    const relaySg = new ec2.SecurityGroup(this, 'RelaySg', {
      vpc: props.vpc,
      description: 'OCI SMTP-to-SES relay ENI',
      allowAllOutbound: true,
    });

    const relayTaskDef = new ecs.FargateTaskDefinition(this, 'RelayTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    relayTaskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SesSendRawEmail',
        actions: ['ses:SendRawEmail'],
        resources: [emailIdentity.emailIdentityArn],
      }),
    );

    // Local fallback so `cdk synth` works offline. CI passes the real
    // SHA-tagged URI via context (see deploy.yml). Matches the same
    // pattern as api/web/worker-ingest.
    const relayImage = props.smtpRelayImage
      ? ecs.ContainerImage.fromRegistry(props.smtpRelayImage)
      : ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/alpine:3.20');

    relayTaskDef.addContainer('smtp-relay', {
      image: relayImage,
      environment: {
        PORT: String(relayPort),
        AWS_REGION: this.region,
        LOG_LEVEL: env === 'prod' ? 'info' : 'debug',
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'smtp-relay', logGroup: props.logGroup }),
      portMappings: [{ containerPort: relayPort, protocol: ecs.Protocol.TCP }],
    });

    // dev: single task (acceptable downtime during task replacement);
    // int/prod: HA pair across AZs.
    const desiredRelayCount = env === 'dev' ? 1 : 2;

    const relayService = new ecs.FargateService(this, 'RelayService', {
      cluster: props.cluster,
      taskDefinition: relayTaskDef,
      desiredCount: desiredRelayCount,
      assignPublicIp: false,
      securityGroups: [relaySg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: env === 'dev' ? 0 : 100,
      maxHealthyPercent: 200,
      cloudMapOptions: {
        cloudMapNamespace: relayNamespace,
        name: relayServiceName,
        dnsRecordType: cloudmap.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(15),
        // Cloud Map only marks the instance healthy once the task
        // reports steady state; no separate health-check needed.
      },
    });
    // Suppress unused warning while keeping a handle for future
    // CloudWatch alarms on RunningCount / desiredCount drift.
    void relayService;

    // Cross-stack handles for docuseal-stack (SG ingress, env vars).
    this.relaySecurityGroup = relaySg;
    this.relayEndpointHost = `${relayServiceName}.${relayNamespaceName}`;
    this.relayEndpointPort = relayPort;

    new cdk.CfnOutput(this, 'SmtpRelayEndpoint', {
      value: `${relayServiceName}.${relayNamespaceName}:${relayPort}`,
      description: 'Cloud Map service discovery endpoint for the SMTP-to-SES relay.',
    });
    new cdk.CfnOutput(this, 'SmtpRelaySecurityGroupId', {
      value: relaySg.securityGroupId,
      description:
        'Security-group ID of the relay ENI — DocuSeal SG egress is opened to this in docuseal-stack.',
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
