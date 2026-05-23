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
  /** Whether WAF is attached to the public ALB (int/prod only). */
  enableWaf: boolean;
}

const COMMON: Pick<OciEnvConfig, 'env'> = {
  env: { account: '601883093460', region: 'eu-central-1' },
};

const ENVIRONMENTS: Record<EnvName, Omit<OciEnvConfig, 'envName'>> = {
  dev: {
    ...COMMON,
    domainName: 'dev.oci.ai4h.net',
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    // deletionProtection: true even in dev — Security Hub RDS.7 enforces it
    // account-wide, and the cost of accidental destruction is non-zero even
    // when the data is non-prod. To tear the stack down intentionally, flip
    // this to false via a one-shot CDK deploy first, then `cdk destroy`.
    aurora: { minCapacity: 0.5, maxCapacity: 2, multiAz: false, deletionProtection: true },
    fargate: { minTasks: 1, maxTasks: 2, cpu: 512, memory: 1024 },
    // 7 days is the Security Hub RDS.50 default threshold. Cost impact on a
    // sub-2-ACU dev cluster is negligible (<$1/month for backup storage
    // beyond the cluster size).
    backupRetentionDays: 7,
    enhancedMonitoring: false,
    enableWaf: false,
  },
  int: {
    ...COMMON,
    domainName: 'int.oci.ai4h.net',
    removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    aurora: { minCapacity: 0.5, maxCapacity: 4, multiAz: true, deletionProtection: true },
    fargate: { minTasks: 2, maxTasks: 4, cpu: 1024, memory: 2048 },
    backupRetentionDays: 7,
    enhancedMonitoring: true,
    enableWaf: true,
  },
  prod: {
    ...COMMON,
    domainName: 'oci.ai4h.net',
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
