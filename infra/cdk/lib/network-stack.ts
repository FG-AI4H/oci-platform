import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import type { OciEnvConfig } from './environments.js';

export interface NetworkStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
}

/**
 * VPC + flow logs.
 *
 * Reliability pillar (Well-Architected): 3 AZs, NAT per AZ in prod, single NAT in dev.
 * Security pillar: VPC flow logs to CloudWatch (rejected + accepted in prod).
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 3,
      natGateways: props.cfg.envName === 'prod' ? 3 : 1,
      ipAddresses: ec2.IpAddresses.cidr('10.10.0.0/16'),
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      flowLogs: {
        cloudwatch: {
          trafficType: props.cfg.envName === 'prod' ? ec2.FlowLogTrafficType.ALL : ec2.FlowLogTrafficType.REJECT,
        },
      },
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
  }
}
