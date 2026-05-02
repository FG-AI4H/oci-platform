import * as cdk from 'aws-cdk-lib';

export type EnvName = 'dev' | 'int' | 'prod';

export interface OciEnvConfig {
  env: cdk.Environment;
  envName: EnvName;
  domainName: string;
  removalPolicy: cdk.RemovalPolicy;
  /** Aurora capacity (Aurora Serverless v2 ACUs) */
  aurora: {
    minCapacity: number;
    maxCapacity: number;
    multiAz: boolean;
    deletionProtection: boolean;
  };
  /** ECS Fargate scaling */
  fargate: { minTasks: number; maxTasks: number; cpu: number; memory: number };
  /** Backups & retention */
  backupRetentionDays: number;
  /** Whether prod-grade monitoring (X-Ray, Container Insights, alarms) is on */
  enhancedMonitoring: boolean;
  /** Whether WAF is attached to the public ALB / CloudFront */
  enableWaf: boolean;
}

const COMMON: Pick<OciEnvConfig, 'env'> = {
  env: { account: '601883093460', region: 'eu-central-1' },
};

const ENVIRONMENTS: Record<EnvName, Omit<OciEnvConfig, 'envName'>> = {
  dev: {
    ...COMMON,
    domainName: 'dev.oci.aiaudit.org',
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    aurora: { minCapacity: 0.5, maxCapacity: 2, multiAz: false, deletionProtection: false },
    fargate: { minTasks: 1, maxTasks: 2, cpu: 512, memory: 1024 },
    backupRetentionDays: 1,
    enhancedMonitoring: false,
    enableWaf: false,
  },
  int: {
    ...COMMON,
    domainName: 'int.oci.aiaudit.org',
    removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    aurora: { minCapacity: 0.5, maxCapacity: 4, multiAz: true, deletionProtection: false },
    fargate: { minTasks: 2, maxTasks: 4, cpu: 1024, memory: 2048 },
    backupRetentionDays: 7,
    enhancedMonitoring: true,
    enableWaf: true,
  },
  prod: {
    ...COMMON,
    domainName: 'oci.aiaudit.org',
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    aurora: { minCapacity: 1, maxCapacity: 16, multiAz: true, deletionProtection: true },
    fargate: { minTasks: 3, maxTasks: 12, cpu: 2048, memory: 4096 },
    backupRetentionDays: 35,
    enhancedMonitoring: true,
    enableWaf: true,
  },
};

export function resolveEnvironment(name: string, _app: cdk.App): OciEnvConfig {
  if (!(name in ENVIRONMENTS)) {
    throw new Error(`Unknown env "${name}". Use one of: dev, int, prod`);
  }
  const cfg = ENVIRONMENTS[name as EnvName];
  return { ...cfg, envName: name as EnvName };
}
