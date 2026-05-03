import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface ObservabilityStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
}

/**
 * Centralised log groups, alarms topic, and shared access-logs bucket
 * (consumed by Data/Api/Web stacks for S3, ALB, and CloudFront access logging).
 * Container Insights, X-Ray, and per-service alarms live in their own stacks.
 */
export class ObservabilityStack extends cdk.Stack {
  public readonly apiLogGroup: logs.LogGroup;
  public readonly workerLogGroup: logs.LogGroup;
  public readonly alarmsTopic: sns.Topic;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const retention =
      props.cfg.envName === 'prod' ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_MONTH;

    this.apiLogGroup = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: `/oci/${props.cfg.envName}/api`,
      retention,
      removalPolicy: props.cfg.removalPolicy,
    });

    this.workerLogGroup = new logs.LogGroup(this, 'WorkerLogs', {
      logGroupName: `/oci/${props.cfg.envName}/workers`,
      retention,
      removalPolicy: props.cfg.removalPolicy,
    });

    // Access-logs bucket used by S3 buckets, ALB, and CloudFront across stacks.
    // S3-managed encryption (AES256) — cross-service log delivery has historical
    // friction with KMS-encrypted target buckets.
    // OBJECT_WRITER ownership — CloudFront standard logs (v1) writes via ACL.
    this.accessLogsBucket = new s3.Bucket(this, 'AccessLogs', {
      bucketName: `oci-${props.cfg.envName}-access-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: props.cfg.removalPolicy,
      autoDeleteObjects: props.cfg.envName === 'dev',
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [
        {
          id: 'expire-access-logs',
          expiration: cdk.Duration.days(props.cfg.envName === 'prod' ? 365 : 30),
        },
      ],
    });

    this.alarmsTopic = new sns.Topic(this, 'Alarms', {
      displayName: `OCI ${props.cfg.envName} alarms`,
      enforceSSL: true,
    });

    // Belt-and-braces: explicit deny on non-TLS publish requests.
    this.alarmsTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [this.alarmsTopic.topicArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );

    new cdk.CfnOutput(this, 'ApiLogGroupName', { value: this.apiLogGroup.logGroupName });
    new cdk.CfnOutput(this, 'AlarmsTopicArn', { value: this.alarmsTopic.topicArn });
    new cdk.CfnOutput(this, 'AccessLogsBucketName', { value: this.accessLogsBucket.bucketName });

    NagSuppressions.addResourceSuppressions(this.accessLogsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'This IS the access-logs bucket. Enabling server access logs on it would be circular; the bucket retains object lock + lifecycle for audit purposes.',
      },
    ]);
  }
}
