import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface ApiStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  vpc: ec2.IVpc;
  database: rds.DatabaseCluster;
  logGroup: logs.ILogGroup;
  /** Shared access-logs bucket (from observability stack) used as ALB access log target. */
  accessLogsBucket: s3.IBucket;
  /**
   * Self-hosted dataset distributions bucket (PR I, #87). The API
   * task gets read/write IAM on it for multipart upload + presigned
   * GET; the bucket name is exposed to the container as
   * `OCI_DATASETS_BUCKET`.
   */
  datasetsBucket: s3.IBucket;
  /**
   * Sealed-execution submission queue from eval-stack (ADR-0018 Mode 2,
   * WP2). The API is the only publisher: a `mode: CONTAINER` submission is
   * enqueued rather than scored in-process. The task role gets
   * `sqs:SendMessage` on this queue alone, and the container reads the URL
   * from `OCI_EVAL_QUEUE_URL`.
   */
  evalQueue: sqs.IQueue;
  /**
   * ECR image URI (`<account>.dkr.ecr.<region>.amazonaws.com/oci-api:<sha>`)
   * built and pushed by the GitHub Actions Deploy workflow.
   * When undefined (e.g. local `cdk synth` without `--context apiImage=...`),
   * falls back to a public nginx placeholder so the stack can still synth.
   */
  apiImage?: string;
  /**
   * ECR image URI for the one-shot Prisma migrate container
   * (`<account>.dkr.ecr.<region>.amazonaws.com/oci-migrate:<sha>`). The
   * task definition is rendered when supplied; CI launches it via
   * `aws ecs run-task` to apply pending migrations against the
   * VPC-private Aurora cluster. When undefined (local synth), the
   * MigrateTaskDef is omitted so the stack still synths offline.
   */
  migrateImage?: string;
  /**
   * ECR image URI for the federation harvest worker
   * (`<account>.dkr.ecr.<region>.amazonaws.com/oci-worker-ingest:<sha>`).
   * Long-running Fargate service in the same cluster as the API, sharing
   * the API's security group + Aurora ingress. Omitted at local synth
   * time so the stack still synths offline.
   */
  workerIngestImage?: string;
  /** Route 53 hosted zone id for the apex (`ai4h.net`). */
  hostedZoneId: string;
  zoneName: string;
}

/**
 * NestJS API on ECS Fargate behind an ALB.
 *
 * Architecture: uses `ApplicationLoadBalancedFargateService` (which owns the
 * ALB, HTTPS listener with a default forward to API TG, ACM cert, A record,
 * service, and target group). On top of that, adds an explicit listener rule
 * at priority 50 for API paths. WebStack adds a catch-all rule at priority
 * 100 — anything not matched by the API rule falls through to the web TG.
 *
 * The Aurora ingress rule is created here (api-stack) via
 * `CfnSecurityGroupIngress`, not via `data.connections.allowDefaultPortFrom`.
 * This keeps the cross-stack reference flowing api → data, matching the
 * direction of the rest of api's prop dependency on data.
 */
