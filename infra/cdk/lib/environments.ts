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
  /**
   * Sealed-execution runner (`apps/worker-eval`, ADR-0018 Mode 2). Sizes the
   * runner task and defines the operational envelope the SQS visibility
   * timeout is derived from — see `lib/eval-stack.ts`.
   */
  evalRunner: {
    /** Fargate task size for the runner itself. Must be a valid Fargate cpu/memory pair. */
    cpu: number;
    memory: number;
    /**
     * Task ephemeral storage (GiB, 21-200). Sized for pulling a participant
     * image by digest and discarding it.
     */
    ephemeralStorageGiB: number;
    /**
     * Hard wall-clock cap for one sealed run, in seconds. Ceiling for a
     * task's `timeoutSec`; the queue's visibility timeout is derived from it.
     */
    maxRunSeconds: number;
    /** Caps the runner applies to the participant container (contract §4). */
    sandbox: {
      memoryMiB: number;
      cpus: number;
      pidsLimit: number;
      /** Size cap on the `/output` tmpfs — the "predictions" exfiltration bound. */
      outputTmpfsMiB: number;
    };
  };
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
    // Sealed execution on dev carries the IDRiD demo slice and the
    // malicious-image test matrix. `maxRunSeconds` is deliberately the same
    // 1800 s as the API-side platform default
    // (`DEFAULT_SEALED_RUN_TIMEOUT_SEC` in apps/api evaluation/sealed-run.ts),
    // which api-stack also passes back as `OCI_EVAL_RUN_TIMEOUT_SEC`: a
    // dispatched `timeoutSec` above this env's cap would exceed the queue's
    // visibility timeout and get a healthy run redelivered.
    evalRunner: {
      cpu: 1024,
      memory: 2048,
      ephemeralStorageGiB: 21,
      maxRunSeconds: 1800,
      sandbox: { memoryMiB: 1024, cpus: 0.5, pidsLimit: 256, outputTmpfsMiB: 256 },
    },
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
    // int rehearses the real challenge envelope at the platform default run
    // cap, with prod's double sizing for the runner itself.
    evalRunner: {
      cpu: 2048,
      memory: 4096,
      ephemeralStorageGiB: 40,
      maxRunSeconds: 1800,
      sandbox: { memoryMiB: 2048, cpus: 1, pidsLimit: 512, outputTmpfsMiB: 512 },
    },
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
    // prod carries competitive submissions: an hour of wall clock, 6 GiB and
    // 2 vCPU for the participant container, 2 GiB left for the runner. The
    // derived visibility timeout (3600 + 600 pull + 120 outbox = 4320 s) is
    // well inside the SQS 43200 s ceiling, leaving headroom to raise the
    // envelope without changing the queue model.
    evalRunner: {
      cpu: 4096,
      memory: 8192,
      ephemeralStorageGiB: 60,
      maxRunSeconds: 3600,
      sandbox: { memoryMiB: 6144, cpus: 2, pidsLimit: 1024, outputTmpfsMiB: 1024 },
    },
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
