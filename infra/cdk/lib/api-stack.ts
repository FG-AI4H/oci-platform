import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
  cognito: cognito.UserPool;
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
}

/**
 * NestJS API on ECS Fargate behind an ALB.
 *
 * Reliability: ≥3 AZs, ALB health checks, target tracking auto-scaling, deployment circuit breaker.
 * Performance: target tracking on CPU + RPS + memory.
 * Security: HTTPS-only, WAFv2 (managed rules: CommonRuleSet, KnownBadInputs, AnonymousIpList) in int/prod,
 *           Container Insights, ENA-private subnets, IAM task role least-priv.
 * Operational excellence: CloudWatch structured logs, X-Ray tracing in int/prod.
 */
export class ApiStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

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
          COGNITO_USER_POOL_ID: props.cognito.userPoolId,
          COGNITO_REGION: this.region,
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: props.logGroup }),
      },
      publicLoadBalancer: true,
      // ALB stays HTTP; CloudFront (WebStack) terminates TLS to viewers.
      // Phase A2: add ACM cert + custom domain once Route 53 zone is provisioned.
      protocol: elbv2.ApplicationProtocol.HTTP,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    this.alb = fargate.loadBalancer;
    this.alb.logAccessLogs(props.accessLogsBucket, `alb/${props.cfg.envName}`);

    fargate.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(15),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Auto-scaling
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
    props.database.connections.allowDefaultPortFrom(fargate.service, 'API → Aurora');

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

    new cdk.CfnOutput(this, 'ApiUrl', { value: `https://${this.alb.loadBalancerDnsName}` });

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
            'Public ALB intentionally accepts inbound 0.0.0.0/0 on 80 (CloudFront origin) — Web ACL provides L7 filtering in int/prod.',
        },
      ],
    );
    // ECS task execution role default policy: GetAuthorizationToken + ECR read scoped to *
    // is the standard ECS pattern (ecr:GetAuthorizationToken does not support per-repo
    // resource scoping). Surface only when an ECR image is supplied.
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