export class ApiStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly cluster: ecs.Cluster;
  public readonly httpsListener: elbv2.IApplicationListener;
  public readonly apiTargetGroup: elbv2.ApplicationTargetGroup;
  /**
   * One-shot Fargate task definition that runs `prisma migrate deploy`.
   * Rendered only when `props.migrateImage` is supplied. CI launches it
   * with `aws ecs run-task` after `cdk deploy`; the task runs in the
   * private subnets and reaches Aurora through the same SG ingress as
   * the API service. Outputs publish the task def ARN, cluster ARN,
   * subnet/SG ids, and an SSM parameter aggregating them all so the
   * Deploy workflow can launch with a single SSM lookup.
   */
  public readonly migrateTaskDefArn?: string;
  public readonly migrateContainerName: string = 'migrate';

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // Whether to wire DocuSeal env vars + secrets into the API task. Set
    // via `--context docusealEnabled=true` AFTER docuseal-stack has been
    // deployed for the first time (otherwise CFN fails the change-set
    // when it can't resolve the as-yet-missing SSM parameters). Default
    // false so a greenfield environment can deploy api-stack without
    // docuseal-stack existing.
    const docusealEnabled =
      this.node.tryGetContext('docusealEnabled') === true ||
      this.node.tryGetContext('docusealEnabled') === 'true';

    // Hosted zone import — used for ACM DNS validation and the ALB alias.
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    // ACM cert (DNS-validated). Lives in eu-central-1 alongside the ALB.
    const albCert = new acm.Certificate(this, 'AlbCert', {
      domainName: props.cfg.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: props.cfg.enhancedMonitoring
        ? ecs.ContainerInsights.ENABLED
        : ecs.ContainerInsights.DISABLED,
      enableFargateCapacityProviders: true,
    });

    const fargate = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
      cluster: this.cluster,
      cpu: props.cfg.fargate.cpu,
      memoryLimitMiB: props.cfg.fargate.memory,
      desiredCount: props.cfg.fargate.minTasks,
      circuitBreaker: { rollback: true },
      runtimePlatform: {
        // Graviton (ARM64) Fargate — ~20% cheaper than x86_64. Workflow
        // builds linux/arm64 images via docker buildx + QEMU on the
        // x86_64 ubuntu-latest runner.
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskImageOptions: {
        // ECR image via fromEcrRepository (auto-grants pull on the execution role)
        // or nginx placeholder for local synth without --context apiImage=...
        image: this.resolveApiImage(props.apiImage),
        containerName: 'api',
        containerPort: 3000,
        environment: {
          NODE_ENV: 'production',
          OCI_ENV: props.cfg.envName,
          AWS_REGION: this.region,
          // Resolved at deploy time via SSM dynamic substitution
          // (`{{resolve:ssm:...}}`). identity-stack writes these. No CFN
          // cross-stack export — replacing the user pool client doesn't
          // deadlock api-stack the way an Fn::ImportValue would.
          COGNITO_USER_POOL_ID: ssm.StringParameter.valueForStringParameter(
            this,
            `/oci/${props.cfg.envName}/cognito/user-pool-id`,
          ),
          COGNITO_USER_POOL_CLIENT_ID: ssm.StringParameter.valueForStringParameter(
            this,
            `/oci/${props.cfg.envName}/cognito/web-client-id`,
          ),
          COGNITO_REGION: this.region,
          // PR I (#87): the storage module reads this to know which
          // bucket to multipart-upload + presign against. Region
          // already injected above.
          OCI_DATASETS_BUCKET: props.datasetsBucket.bucketName,
          // Sealed-execution inbox (ADR-0018 Mode 2). The evaluation module
          // publishes one message per CONTAINER submission; send permission
          // is granted below and is scoped to this queue only.
          OCI_EVAL_QUEUE_URL: props.evalQueue.queueUrl,
          // Absolute origin of THIS api. The dispatcher builds the worker's
          // outbox `callbackUrl` from it; without it the CONTAINER path
          // refuses with 503 rather than enqueueing an unanswerable run.
          OCI_API_URL: `https://${props.cfg.domainName}`,
          // The run cap dispatched in every queue message. Pinned to the same
          // per-env envelope the queue's visibility timeout is derived from
          // (eval-stack: visibility = maxRunSeconds + pull + outbox), so the
          // two cannot drift into a queue that redelivers a healthy run.
          OCI_EVAL_RUN_TIMEOUT_SEC: String(props.cfg.evalRunner.maxRunSeconds),
          // DocuSeal endpoint (#128). Gated on `--context docusealEnabled=true`
          // so a greenfield environment can deploy api-stack first
          // (docuseal-stack depends on api.cluster + api.listener, so
          // api-stack must precede it). Operator deploy order:
          //   1. cdk deploy oci-<env>-docuseal --context env=<env>
          //   2. cdk deploy oci-<env>-api --context env=<env> --context docusealEnabled=true
          ...(docusealEnabled
            ? {
                OCI_DOCUSEAL_BASE_URL: ssm.StringParameter.valueForStringParameter(
                  this,
                  `/oci/${props.cfg.envName}/docuseal/base-url`,
                ),
              }
            : {}),
        },
        // Aurora credential secrets — same per-field injection as the
        // migrate task. The API composes DATABASE_URL at boot from these
        // (see apps/api/src/prisma.service.ts -> resolveDatabaseUrl).
        // The container is distroless (no shell), so the composition has
        // to happen in Node at startup rather than in an entrypoint.sh
        // like the migrate task does.
        secrets: {
          DB_USERNAME: ecs.Secret.fromSecretsManager(props.database.secret!, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(props.database.secret!, 'password'),
          DB_HOST: ecs.Secret.fromSecretsManager(props.database.secret!, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(props.database.secret!, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(props.database.secret!, 'dbname'),
          // DocuSeal credentials (#128). Same gating as OCI_DOCUSEAL_BASE_URL
          // above — only injected after docuseal-stack has been deployed.
          ...(docusealEnabled
            ? {
                OCI_DOCUSEAL_API_TOKEN: ecs.Secret.fromSecretsManager(
                  secretsmanager.Secret.fromSecretCompleteArn(
                    this,
                    'DocusealApiTokenImport',
                    ssm.StringParameter.valueForStringParameter(
                      this,
                      `/oci/${props.cfg.envName}/docuseal/api-token-secret-arn`,
                    ),
                  ),
                ),
                OCI_DOCUSEAL_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(
                  secretsmanager.Secret.fromSecretCompleteArn(
                    this,
                    'DocusealWebhookSecretImport',
                    ssm.StringParameter.valueForStringParameter(
                      this,
                      `/oci/${props.cfg.envName}/docuseal/webhook-secret-arn`,
                    ),
                  ),
                ),
              }
            : {}),
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: props.logGroup }),
      },
      publicLoadBalancer: true,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificate: albCert,
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      redirectHTTP: true,
      domainZone: zone,
      domainName: props.cfg.domainName,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    this.alb = fargate.loadBalancer;
    this.alb.logAccessLogs(props.accessLogsBucket, `alb/${props.cfg.envName}`);
    this.httpsListener = fargate.listener;
    this.apiTargetGroup = fargate.targetGroup;

    fargate.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(15),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Explicit listener rule for API paths at priority 50. The patterns
    // construct sets the listener default to api TG, but WebStack adds a
    // catch-all rule at priority 100 (`/*` → web TG) which would otherwise
    // also match API paths. Priority 50 wins for API URLs.
    new elbv2.ApplicationListenerRule(this, 'ApiRoutes', {
      listener: fargate.listener,
      priority: 50,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v2/*', '/health', '/docs', '/docs/*'])],
      action: elbv2.ListenerAction.forward([fargate.targetGroup]),
    });

    // Auto-scaling.
    const scaling = fargate.service.autoScaleTaskCount({
      minCapacity: props.cfg.fargate.minTasks,
      maxCapacity: props.cfg.fargate.maxTasks,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 60 });
    scaling.scaleOnMemoryUtilization('MemoryScaling', { targetUtilizationPercent: 70 });
    scaling.scaleOnRequestCount('RequestScaling', {
      targetGroup: fargate.targetGroup,
      requestsPerTarget: 1000,
    });

    // DB connectivity (network only — IAM database auth is wired in Phase A2
    // via a separate stack to avoid creating a cycle between data + api).
    // Ingress rule lives in api-stack so cross-stack refs flow api → data.
    // EC2 SG rule descriptions: a-zA-Z0-9. _-:/()#,@[]+=;{}!$* (no '>' allowed).
    const apiSg = fargate.service.connections.securityGroups[0];
    const dbSg = props.database.connections.securityGroups[0];
    if (apiSg && dbSg) {
      new ec2.CfnSecurityGroupIngress(this, 'AuroraIngressFromApi', {
        groupId: dbSg.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 5432,
        toPort: 5432,
        sourceSecurityGroupId: apiSg.securityGroupId,
        description: 'API to Aurora',
      });
    }

    // GuardDuty Runtime Monitoring auto-injects an agent sidecar on Fargate
    // tasks. The agent image lives in a GuardDuty-owned ECR account
    // (323658145986); the task execution role needs cross-account pull
    // permission. Without this, the sidecar fails to start (403 Forbidden)
    // — a non-essential failure but visible noise in the events.
    grantGuardDutyAgentEcrPull(fargate.taskDefinition);

    // Self-hosted dataset distributions (PR I, #87). The API multipart
    // orchestration needs full RW + multipart-abort, plus permission
    // to presign GETs for the gated download path. KMS access on the
    // bucket's CMK is granted automatically by the high-level
    // grantReadWrite helper (it inspects the bucket's encryption key).
    props.datasetsBucket.grantReadWrite(fargate.taskDefinition.taskRole);
    fargate.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:AbortMultipartUpload',
          's3:ListBucketMultipartUploads',
          's3:ListMultipartUploadParts',
        ],
        resources: [props.datasetsBucket.bucketArn, `${props.datasetsBucket.bucketArn}/*`],
      }),
    );

    // Sealed-execution dispatch (WP2 / ADR-0018 Mode 2). Send-only: the API
    // publishes a submission message and never receives or deletes — the
    // runner owns consumption, and the result comes back over the outbox
    // HTTP endpoint, not the queue. The grant also covers kms:Encrypt /
    // GenerateDataKey* on the eval CMK, which the queue's encryption key
    // requires for a CMK-encrypted send.
    props.evalQueue.grantSendMessages(fargate.taskDefinition.taskRole);

    // Identity-admin module (#241) — list users + view detail + grant /
    // revoke group memberships from `/admin/users`. The pool ID is
    // resolved lazily from SSM at synth time (same dynamic reference
    // used in the container env above), so the resulting ARN is a
    // CloudFormation-resolved string; CDK accepts it verbatim.
    const userPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `/oci/${props.cfg.envName}/cognito/user-pool-id`,
    );
    const userPoolArn = `arn:${cdk.Aws.PARTITION}:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`;
    fargate.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
        ],
        resources: [userPoolArn],
      }),
    );
    // The aggregate policy that `grantReadWrite` synthesises uses S3
    // action wildcards (`s3:GetObject*`, `s3:GetBucket*`, etc.) and
    // KMS wildcards (`kms:GenerateDataKey*`, `kms:ReEncrypt*`). cdk-nag
    // flags these as IAM5 violations; the wildcards are scoped to the
    // datasets bucket + its CMK and are the standard CDK pattern for
    // bucket-level RW. Suppressing with the explicit appliesTo list
    // documents the intent rather than turning IAM5 off globally.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ApiService/TaskDef/TaskRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            "S3 action wildcards on `${datasetsBucket.bucketArn}/*` are the standard CDK shape for `bucket.grantReadWrite()`; the principal is the API task role and the resource is scoped to one bucket. KMS wildcards are needed because the bucket's CMK is rotated and the SDK transparently calls GenerateDataKey + ReEncrypt during multipart uploads; both are scoped to the bucket's encryption key. The same two KMS action wildcards also arrive from `evalQueue.grantSendMessages()` and are scoped to the eval stack's CMK, which encrypts only the sealed-execution queue pair.",
          appliesTo: [
            'Action::s3:GetObject*',
            'Action::s3:GetBucket*',
            'Action::s3:List*',
            'Action::s3:DeleteObject*',
            'Action::s3:Abort*',
            'Action::kms:ReEncrypt*',
            'Action::kms:GenerateDataKey*',
            { regex: '/^Resource::<DatasetsBucket.*\\.Arn>\\/\\*$/' },
          ],
        },
      ],
    );

    // ----------------------------------------------------------------------
    // One-shot Prisma migrate task definition. Rendered only when an
    // explicit migrateImage is supplied (CI passes one; local synth omits).
    // CI launches it via `aws ecs run-task` after `cdk deploy`. The task
    // runs in the same private subnets and shares the API service's
    // security group so the existing Aurora ingress rule covers it.
    //
    // DATABASE_URL is composed inside the container (apps/migrate/
    // entrypoint.sh) from per-field ECS secrets so the password never
    // appears in the task definition's plaintext env.
    // ----------------------------------------------------------------------
    if (props.migrateImage && apiSg && props.database.secret) {
      const migrateTaskDef = new ecs.FargateTaskDefinition(this, 'MigrateTaskDef', {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      const dbSecret = props.database.secret;
      migrateTaskDef.addContainer('migrate', {
        image: this.resolveMigrateImage(props.migrateImage),
        containerName: this.migrateContainerName,
        essential: true,
        environment: {
          NODE_ENV: 'production',
          OCI_ENV: props.cfg.envName,
          // Required for the demo-data fixture upload step in
          // `apps/migrate/entrypoint.sh` (#251) — uploads the bundled
          // PNGs to the datasets bucket on dev/int. The entrypoint
          // short-circuits the upload when OCI_ENV=prod, so the env
          // var is harmless on prod but useful to keep parameterised.
          OCI_DATASETS_BUCKET: props.datasetsBucket.bucketName,
          AWS_REGION: this.region,
        },
        secrets: {
          DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
        },
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'migrate',
          logGroup: props.logGroup,
        }),
      });

      // S3 + KMS perms for the demo-data fixture upload (#251). The
      // entrypoint runs `apps/migrate/upload-fixtures.mjs` after
      // `prisma migrate deploy` on non-prod environments; that script
      // HEAD-checks then PUTs each bundled PNG. `grantReadWrite`
      // covers PutObject + HeadObject + the KMS GenerateDataKey/
      // Decrypt calls the SDK transparently makes against the
      // bucket's CMK during SSE-KMS PUTs. Production calls are
      // skipped by the entrypoint's OCI_ENV gate, but the IAM grant
      // is unconditional — keeps the task definition shape stable
      // across envs.
      props.datasetsBucket.grantReadWrite(migrateTaskDef.taskRole);

      // Same cdk-nag IAM5 suppression as the API task role above —
      // `grantReadWrite` synthesises wildcards on the bucket + CMK
      // that are the standard CDK shape, scoped to one bucket only.
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/MigrateTaskDef/TaskRole/DefaultPolicy/Resource`,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'S3 action wildcards from `bucket.grantReadWrite()` on the migrate task role. Needed for the demo-data fixture upload (#251) on non-prod environments. Scoped to one bucket + its CMK.',
            appliesTo: [
              'Action::s3:GetObject*',
              'Action::s3:GetBucket*',
              'Action::s3:List*',
              'Action::s3:DeleteObject*',
              'Action::s3:Abort*',
              'Action::kms:ReEncrypt*',
              'Action::kms:GenerateDataKey*',
              { regex: '/^Resource::<DatasetsBucket.*\\.Arn>\\/\\*$/' },
            ],
          },
        ],
      );

      // Cross-account ECR pull for the GuardDuty Runtime Monitoring agent.
      grantGuardDutyAgentEcrPull(migrateTaskDef);

      this.migrateTaskDefArn = migrateTaskDef.taskDefinitionArn;

      // Aggregate the launch parameters into one SSM parameter so the
      // Deploy workflow can fetch a single string and pass it to
      // `aws ecs run-task`. Format: JSON `{cluster, taskDefinition,
      // subnets[], securityGroups[]}`.
      const launchSpec = JSON.stringify({
        cluster: this.cluster.clusterArn,
        taskDefinition: migrateTaskDef.taskDefinitionArn,
        subnets: props.vpc.privateSubnets.map((s) => s.subnetId),
        securityGroups: [apiSg.securityGroupId],
      });
      new ssm.StringParameter(this, 'MigrateLaunchSpecParam', {
        parameterName: `/oci/${props.cfg.envName}/migrate/launch-spec`,
        stringValue: launchSpec,
        description: `Aggregated run-task params for the prisma migrate one-shot in ${props.cfg.envName}`,
      });

      new cdk.CfnOutput(this, 'MigrateTaskDefArn', { value: migrateTaskDef.taskDefinitionArn });
      new cdk.CfnOutput(this, 'MigrateClusterArn', { value: this.cluster.clusterArn });

      NagSuppressions.addResourceSuppressions(
        migrateTaskDef,
        [
          {
            id: 'AwsSolutions-ECS2',
            reason:
              'Plaintext envs on the migrate task are non-secret runtime config (NODE_ENV, OCI_ENV). DB credentials are injected as ECS secrets from Secrets Manager (DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME). DATABASE_URL is composed inside the container by entrypoint.sh so the password is never in the task definition.',
          },
        ],
        true,
      );
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/MigrateTaskDef/ExecutionRole/DefaultPolicy/Resource`,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'ecr:GetAuthorizationToken does not support resource scoping; AWS requires Resource::*. Per-repo actions are scoped by fromEcrRepository to the imported oci-migrate repo ARN.',
            appliesTo: ['Resource::*', 'Action::ecr:GetAuthorizationToken'],
          },
        ],
      );
    }

    // ----------------------------------------------------------------------
    // Federation harvest worker (PR E.3). Long-running Fargate service in
    // the same cluster as the API; shares the API's SG so the existing
    // Aurora ingress rule covers it. No load balancer — the worker is a
    // background process driven by its internal loop (LOOP_INTERVAL_MS).
    //
    // desiredCount=1 in dev/int (single harvester is enough for the peer
    // count we expect at this phase). prod can scale via the env config
    // when peer count grows; runOneHarvestCycle's optimistic claim makes
    // multiple workers safe to coexist.
    // ----------------------------------------------------------------------
    if (props.workerIngestImage && apiSg && props.database.secret) {
      const workerTaskDef = new ecs.FargateTaskDefinition(this, 'WorkerIngestTaskDef', {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      const dbSecret = props.database.secret;
      workerTaskDef.addContainer('worker-ingest', {
        image: this.resolveWorkerIngestImage(props.workerIngestImage),
        containerName: 'worker-ingest',
        essential: true,
        environment: {
          NODE_ENV: 'production',
          OCI_ENV: props.cfg.envName,
          // Tunables. The image's defaults are fine for dev/int; prod
          // can override via task-def env if peer count grows.
          LOOP_INTERVAL_MS: '60000',
          HARVEST_INTERVAL_MINUTES: '30',
          FETCH_TIMEOUT_MS: '30000',
        },
        secrets: {
          DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
        },
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'worker-ingest',
          logGroup: props.logGroup,
        }),
      });

      const workerService = new ecs.FargateService(this, 'WorkerIngestService', {
        cluster: this.cluster,
        taskDefinition: workerTaskDef,
        // Reuse the API service's security group so the existing Aurora
        // ingress rule covers the worker too. No new ingress rule needed.
        securityGroups: [apiSg],
        desiredCount: 1,
        minHealthyPercent: 0,
        maxHealthyPercent: 200,
        circuitBreaker: { rollback: true },
      });

      grantGuardDutyAgentEcrPull(workerTaskDef);

      new cdk.CfnOutput(this, 'WorkerIngestServiceArn', { value: workerService.serviceArn });

      NagSuppressions.addResourceSuppressions(
        workerTaskDef,
        [
          {
            id: 'AwsSolutions-ECS2',
            reason:
              'Plaintext envs on the worker task are non-secret runtime config (NODE_ENV, OCI_ENV, LOOP_INTERVAL_MS, HARVEST_INTERVAL_MINUTES, FETCH_TIMEOUT_MS). DB credentials are injected as ECS secrets from Secrets Manager — DATABASE_URL is composed inside the container by @oci/database at startup.',
          },
        ],
        true,
      );
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/WorkerIngestTaskDef/ExecutionRole/DefaultPolicy/Resource`,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'ecr:GetAuthorizationToken does not support resource scoping; AWS requires Resource::*. Per-repo actions are scoped by fromEcrRepository to the imported oci-worker-ingest repo ARN.',
            appliesTo: ['Resource::*', 'Action::ecr:GetAuthorizationToken'],
          },
        ],
      );
    }

    // WAF (managed rules) for int/prod
    if (props.cfg.enableWaf) {
      const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `oci-${props.cfg.envName}-waf`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 1,
            overrideAction: { none: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'CommonRuleSet',
              sampledRequestsEnabled: true,
            },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
          },
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 2,
            overrideAction: { none: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'KnownBadInputs',
              sampledRequestsEnabled: true,
            },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
          },
          {
            name: 'AWSManagedRulesAmazonIpReputationList',
            priority: 3,
            overrideAction: { none: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'IpReputation',
              sampledRequestsEnabled: true,
            },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesAmazonIpReputationList',
              },
            },
          },
        ],
      });
      new wafv2.CfnWebACLAssociation(this, 'WebAclAssoc', {
        resourceArn: this.alb.loadBalancerArn,
        webAclArn: acl.attrArn,
      });
    }

    // Alarms
    if (props.cfg.enhancedMonitoring) {
      new cloudwatch.Alarm(this, 'High5xxAlarm', {
        metric: this.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT),
        threshold: 10,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      new cloudwatch.Alarm(this, 'TargetResponseTime', {
        metric: this.alb.metrics.targetResponseTime(),
        threshold: 1.5,
        evaluationPeriods: 5,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }

    new cdk.CfnOutput(this, 'ApiUrl', { value: `https://${props.cfg.domainName}` });
    new cdk.CfnOutput(this, 'AlbDns', { value: this.alb.loadBalancerDnsName });

    if (!props.cfg.enhancedMonitoring) {
      NagSuppressions.addResourceSuppressions(this.cluster, [
        {
          id: 'AwsSolutions-ECS4',
          reason:
            'Container Insights is intentionally OFF in non-prod environments per environments.ts (cost). Enabled in int and prod.',
        },
      ]);
    }
    NagSuppressions.addResourceSuppressions(
      fargate.taskDefinition,
      [
        {
          id: 'AwsSolutions-ECS2',
          reason:
            'Plaintext envs on the API task are non-secret runtime configuration only (NODE_ENV, OCI_ENV, AWS_REGION, COGNITO_USER_POOL_ID, COGNITO_REGION, OCI_DATASETS_BUCKET, OCI_EVAL_QUEUE_URL). Real secrets (DB credentials, Cognito client secrets) are read from Secrets Manager via IAM at runtime, not injected via task env.',
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ApiService/LB/SecurityGroup/Resource`,
      [
        {
          id: 'AwsSolutions-EC23',
          reason:
            'Public ALB intentionally accepts inbound 0.0.0.0/0 on 80/443 — this IS the public entrypoint for the platform. WAFv2 attaches in int/prod.',
        },
      ],
    );
    if (props.apiImage) {
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/ApiService/TaskDef/ExecutionRole/DefaultPolicy/Resource`,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'ecr:GetAuthorizationToken does not support resource scoping; AWS requires Resource::*. Per-repo actions (BatchGetImage, BatchCheckLayerAvailability, GetDownloadUrlForLayer) are scoped by fromEcrRepository to the imported oci-api repo ARN.',
            appliesTo: ['Resource::*', 'Action::ecr:GetAuthorizationToken'],
          },
        ],
      );
    }
  }

  // (helper exported below the class — `grantGuardDutyAgentEcrPull`)

  /**
   * Build the ECS container image. With `apiImage` ("<acct>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>"),
   * resolves the ECR repo by name so CDK auto-grants pull permissions on the execution role.
   * Without it (local synth), uses a public nginx placeholder.
   */
  private resolveApiImage(apiImage: string | undefined): ecs.ContainerImage {
    if (!apiImage) {
      return ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:alpine');
    }
    const colon = apiImage.lastIndexOf(':');
    const slash = apiImage.lastIndexOf('/');
    if (colon <= slash) {
      throw new Error(
        `apiImage "${apiImage}" is missing a tag; expected "<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>"`,
      );
    }
    const tag = apiImage.slice(colon + 1);
    const repoName = apiImage.slice(slash + 1, colon);
    const repo = ecr.Repository.fromRepositoryName(this, 'ApiRepoRef', repoName);
    return ecs.ContainerImage.fromEcrRepository(repo, tag);
  }

  /**
   * Same parsing rule as resolveApiImage; we keep it separate so the
   * imported ECR repository construct gets a distinct CDK id (ApiRepoRef
   * vs MigrateRepoRef) — `Repository.fromRepositoryName` errors on
   * duplicate ids in the same scope.
   */
  private resolveMigrateImage(migrateImage: string): ecs.ContainerImage {
    const colon = migrateImage.lastIndexOf(':');
    const slash = migrateImage.lastIndexOf('/');
    if (colon <= slash) {
      throw new Error(
        `migrateImage "${migrateImage}" is missing a tag; expected "<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>"`,
      );
    }
    const tag = migrateImage.slice(colon + 1);
    const repoName = migrateImage.slice(slash + 1, colon);
    const repo = ecr.Repository.fromRepositoryName(this, 'MigrateRepoRef', repoName);
    return ecs.ContainerImage.fromEcrRepository(repo, tag);
  }

  /** Same parsing as resolveApiImage; distinct CDK id for the ECR ref. */
  private resolveWorkerIngestImage(image: string): ecs.ContainerImage {
    const colon = image.lastIndexOf(':');
    const slash = image.lastIndexOf('/');
    if (colon <= slash) {
      throw new Error(
        `workerIngestImage "${image}" is missing a tag; expected "<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>"`,
      );
    }
    const tag = image.slice(colon + 1);
    const repoName = image.slice(slash + 1, colon);
    const repo = ecr.Repository.fromRepositoryName(this, 'WorkerIngestRepoRef', repoName);
    return ecs.ContainerImage.fromEcrRepository(repo, tag);
  }
}

/**
 * Grant a Fargate task execution role permission to pull the AWS GuardDuty
 * Runtime Monitoring agent image from its cross-account ECR repository
 * (323658145986). Required when GuardDuty Runtime Monitoring is enabled
 * at the account level — ECS injects the agent as a sidecar and the task
 * execution role needs to pull its image.
 *
 * Exported so both api-stack and web-stack can call it.
 */
export function grantGuardDutyAgentEcrPull(taskDef: ecs.TaskDefinition): void {
  taskDef.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      sid: 'GuardDutyAgentEcrPull',
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['arn:aws:ecr:*:323658145986:repository/aws-guardduty-agent-fargate'],
    }),
  );
  // ecr:GetAuthorizationToken does not support resource-level scoping; account-wide auth.
  taskDef.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      sid: 'GuardDutyAgentEcrAuth',
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }),
  );
  if (taskDef.executionRole) {
    NagSuppressions.addResourceSuppressions(
      taskDef.executionRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'AWS GuardDuty Runtime Monitoring requires the task execution role to pull the agent image from arn:aws:ecr:*:323658145986:repository/aws-guardduty-agent-fargate. ecr:GetAuthorizationToken does not support per-resource scoping.',
          appliesTo: [
            'Resource::*',
            'Resource::arn:aws:ecr:*:323658145986:repository/aws-guardduty-agent-fargate',
            'Action::ecr:GetAuthorizationToken',
          ],
        },
      ],
      true,
    );
  }
}
