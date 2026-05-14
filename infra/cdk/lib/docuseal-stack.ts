import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
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
  /** Existing ALB HTTPS listener from the API stack — DocuSeal adds a routing rule. */
  httpsListener: elbv2.IApplicationListener;
  /** Aurora cluster — DocuSeal gets its own logical DB (`oci_docuseal`). */
  database: rds.DatabaseCluster;
  /** Shared CloudWatch log group for the DocuSeal container. */
  logGroup: logs.ILogGroup;
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
 *   - ALB rule at priority 60 on the existing HTTPS listener routes
 *     `/docuseal/*` to the DocuSeal target group. The admin UI lives at
 *     `https://<env>.oci.ai4h.net/docuseal/admin`; the signer URL the
 *     API hands the requester is `https://<env>.oci.ai4h.net/docuseal/s/<token>`.
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

    // --- EFS volume ----------------------------------------------------

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
      image: ecs.ContainerImage.fromRegistry('docuseal/docuseal:latest'),
      environment: {
        FORCE_SSL: 'true',
        // DocuSeal Rails app expects HOST so it can construct absolute
        // URLs in its emails / signer-page templates.
        HOST: props.cfg.domainName,
        // Path prefix — DocuSeal serves everything from this base. The
        // ALB rule maps /docuseal/* → DocuSeal TG; the container needs
        // to know the prefix so its internal redirects don't strip it.
        RAILS_RELATIVE_URL_ROOT: '/docuseal',
      },
      secrets: {
        SECRET_KEY_BASE: ecs.Secret.fromSecretsManager(secretKeyBase),
        // DocuSeal reads its DB connection from DATABASE_URL. We compose
        // it from the Aurora secret fields at task launch via a
        // separate env-var injection (POSTGRES_*); DocuSeal also accepts
        // discrete vars if a templating layer is added — for now we
        // expose the full URL via Secrets Manager rendered with
        // {{resolve}}-style substitution at deploy time. Aurora's
        // managed secret carries `host` + `port` + `username` +
        // `password`; we compose at deploy. (See note below: the
        // simplest correct approach is to give DocuSeal credentials
        // for a dedicated DB role; we use the master here for dev
        // simplicity and tighten in a follow-up.)
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(props.database.secret!, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(props.database.secret!, 'password'),
        DATABASE_HOST: ecs.Secret.fromSecretsManager(props.database.secret!, 'host'),
        DATABASE_PORT: ecs.Secret.fromSecretsManager(props.database.secret!, 'port'),
      },
      // Override BOTH entryPoint and command so we control the full
      // container start sequence. The DocuSeal image's default
      // ENTRYPOINT is at a path that we don't want to call into —
      // simpler to compose DATABASE_URL from the per-field Aurora
      // secrets and exec `bundle exec rails server` directly. Working
      // dir comes from the image's own WORKDIR (DocuSeal Rails app).
      // NB: `oci_docuseal` is a logical database the operator creates
      // on the Aurora cluster via the bootstrap one-shot. Rails
      // migrations populate the schema on first boot.
      entryPoint: ['sh', '-c'],
      command: [
        'export DATABASE_URL="postgresql://${DATABASE_USERNAME}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/oci_docuseal" && exec bundle exec rails server -b 0.0.0.0 -p 3000',
      ],
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
        path: '/docuseal/up',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });
    service.attachToApplicationTargetGroup(targetGroup);

    // Priority 60: between API (50) and Web catch-all (100). DocuSeal's
    // signer URL lives at `/docuseal/s/<token>`; admin UI at
    // `/docuseal/admin`. The webhook DocuSeal sends back to us hits
    // `/v2/dua/webhook/docuseal` and is owned by the API rule (priority 50).
    new elbv2.ApplicationListenerRule(this, 'DocusealRoute', {
      listener: props.httpsListener,
      priority: 60,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/docuseal', '/docuseal/*'])],
      action: elbv2.ListenerAction.forward([targetGroup]),
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
      stringValue: `https://${props.cfg.domainName}/docuseal`,
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
      value: `https://${props.cfg.domainName}/docuseal`,
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
            'Plaintext envs (FORCE_SSL, HOST, RAILS_RELATIVE_URL_ROOT) are non-secret routing config. All credentials (SECRET_KEY_BASE, DATABASE_*) come from Secrets Manager.',
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
      ],
      true,
    );
  }
}
