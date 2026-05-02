import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import type { OciEnvConfig } from './environments.js';

export interface ObservabilityStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
}

/**
 * Centralised log groups + SNS topic for alarms.
 * Container Insights, X-Ray, and per-service alarms live in their own stacks.
 */
export class ObservabilityStack extends cdk.Stack {
  public readonly apiLogGroup: logs.LogGroup;
  public readonly workerLogGroup: logs.LogGroup;
  public readonly alarmsTopic: sns.Topic;

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

    this.alarmsTopic = new sns.Topic(this, 'Alarms', {
      displayName: `OCI ${props.cfg.envName} alarms`,
    });

    new cdk.CfnOutput(this, 'ApiLogGroupName', { value: this.apiLogGroup.logGroupName });
    new cdk.CfnOutput(this, 'AlarmsTopicArn', { value: this.alarmsTopic.topicArn });
  }
}
