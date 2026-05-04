import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface WebStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  /** HTTPS listener owned by ApiStack — WebStack adds a low-priority catch-all rule. */
  httpsListener: elbv2.IApplicationListener;
  /** Shared CloudWatch log group for the web container. */
  logGroup: logs.ILogGroup;
  /**
   * ECR image URI (`<account>.dkr.ecr.<region>.amazonaws.com/oci-web:<sha>`)
   * built and pushed by the GitHub Actions Deploy workflow.
   * When undefined (local synth), falls back to a public placeholder.
   */
  webImage?: string;
}

/**
 * Next.js (App Router, RSC) on ECS Fargate, sharing the cluster + ALB with
 * the API. Path-based routing on the existing HTTPS listener:
 *
 *   /v2/* | /health | /docs | /docs/*   →  API target group  (priority 100)
 *   anything else                       →  Web target group  (default)
 *
 * Listener default action is overridden via CFN escape hatch — the
 * ApiStack's `ApplicationLoadBalancedFargateService` initially set the
 * default to the API TG; we flip it here.
 */
export class WebStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // Task + service definitions. Same Fargate Spot/On-Demand mix as the API.
    const taskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
      cpu: props.cfg.fargate.cpu,
      memoryLimitMiB: props.cfg.fargate.memory,
      runtimePlatform: {
        // Graviton (ARM64) — match api-stack. ~20% Fargate cost saving.
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    taskDef.addContainer('web', {
      image: this.resolveWebImage(props.webImage),
      containerName: 'web',
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production',
        OCI_ENV: props.cfg.envName,
        // Internal HTTPS URL the web app uses to reach the API. Both
        // services share the same hostname; routing is path-based.
        NEXT_PUBLIC_API_BASE_URL: `https://${props.cfg.domainName}`,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup: props.logGroup }),
    });

    this.service = new ecs.FargateService(this, 'WebService', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      desiredCount: props.cfg.fargate.minTasks,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      enableExecuteCommand: false,
    });

    // Auto-scaling — same shape as API.
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: props.cfg.fargate.minTasks,
      maxCapacity: props.cfg.fargate.maxTasks,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 60 });
    scaling.scaleOnMemoryUtilization('MemoryScaling', { targetUtilizationPercent: 70 });

    // Web target group on port 3000 with a root health check (the Next.js
    // home page returns 200; no dedicated /health route on the web side).
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'WebTargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    this.service.attachToApplicationTargetGroup(this.targetGroup);

    // Catch-all listener rule for everything API paths don't claim. ApiStack
    // owns the priority-50 rule for /v2/*, /health, /docs/*; this priority-100
    // rule for /* gets everything else (effectively the default route, but
    // without mutating ApiStack's listener defaultAction — keeping the api
    // and web stacks dependency-acyclic).
    new elbv2.ApplicationListenerRule(this, 'WebCatchAll', {
      listener: props.httpsListener,
      priority: 100,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      action: elbv2.ListenerAction.forward([this.targetGroup]),
    });

    new cdk.CfnOutput(this, 'WebUrl', { value: `https://${props.cfg.domainName}` });

    NagSuppressions.addResourceSuppressions(
      taskDef,
      [
        {
          id: 'AwsSolutions-ECS2',
          reason:
            'Plaintext envs on the Web task are non-secret build/runtime configuration only (NODE_ENV, OCI_ENV, NEXT_PUBLIC_API_BASE_URL is a public URL). No secrets injected via task env.',
        },
      ],
      true,
    );
    if (props.webImage) {
      // ECR pull permissions — same shape as ApiStack's suppression.
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/WebTaskDef/ExecutionRole/DefaultPolicy/Resource`,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'ecr:GetAuthorizationToken does not support resource scoping; AWS requires Resource::*. Per-repo actions are scoped by fromEcrRepository to the imported oci-web repo ARN.',
            appliesTo: ['Resource::*', 'Action::ecr:GetAuthorizationToken'],
          },
        ],
      );
    }
  }

  /**
   * ECR image via fromEcrRepository (auto-grants pull) when an explicit
   * URI is supplied; otherwise a public nginx placeholder so local synth
   * still works without a deploy context.
   */
  private resolveWebImage(webImage: string | undefined): ecs.ContainerImage {
    if (!webImage) {
      return ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:alpine');
    }
    const colon = webImage.lastIndexOf(':');
    const slash = webImage.lastIndexOf('/');
    if (colon <= slash) {
      throw new Error(
        `webImage "${webImage}" is missing a tag; expected "<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>"`,
      );
    }
    const tag = webImage.slice(colon + 1);
    const repoName = webImage.slice(slash + 1, colon);
    const repo = ecr.Repository.fromRepositoryName(this, 'WebRepoRef', repoName);
    return ecs.ContainerImage.fromEcrRepository(repo, tag);
  }
}
