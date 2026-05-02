import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import type { OciEnvConfig } from './environments.js';

export interface DataStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  vpc: ec2.IVpc;
}

/**
 * Aurora Postgres Serverless v2 (encrypted) + S3 buckets (KMS, versioned, public-block-on).
 *
 * Reliability: multi-AZ in int/prod, automated backups, snapshot retention.
 * Security: KMS CMK, no public access, audit logging to CloudWatch.
 * Performance: Performance Insights on int/prod.
 * Cost: Serverless v2 scales to zero in dev (min 0.5 ACU).
 */
export class DataStack extends cdk.Stack {
  public readonly database: rds.DatabaseCluster;
  public readonly mediaBucket: s3.Bucket;
  public readonly artifactBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const cmk = new kms.Key(this, 'DataKey', {
      enableKeyRotation: true,
      removalPolicy: props.cfg.removalPolicy,
      alias: `oci/${props.cfg.envName}/data`,
    });

    this.database = new rds.DatabaseCluster(this, 'Aurora', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      defaultDatabaseName: `oci_${props.cfg.envName}`,
      serverlessV2MinCapacity: props.cfg.aurora.minCapacity,
      serverlessV2MaxCapacity: props.cfg.aurora.maxCapacity,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
        enablePerformanceInsights: props.cfg.enhancedMonitoring,
      }),
      readers: props.cfg.aurora.multiAz
        ? [rds.ClusterInstance.serverlessV2('reader-1', { scaleWithWriter: true })]
        : [],
      storageEncrypted: true,
      storageEncryptionKey: cmk,
      backup: {
        retention: cdk.Duration.days(props.cfg.backupRetentionDays),
        preferredWindow: '02:00-03:00',
      },
      cloudwatchLogsExports: ['postgresql'],
      monitoringInterval: props.cfg.enhancedMonitoring ? cdk.Duration.seconds(15) : undefined,
      deletionProtection: props.cfg.aurora.deletionProtection,
      iamAuthentication: true,
      removalPolicy: props.cfg.removalPolicy,
    });

    // Buckets
    const bucketDefaults: Partial<s3.BucketProps> = {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: cmk,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: props.cfg.removalPolicy,
      autoDeleteObjects: props.cfg.envName === 'dev',
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    };

    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      ...bucketDefaults,
      bucketName: `oci-${props.cfg.envName}-media-${this.account}`,
      lifecycleRules: [
        {
          id: 'expire-noncurrent',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      ...bucketDefaults,
      bucketName: `oci-${props.cfg.envName}-artifacts-${this.account}`,
      objectLockEnabled: props.cfg.envName === 'prod',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', { value: this.database.clusterEndpoint.hostname });
    new cdk.CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
    new cdk.CfnOutput(this, 'ArtifactBucketName', { value: this.artifactBucket.bucketName });
  }
}
