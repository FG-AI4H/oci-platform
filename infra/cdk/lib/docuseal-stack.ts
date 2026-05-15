import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface DocusealStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  vpc: ec2.IVpc;
  /** Existing ECS cluster from the API stack — DocuSeal shares it. */
  cluster: ecs.ICluster;
  /** Existing ALB from the API stack — DocuSeal adds a host-based listener rule + alias record. */
  alb: elbv2.IApplicationLoadBalancer;
  /** Existing ALB HTTPS listener from the API stack — DocuSeal adds a routing rule + extra cert. */
  httpsListener: elbv2.IApplicationListener;
  /** Aurora cluster — DocuSeal gets its own logical DB (`oci_docuseal`). */
  database: rds.DatabaseCluster;
  /** Shared CloudWatch log group for the DocuSeal container. */
  logGroup: logs.ILogGroup;
  /** Route53 hosted zone that owns props.cfg.domainName — used for DNS validation + alias record. */
  hostedZoneId: string;
  /** Hosted zone name (e.g. `dev.oci.ai4h.net`). */
  zoneName: string;
  /** Cloud Map private DNS host for the SMTP-to-SES relay (ADR-0005). */
  smtpRelayHost: string;
  /** TCP port the SMTP-to-SES relay listens on. */
  smtpRelayPort: number;
  /** SG of the SMTP-to-SES relay ENI — DocuSeal SG egress is opened to this. */
  smtpRelaySecurityGroup: ec2.ISecurityGroup;
  /** Plaintext From: address DocuSeal uses for outbound signing mail. */
  smtpFromEmail: string;
}

/**
 * Self-hosted DocuSeal on ECS Fargate (#128, ADR-0003 Decision 5).
 *
 * Shape:
 *   - One Fargate task running the official `docuseal/docuseal` container.
 *   - EFS volume mounted at `/data/docuseal` for blob storage (signed
 *     PDFs, uploaded templates, internal Rails cache). EFS so the same
 *     volume survives task restarts + AZ flips.
 *   - Postgres backing store on the existing Aurora cluster — a separate
 *     logical database (`oci_docuseal`) on the same instance. DocuSeal
 *     manages its own schema migrations; the API never reaches into it.
 *   - Host-based ALB routing: a Route53 alias record points
 *     `docuseal.<env>.oci.ai4h.net` at the shared ALB, and a host-header
 *     listener rule on the API's HTTPS listener forwards that vhost to
 *     the DocuSeal target group. DocuSeal's Rails app mounts all routes
 *     at the host root (`/up`, `/admin`, `/api/...`, `/s/<token>`) — it
 *     has no `relative_url_root` support, so a path prefix like
 *     `/docuseal/*` returns 404. The admin UI is therefore at
 *     `https://docuseal.<env>.oci.ai4h.net/admin`; the signer URL the
 *     API hands the requester is
 *     `https://docuseal.<env>.oci.ai4h.net/s/<token>`.
 *   - Three secrets in Secrets Manager:
 *       - `SECRET_KEY_BASE` — Rails cookie/session key, auto-generated.
 *       - `OCI_DOCUSEAL_API_TOKEN` — auto-generated stub. The operator
 *         post-boot generates a real token in the DocuSeal admin UI and
 *         updates this secret value. The API task reads it on next
 *         deploy + reboot.
 *       - `OCI_DOCUSEAL_WEBHOOK_SECRET` — auto-generated HMAC secret.
 *         The operator pastes this into DocuSeal's Webhooks settings.
 *   - SSM parameter `OCI_DOCUSEAL_BASE_URL` set to the public ALB URL.
 *     api-stack reads it as a plain env var so a re-deploy isn't
 *     needed when the parameter is rotated.
 *
 * Operator runbook lives at `docs/for-operators/docuseal.md`.
 */
export class DocusealStack extends cdk.Stack {
  public readonly apiTokenSecret: secretsmanager.ISecret;
  public readonly webhookSecret: secretsmanager.ISecret;
  /** Parameter name for the DocuSeal base URL. api-stack imports by name. */
  public readonly baseUrlParamName: string;

