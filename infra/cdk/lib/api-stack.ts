import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
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
  /** Route 53 hosted zone id for the apex (`ai4h.net`). */
  hostedZoneId: string;
  zoneName: string;
}

/**
 * NestJS API on ECS Fargate behind an ALB.
 *
 * Architecture: this stack owns the cluster, ALB, HTTPS+HTTP listeners,
 * ACM cert, Route 53 records, the API service, the API target group, and
 * the listener rule that routes API paths to that target group. The
 * listener's *default* action is a 503 fixed-response so the listener has
 * no implicit dependency on either the API or the Web target group.
 * `WebStack` adds its own catch-all listener rule for everything else,
 * keeping the api ↔ web stacks free of cross-stack dependency cycles.
 */
export class ApiStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly cluster: ecs.Cluster;
  public readonly httpsListener: elbv2.ApplicationListener;
  public readonly apiTargetGroup: elbv2.ApplicationTargetGroup;
  public readonly apiService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // Hosted zone import — used for both ACM DNS validation and the ALB alias.
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    // ACM cert (DNS-validated). Lives in eu-central-1 alongside the ALB.
    const albCert = new acm.Certificate(this, 'AlbCert', {
      domainName: props.cfg.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // Cluster.
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: props.cfg.enhancedMonitoring
        ? ecs.ContainerInsights.ENABLED
        : ecs.ContainerInsights.DISABLED,
      enableFargateCapacityProviders: true,
    });

    // Public ALB. Access logs go to the shared bucket from observability.
    // IPv4-only — the VPC's subnets don't have IPv6 CIDR blocks. Phase A2
    // follow-up: add IPv6 to the VPC + subnets, then flip ALB to DUAL_STACK
    // and re-add the AAAA record below.
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    this.alb.logAccessLogs(props.accessLogsBucket, `alb/${props.cfg.envName}`);

    // HTTPS listener — default 503 fixed response (rules supply the real
    // routing). HTTP listener redirects everything to HTTPS.
    this.httpsListener = this.alb.addListener('Https', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [albCert],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.fixedResponse(503, {
        contentType: 'text/plain',
        messageBody: 'No matching route',
      }),
    });
    this.alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // Route 53 A alias for the FQDN. IPv6 (AAAA) is a Phase A2 follow-up
    // gated on the VPC having IPv6 CIDRs.
    new route53.ARecord(this, 'AlbAliasA', {
      zone,
      recordName: props.cfg.domainName,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(this.alb)),
    });

    // API task + service.
    const taskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      cpu: props.cfg.fargate.cpu,
      memoryLimitMiB: props.cfg.fargate.memory,
      runtimePlatform: {
        // x86_64 to match the amd64 images produced by ubuntu-latest. ARM64
        // (with docker buildx --platform linux/arm64) is a Phase A2 cost
        // optimization follow-up.
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    taskDef.addContainer('api', {
      image: this.resolveApiImage(props.apiImage),
      containerName: 'api',
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production',
        OCI_ENV: props.cfg.envName,
        AWS_REGION: this.region,
        COGNITO_USER_POOL_ID: props.cognito.userPoolId,
        COGNITO_REGION: this.region,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: props.logGroup }),
    });

    this.apiService = new ecs.FargateService(this, 'ApiService', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: props.cfg.fargate.minTasks,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // API target group + listener rule for API paths.
    this.apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    this.apiService.attachToApplicationTargetGroup(this.apiTargetGroup);

    new elbv2.ApplicationListenerRule(this, 'ApiRoutes', {
      listener: this.httpsListener,
      priority: 50,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v2/*', '/health', '/docs', '/docs/*'])],
      action: elbv2.ListenerAction.forward([this.apiTargetGroup]),
    });

    // Auto-scaling.
    const scaling = this.apiService.autoScaleTaskCount({
      minCapacity: props.cfg.fargate.minTasks,
      maxCapacity: props.cfg.fargate.maxTasks,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 60 });
    scaling.scaleOnMemoryUtilization('MemoryScaling', { targetUtilizationPercent: 70 });
    scaling.scaleOnRequestCount('RequestScaling', {
      targetGroup: this.apiTargetGroup,
      requestsPerTarget: 1000,
    });

    // DB connectivity. The ingress rule lives in api-stack (not data-stack)
    // so the cross-stack reference flows api → data — same direction as the
    // rest of api's dependency on data. The previous shape (data importing
    // api's SG) caused a CFN export-in-use deadlock during the manual-ALB
    // refactor: api's old SG couldn't be deleted while data's old import
    // still held a reference. Inverting it lets CDK orchestrate the migration
    // cleanly. EC2 SG rule descriptions: a-zA-Z0-9. _-:/()#,@[]+=;{}!$*.
    const apiSg = this.apiService.connections.securityGroups[0];
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

    // WAF (managed rules) for int/prod.
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

    // Alarms.
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
      taskDef,
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
      `/${this.stackName}/Alb/SecurityGroup/Resource`,
      [
        {
          id: 'AwsSolutions-EC23',
          reason:
            'Public ALB intentionally accepts inbound 0.0.0.0/0 on 80/443 (this IS the public entrypoint for the platform). WAFv2 attaches in int/prod.',
        },
      ],
    );
    if (props.apiImage) {
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/ApiTaskDef/ExecutionRole/DefaultPolicy/Resource`,
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
