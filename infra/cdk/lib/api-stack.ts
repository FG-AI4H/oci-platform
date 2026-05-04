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
   * ECR image URI (`<account>.dkr.ecr.<region>.amazonaws.com/oci-api:<sha>`)
   * built and pushed by the GitHub Actions Deploy workflow.
   * When undefined (e.g. local `cdk synth` without `--context apiImage=...`),
   * falls back to a public nginx placeholder so the stack can still synth.
   */
  apiImage?: string;
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

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

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
            'Plaintext envs on the API task are non-secret runtime configuration only (NODE_ENV, OCI_ENV, AWS_REGION, COGNITO_USER_POOL_ID, COGNITO_REGION). Real secrets (DB credentials, Cognito client secrets) are read from Secrets Manager via IAM at runtime, not injected via task env.',
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