  constructor(scope: Construct, id: string, props: DocusealStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const env = props.cfg.envName;
    const docusealHost = `docuseal.${props.cfg.domainName}`;

    // First-time deploy chicken-and-egg: the DocuSeal Rails container
    // needs the `oci_docuseal` database to exist on Aurora, which is
    // created by the one-shot DB-bootstrap task (defined later in this
    // stack). On a greenfield, the operator deploys this stack first,
    // then runs the bootstrap task, then scales the service. Until the
    // operator confirms the bootstrap has happened, we keep
    // desiredCount=0 so CFN doesn't wait for a service that can't reach
    // steady state.
    //
    // Operator deploy order:
    //   1. cdk deploy oci-<env>-docuseal --context env=<env>
    //   2. aws ecs run-task --cli-input-json "$(...db-bootstrap-launch-spec...)"
    //   3. cdk deploy oci-<env>-docuseal --context env=<env> --context docusealEnabled=true
    //
    // Step 3 lifts desiredCount to 1; the service now starts cleanly
    // because the database exists. Subsequent deploys keep
    // docusealEnabled=true.
    const docusealEnabled =
      this.node.tryGetContext('docusealEnabled') === true ||
      this.node.tryGetContext('docusealEnabled') === 'true';

    // --- Secrets -------------------------------------------------------

    const secretKeyBase = new secretsmanager.Secret(this, 'DocusealSecretKeyBase', {
      description: `DocuSeal SECRET_KEY_BASE for ${env} — Rails cookie/session signing key.`,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: props.cfg.removalPolicy,
    });

    // Auto-generated stub — the operator replaces the value in the
    // DocuSeal admin UI ("Settings → API → generate token") and writes
    // the real token back to this secret. CDK never reads the value;
    // the API task picks it up via `ecs.Secret.fromSecretsManager` and
    // re-reads on each new task deployment.
    this.apiTokenSecret = new secretsmanager.Secret(this, 'DocusealApiToken', {
      description: `DocuSeal API token (OCI_DOCUSEAL_API_TOKEN) for ${env}. Operator-managed — rotate via the DocuSeal admin UI.`,
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: props.cfg.removalPolicy,
    });

    this.webhookSecret = new secretsmanager.Secret(this, 'DocusealWebhookSecret', {
      description: `DocuSeal webhook HMAC secret (OCI_DOCUSEAL_WEBHOOK_SECRET) for ${env}. Paste this same value into DocuSeal's Webhooks settings.`,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: props.cfg.removalPolicy,
    });

    // Composed DATABASE_URL secret — the official DocuSeal image
    // expects a single `DATABASE_URL` env var (per their
    // docker-compose.yml). The Aurora-managed secret carries
    // discrete fields (username/password/host/port); ECS can extract
    // individual fields via ecs.Secret.fromSecretsManager but cannot
    // compose them into one env var. We use a small Lambda-backed
    // CustomResource that runs at deploy time to read the Aurora
    // secret, compose the postgresql:// URL with the `oci_docuseal`
    // logical DB, and put it into a dedicated secret. The DocuSeal
    // task references that single secret with no command/entrypoint
    // override — exactly the shape the upstream image is designed
    // for.
    const databaseUrlSecret = new secretsmanager.Secret(this, 'DocusealDatabaseUrl', {
      description: `DocuSeal DATABASE_URL for ${env}. Auto-composed from the Aurora secret by a Lambda at deploy time.`,
      secretStringValue: cdk.SecretValue.unsafePlainText('placeholder-overwritten-on-first-deploy'),
      removalPolicy: props.cfg.removalPolicy,
    });

    const composerLogGroup = new logs.LogGroup(this, 'DocusealDatabaseUrlComposerLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.cfg.removalPolicy,
    });
    const composerFn = new lambda.Function(this, 'DocusealDatabaseUrlComposerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      logGroup: composerLogGroup,
      code: lambda.Code.fromInline(`
        const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
        const https = require('https');
        const sm = new SecretsManagerClient({});
        async function compose(sourceArn, targetArn, dbName) {
          const src = await sm.send(new GetSecretValueCommand({ SecretId: sourceArn }));
          const j = JSON.parse(src.SecretString);
          const url = 'postgresql://' + encodeURIComponent(j.username) + ':' + encodeURIComponent(j.password) +
                      '@' + j.host + ':' + j.port + '/' + dbName;
          await sm.send(new PutSecretValueCommand({ SecretId: targetArn, SecretString: url }));
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
            if (event.RequestType !== 'Delete') {
              await compose(event.ResourceProperties.SourceArn, event.ResourceProperties.TargetArn, event.ResourceProperties.DbName);
            }
            await respond(event, 'SUCCESS', { Reason: 'composed' });
          } catch (err) {
            await respond(event, 'FAILED', { Reason: String(err && err.message || err) });
          }
        };
      `),
    });
    props.database.secret!.grantRead(composerFn);
    databaseUrlSecret.grantWrite(composerFn);

    new cdk.CustomResource(this, 'DocusealDatabaseUrlComposer', {
      serviceToken: composerFn.functionArn,
      properties: {
        // Bumping any of these forces the CR to fire on the next
        // deploy. Aurora secret ARN can change on cluster replacement;
        // the target secret ARN is stable; the DbName is constant.
        // We also include a deploy-time nonce so password rotations
        // are picked up — bump to re-run.
        SourceArn: props.database.secret!.secretArn,
        TargetArn: databaseUrlSecret.secretArn,
        DbName: 'oci_docuseal',
        Version: '1',
      },
    });

    const fileSystem = new efs.FileSystem(this, 'DocusealEfs', {
      vpc: props.vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      encrypted: true,
      removalPolicy: props.cfg.removalPolicy,
    });
    const accessPoint = new efs.AccessPoint(this, 'DocusealEfsAccessPoint', {
      fileSystem,
      path: '/docuseal',
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '0750',
      },
      posixUser: { uid: '1000', gid: '1000' },
    });

    // --- Task definition ----------------------------------------------

    const taskDef = new ecs.FargateTaskDefinition(this, 'DocusealTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        // x86_64 — DocuSeal's official image isn't multi-arch as of
        // 2026-05. Revisit when they ship arm64. Cost difference is
        // small for a single low-traffic task.
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      volumes: [
        {
          name: 'docuseal-data',
          efsVolumeConfiguration: {
            fileSystemId: fileSystem.fileSystemId,
            transitEncryption: 'ENABLED',
            authorizationConfig: { accessPointId: accessPoint.accessPointId, iam: 'ENABLED' },
          },
        },
      ],
    });

    // Allow ECS task → EFS mount via IAM.
    fileSystem.grant(
      taskDef.taskRole,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite',
    );

    const container = taskDef.addContainer('docuseal', {
      // Use docuseal/docuseal:latest — matches the upstream
      // docker-compose.yml. The image's own ENTRYPOINT handles
      // WORKDIR, bundle exec, migrations, and the Rails 8.1
      // initialization sequence. Overriding entryPoint/command
      // bypassed all of that and surfaced spurious failures
      // (Gemfile not found, has_many_inversing= NoMethodError) —
      // see https://github.com/docusealco/docuseal/blob/master/docker-compose.yml
      // for the canonical shape this image was designed for.
      image: ecs.ContainerImage.fromRegistry('docuseal/docuseal:latest'),
      environment: {
        FORCE_SSL: 'true',
        // DocuSeal Rails app uses HOST when constructing absolute URLs
        // in emails / signer pages. The vhost is the dedicated
        // `docuseal.<domain>` — Rails serves routes at the host root,
        // no sub-path support (see class docstring).
        HOST: docusealHost,
        // Outbound mail via the in-VPC SMTP-to-SES relay (ADR-0005).
        // DocuSeal reads these env vars in config/environments/
        // production.rb and constructs ActionMailer::Base.smtp_settings.
        //
        // SMTP_ENABLE_STARTTLS=false is load-bearing: the relay does not
        // advertise STARTTLS (a publicly-trusted cert for an internal-only
        // hostname is impractical without an internal NLB + ACM cert,
        // and DocuSeal's "Noverify" option does not gracefully fall back
        // when STARTTLS is missing — it still raises
        // Net::SMTPUnsupportedCommand). Setting `false` makes Rails set
        // `enable_starttls: false`, which Net::SMTP interprets as
        // `:never` (skip STARTTLS entirely). The VPC SG-to-SG ingress
        // and the relay's own auth-accept-anything stance are the
        // security boundary; plain SMTP on the in-VPC hop is fine.
        // SES outbound (the public-internet hop) still goes over HTTPS
        // via the AWS SDK from the relay.
        SMTP_ADDRESS: props.smtpRelayHost,
        SMTP_PORT: String(props.smtpRelayPort),
        SMTP_ENABLE_STARTTLS: 'false',
        SMTP_FROM: props.smtpFromEmail,
        SMTP_FROM_NAME: 'OCI Platform',
      },
      secrets: {
        SECRET_KEY_BASE: ecs.Secret.fromSecretsManager(secretKeyBase),
        // Composed at deploy time by the DocuSealDatabaseUrlComposer
        // Lambda above — single env var, as the image expects.
        DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'docuseal', logGroup: props.logGroup }),
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
    });
    container.addMountPoints({
      sourceVolume: 'docuseal-data',
      containerPath: '/data/docuseal',
      readOnly: false,
    });

    // --- Security group ----------------------------------------------

    const serviceSg = new ec2.SecurityGroup(this, 'DocusealServiceSg', {
      vpc: props.vpc,
      description: 'DocuSeal Fargate task ENI',
      allowAllOutbound: true,
    });

    // EFS ingress for the task's ENI on TCP 2049 (NFS). EFS is in this
    // same stack so a direct connection mutation is fine.
    fileSystem.connections.allowFrom(serviceSg, ec2.Port.tcp(2049), 'DocuSeal task to EFS');

    // Aurora ingress — same pattern as api-stack: via CfnSecurityGroupIngress
    // rather than data.connections.allowDefaultPortFrom, so the
    // reference flows docuseal-stack -> data-stack (not the reverse,
    // which would deadlock since docuseal already depends on data).
    const dbSg = props.database.connections.securityGroups[0];
    if (dbSg) {
      new ec2.CfnSecurityGroupIngress(this, 'AuroraIngressFromDocuseal', {
        groupId: dbSg.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 5432,
        toPort: 5432,
        sourceSecurityGroupId: serviceSg.securityGroupId,
        description: 'DocuSeal to Aurora',
      });
    }

    // SMTP relay ingress — DocuSeal connects to the relay over TCP at the
    // relay's listening port (2525). Same CfnSecurityGroupIngress pattern
    // as Aurora so the reference flows docuseal -> mail (we already depend
    // on mail above).
    new ec2.CfnSecurityGroupIngress(this, 'SmtpRelayIngressFromDocuseal', {
      groupId: props.smtpRelaySecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: props.smtpRelayPort,
      toPort: props.smtpRelayPort,
      sourceSecurityGroupId: serviceSg.securityGroupId,
      description: 'DocuSeal to SMTP-to-SES relay',
    });

    // --- Service ------------------------------------------------------

    const service = new ecs.FargateService(this, 'DocusealService', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      // 0 on first deploy (no DB yet); 1 after operator runs the
      // bootstrap task + re-deploys with --context docusealEnabled=true.
      desiredCount: docusealEnabled ? 1 : 0,
      assignPublicIp: false,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      enableExecuteCommand: props.cfg.envName === 'dev', // ECS exec for dev troubleshooting.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // --- ALB routing --------------------------------------------------

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'DocusealTg', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        // Rails 7.1+ health endpoint mounted at root by DocuSeal
        // (`get 'up' => 'rails/health#show'`). No sub-path prefix.
        path: '/up',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });
    service.attachToApplicationTargetGroup(targetGroup);

    // Dedicated cert for the DocuSeal vhost. The shared ALB listener
    // was created in api-stack with a cert scoped to the API hostname;
    // we attach an additional cert via SNI here.
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });
    const docusealCert = new acm.Certificate(this, 'DocusealCert', {
      domainName: docusealHost,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
    new elbv2.ApplicationListenerCertificate(this, 'DocusealListenerCert', {
      listener: props.httpsListener,
      certificates: [docusealCert],
    });

    // Priority 60: between API (50) and Web catch-all (100). DocuSeal's
    // routes (admin UI, signer URLs, API) all live at the host root of
    // `docuseal.<domain>`. The DocuSeal → OCI webhook goes the other
    // direction and still lands on the API at
    // `https://<api-host>/v2/dua/webhook/docuseal` (api-stack rule, prio 50).
    new elbv2.ApplicationListenerRule(this, 'DocusealRoute', {
      listener: props.httpsListener,
      priority: 60,
      conditions: [elbv2.ListenerCondition.hostHeaders([docusealHost])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    // Route53 alias → ALB. The hosted zone is the apex (`ai4h.net`); the
    // subdomain lives under `<env>.oci.ai4h.net.`. We pass the full FQDN
    // so CDK uses it as-is rather than appending the zone name.
    new route53.ARecord(this, 'DocusealAliasA', {
      zone: hostedZone,
      recordName: docusealHost,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(props.alb)),
    });
    new route53.AaaaRecord(this, 'DocusealAliasAaaa', {
      zone: hostedZone,
      recordName: docusealHost,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(props.alb)),
    });

    // --- One-shot DB-bootstrap task ----------------------------------
    //
    // Creates the `oci_docuseal` logical database on the shared Aurora
    // cluster. DocuSeal's container assumes the DB already exists
    // (Rails migrations run on first boot, but `CREATE DATABASE` isn't
    // one of them). We can't put `CREATE DATABASE` in the main
    // container's entrypoint because the DocuSeal image doesn't ship
    // psql; a separate one-shot task with `postgres:17-alpine` does.
    //
    // The operator runs this task once after `cdk deploy`:
    //
    //   aws ecs run-task --cli-input-json "$(
    //     aws ssm get-parameter \
    //       --name /oci/<env>/docuseal/db-bootstrap-launch-spec \
    //       --query Parameter.Value --output text
    //   )"
    //
    // The task is idempotent (uses `CREATE DATABASE IF NOT EXISTS`-equivalent
    // via a `SELECT 1 FROM pg_database` guard). Re-running it is a no-op.

    const bootstrapTaskDef = new ecs.FargateTaskDefinition(this, 'DocusealDbBootstrapTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    bootstrapTaskDef.addContainer('db-bootstrap', {
      image: ecs.ContainerImage.fromRegistry('postgres:17-alpine'),
      essential: true,
      entryPoint: ['sh', '-c'],
      command: [
        // PGPASSWORD comes from the secret injection; check-then-create
        // so a re-run on an already-bootstrapped cluster exits 0.
        [
          'set -e',
          'echo "Bootstrap: checking for oci_docuseal database on $PGHOST..."',
          'EXISTS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT 1 FROM pg_database WHERE datname = \'oci_docuseal\'")',
          'if [ "$EXISTS" = "1" ]; then echo "Database oci_docuseal already exists — no-op."; exit 0; fi',
          'echo "Creating oci_docuseal database..."',
          'psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "CREATE DATABASE oci_docuseal OWNER \\"$PGUSER\\""',
          'echo "Database oci_docuseal created."',
        ].join(' && '),
      ],
      secrets: {
        PGUSER: ecs.Secret.fromSecretsManager(props.database.secret!, 'username'),
        PGPASSWORD: ecs.Secret.fromSecretsManager(props.database.secret!, 'password'),
        PGHOST: ecs.Secret.fromSecretsManager(props.database.secret!, 'host'),
        PGPORT: ecs.Secret.fromSecretsManager(props.database.secret!, 'port'),
        PGDATABASE: ecs.Secret.fromSecretsManager(props.database.secret!, 'dbname'),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'docuseal-db-bootstrap',
        logGroup: props.logGroup,
      }),
    });

    // Aggregate the launch parameters into one SSM string so the
    // operator command is `aws ecs run-task --cli-input-json "$(aws ssm
    // get-parameter ...)"`. Mirrors the api-stack migrate-task pattern.
    const bootstrapLaunchSpec = JSON.stringify({
      cluster: props.cluster.clusterArn,
      taskDefinition: bootstrapTaskDef.taskDefinitionArn,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: props.vpc.privateSubnets.map((s) => s.subnetId),
          securityGroups: [serviceSg.securityGroupId],
          assignPublicIp: 'DISABLED',
        },
      },
    });
    new ssm.StringParameter(this, 'DocusealDbBootstrapLaunchSpecParam', {
      parameterName: `/oci/${env}/docuseal/db-bootstrap-launch-spec`,
      stringValue: bootstrapLaunchSpec,
      description: `aws ecs run-task --cli-input-json payload for the DocuSeal DB bootstrap in ${env}. Idempotent — re-run safely.`,
    });
    new cdk.CfnOutput(this, 'DocusealDbBootstrapTaskDefArn', {
      value: bootstrapTaskDef.taskDefinitionArn,
      description: 'DocuSeal DB-bootstrap one-shot task definition ARN.',
    });

    // --- Exports ------------------------------------------------------

    // api-stack reads these by name (SSM dynamic resolution + Secrets
    // Manager Secret import) — no CFN cross-stack export.
    this.baseUrlParamName = `/oci/${env}/docuseal/base-url`;
    new ssm.StringParameter(this, 'DocusealBaseUrlParam', {
      parameterName: this.baseUrlParamName,
      stringValue: `https://${docusealHost}`,
      description:
        'OCI_DOCUSEAL_BASE_URL — DocuSeal public endpoint URL, consumed by the API task.',
    });
    new ssm.StringParameter(this, 'DocusealApiTokenSecretArnParam', {
      parameterName: `/oci/${env}/docuseal/api-token-secret-arn`,
      stringValue: this.apiTokenSecret.secretArn,
      description: 'Secrets Manager ARN for OCI_DOCUSEAL_API_TOKEN.',
    });
    new ssm.StringParameter(this, 'DocusealWebhookSecretArnParam', {
      parameterName: `/oci/${env}/docuseal/webhook-secret-arn`,
      stringValue: this.webhookSecret.secretArn,
      description: 'Secrets Manager ARN for OCI_DOCUSEAL_WEBHOOK_SECRET.',
    });

    new cdk.CfnOutput(this, 'DocusealBaseUrl', {
      value: `https://${docusealHost}`,
      description: 'DocuSeal admin URL — operator bootstrap entry point.',
    });

    // --- cdk-nag suppressions -----------------------------------------

    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Task role wildcards are limited to EFS mount + Secrets Manager value reads scoped to the resources this stack owns; the wildcards are on action verbs, not resources.',
        },
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Secrets are operator-managed (DocuSeal admin generates the API token; CDK rotation would clobber that). Manual rotation runbook documented in docs/for-operators/docuseal.md.',
        },
        {
          id: 'AwsSolutions-ECS2',
          reason:
            'Plaintext envs (FORCE_SSL, HOST) are non-secret routing config. All credentials (SECRET_KEY_BASE, DATABASE_URL) come from Secrets Manager.',
        },
        {
          id: 'AwsSolutions-ELB2',
          reason:
            'ALB access logs are configured on the shared ALB owned by the API stack. The new listener rule re-uses that ALB; no separate access-log target needed.',
        },
        {
          id: 'AwsSolutions-EFS1',
          reason: 'EFS encryption-at-rest is enabled with the AWS-managed key.',
        },
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole on the DATABASE_URL composer / log-retention helpers is the standard managed policy that grants CloudWatch Logs write — replacing with a customer policy adds maintenance burden for no security benefit (the actions are already minimal).',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
        {
          id: 'AwsSolutions-L1',
          reason:
            'Lambdas are pinned to NODEJS_22_X (current latest LTS at deploy time). cdk-nag warns whenever a new Node version ships; bumps happen on the project-wide cadence, not per-stack.',
        },
      ],
      true,
    );
  }
}
