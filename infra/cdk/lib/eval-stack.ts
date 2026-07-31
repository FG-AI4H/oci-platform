import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';
import { grantGuardDutyAgentEcrPull } from './api-stack.js';

/**
 * CloudWatch namespace the runner publishes per-run metrics into. Declared
 * here (not in the runner) because the alarm below and the runner's env var
 * must not drift.
 */
const METRICS_NAMESPACE = 'OCI/Evaluation';
/** Wall-clock duration of one sealed run, in seconds. */
const RUN_DURATION_METRIC = 'RunDurationSeconds';

/**
 * Time allowed for pulling the participant image by digest before the run
 * itself starts. Participant images carry model weights and are routinely
 * multi-GB; 10 minutes covers a cold pull of a ~10 GB image over the NAT
 * gateway. Added to `maxRunSeconds` when deriving the visibility timeout.
 */
const IMAGE_PULL_ALLOWANCE_SECONDS = 600;
/**
 * Time allowed after the run for reading `/output/predictions.json`,
 * classifying failures, and POSTing the outbox result (plus retries).
 */
const OUTBOX_POST_ALLOWANCE_SECONDS = 120;
/** SQS hard limit on `VisibilityTimeout` (12 h). Not configurable by us. */
const SQS_MAX_VISIBILITY_TIMEOUT_SECONDS = 43200;

export interface EvalStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  /**
   * Shared worker log group (`/oci/{env}/workers`) from observability-stack.
   * The runner's own stdout goes here; so does the *captured* participant
   * stdout/stderr, which is operator-only and must never be echoed back to
   * the participant (sealed-execution contract §4).
   */
  logGroup: logs.ILogGroup;
  /** Shared alarms topic from observability-stack. */
  alarmsTopic: sns.ITopic;
  /**
   * ECR image URI for the sealed-execution runner
   * (`<account>.dkr.ecr.<region>.amazonaws.com/oci-worker-eval:<sha>`).
   * `apps/worker-eval` is a README at the time of writing (WP1), so when
   * this is undefined the task definition still renders against a public
   * placeholder image — the queue, IAM and alarms are the deliverable and
   * must be deployable before the runner exists.
   */
  workerEvalImage?: string;
}

/**
 * Sealed-execution plumbing for the GI-AI4H benchmarking challenge
 * (ADR-0018 Mode 2; `docs/planning/evaluation-challenge-2026-08/`).
 *
 * Owns exactly four things — the cross-service boundary between the API and
 * the runner, and nothing that participant-facing code depends on:
 *
 *  1. `oci-eval-submissions-{env}` + its dead-letter queue (CMK-encrypted,
 *     TLS-only, redrive after 3 attempts).
 *  2. The Fargate task definition for `apps/worker-eval`, sized from
 *     `cfg.evalRunner` and carrying the sandbox envelope as explicit
 *     environment so the controls are auditable in the task definition
 *     rather than buried in the runner.
 *  3. A task role scoped to *exactly* that queue pair plus the outbox
 *     credential — this is the security boundary for executing third-party
 *     containers, so every statement names its resource.
 *  4. Alarms on DLQ depth, queue age, and run duration, wired to the
 *     shared SNS alarms topic.
 *
 * Deliberately NOT here:
 *
 *  - No ECS service. The task definition is deployable-but-unused until WP1
 *    ships the runner and decides service-vs-`run-task`; a service with no
 *    image would crash-loop.
 *  - No S3 grant. `/input` is host-resident per the contract. If WP1 chooses
 *    to stage evaluation inputs from the datasets bucket instead, that grant
 *    is an explicit, reviewed addition — not something pre-granted to a task
 *    that executes third-party code.
 *  - No ground-truth access of any kind. Scoring happens API-side
 *    (contract §1); the sandbox never sees labels.
 *
 * ## Nested-container execution is an open WP1 decision
 *
 * Contract §4 is written in terms of `docker run` flags. AWS Fargate does not
 * expose a Docker daemon or allow privileged containers, so a Fargate runner
 * cannot itself `docker run` the participant image. The two viable shapes are
 * (a) an ECS EC2 capacity provider whose instances expose a Docker daemon to
 * the runner, or (b) launching each participant image as its own task and
 * mapping the §4 controls onto task-definition equivalents (isolated subnet
 * with no egress, `readonlyRootFilesystem`, dropped capabilities, non-root
 * user, task-level memory/CPU caps). Both change the runtime substrate, not
 * this queue/IAM boundary, which is why WP2 ships the boundary now and leaves
 * the substrate to WP1. The task definition below is the (b)-shaped host:
 * Fargate, x86_64, sized for a run, with the envelope passed as config.
 *
 * ## Which side enforces which §4 control
 *
 * | Control                                   | Enforced by                                    |
 * | ----------------------------------------- | ---------------------------------------------- |
 * | `--network none`                          | runner, at `docker run` (`OCI_SANDBOX_NETWORK_MODE`) |
 * | read-only rootfs, `/output` only writable | runner, at `docker run` (`--read-only`, tmpfs mount) |
 * | non-root, `--cap-drop ALL`, no-new-privs  | runner, at `docker run`                        |
 * | memory / CPU / pids caps                  | runner per-run, from `OCI_SANDBOX_*`; bounded above by this task's cpu/memory |
 * | wall-clock timeout, hard kill             | runner, from `OCI_EVAL_MAX_RUN_SECONDS`; backstopped by the queue's visibility timeout |
 * | pull + run by digest only                 | runner (`OCI_SANDBOX_REQUIRE_DIGEST`)          |
 * | no host path / socket / device mounts     | runner; nothing here mounts a volume           |
 * | container removed + image pruned          | runner (`OCI_SANDBOX_PRUNE_IMAGE_AFTER_RUN`); ephemeral storage is per-task and discarded |
 * | `/output` size cap                        | runner, tmpfs size (`OCI_SANDBOX_OUTPUT_TMPFS_MIB`) |
 * | stdout/stderr captured, never returned    | runner + API; this stack only provides the operator-side log group |
 */
export class EvalStack extends cdk.Stack {
  /** `oci-eval-submissions-{env}` — the API publishes, the runner consumes. */
  public readonly submissionQueue: sqs.Queue;
  /** Redrive target after 3 receives; a message here means `FAILED`. */
  public readonly deadLetterQueue: sqs.Queue;
  /** CMK for the queues and the outbox credential. */
  public readonly encryptionKey: kms.Key;
  /** Runner task definition (deployable-but-unused until WP1). */
  public readonly runnerTaskDefinition: ecs.FargateTaskDefinition;
  /**
   * Credential the runner exchanges for a Cognito bearer token when POSTing
   * to the outbox (contract §5). Created here so the task role's grant names
   * an exact ARN instead of a `secret:NAME-??????` wildcard; the value is a
   * generated placeholder until WP3 replaces it with the machine-to-machine
   * client id / secret.
   */
  public readonly outboxCredential: secretsmanager.Secret;
  /** Visibility timeout actually applied, in seconds (see derivation below). */
  public readonly visibilityTimeoutSeconds: number;

  constructor(scope: Construct, id: string, props: EvalStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const envName = props.cfg.envName;
    const runner = props.cfg.evalRunner;
    const removalPolicy = stateRemovalPolicy(props.cfg);

    // ----------------------------------------------------------------------
    // Visibility timeout derivation (contract §2: "must exceed `timeoutSec`
    // plus pull time").
    //
    //   visibilityTimeout = maxRunSeconds        (per-env operational envelope)
    //                     + 600 s image pull     (cold multi-GB pull by digest)
    //                     + 120 s outbox POST    (read /output, classify, POST)
    //
    // `maxRunSeconds` — not the message's `timeoutSec` — is the number used
    // on purpose. The message schema permits `timeoutSec` up to 86400, which
    // is twice SQS's hard 43200 s ceiling on VisibilityTimeout, so a queue
    // can never cover the schema maximum. The per-env envelope here is the
    // real cap, and both ends read it from the same place: api-stack passes
    // `cfg.evalRunner.maxRunSeconds` to the API as `OCI_EVAL_RUN_TIMEOUT_SEC`
    // (the `timeoutSec` it dispatches) and this stack passes it to the runner
    // as `OCI_EVAL_MAX_RUN_SECONDS` (the wall clock it kills at), so the
    // dispatched timeout cannot exceed the window that protects it. The
    // assertion below keeps the derived timeout inside the SQS limit.
    //
    // Result: dev 2520 s (42 min), int 2520 s (42 min), prod 4320 s (72 min) —
    // dev and int both sit at the 1800 s platform run cap, prod doubles it.
    //
    // Retention must also outlast a full redrive cycle
    // (maxReceiveCount x visibilityTimeout = 3 x 4320 s = 3.6 h in prod), or
    // a message could expire mid-retry and never reach the DLQ. 4 days is
    // two orders of magnitude clear of that.
    // ----------------------------------------------------------------------
    this.visibilityTimeoutSeconds =
      runner.maxRunSeconds + IMAGE_PULL_ALLOWANCE_SECONDS + OUTBOX_POST_ALLOWANCE_SECONDS;
    if (this.visibilityTimeoutSeconds > SQS_MAX_VISIBILITY_TIMEOUT_SECONDS) {
      throw new Error(
        `evalRunner.maxRunSeconds=${runner.maxRunSeconds} for ${envName} derives a visibility ` +
          `timeout of ${this.visibilityTimeoutSeconds}s, above the SQS maximum of ` +
          `${SQS_MAX_VISIBILITY_TIMEOUT_SECONDS}s. Lower maxRunSeconds, or move long runs to a ` +
          `heartbeat model (ChangeMessageVisibility from the runner) before raising it.`,
      );
    }

    this.encryptionKey = new kms.Key(this, 'EvalKey', {
      enableKeyRotation: true,
      removalPolicy,
      alias: `oci/${envName}/eval`,
      description: `CMK for the ${envName} sealed-execution queue pair and outbox credential`,
    });

    // ----------------------------------------------------------------------
    // Queues. Standard (not FIFO): delivery is at-least-once and the outbox
    // is idempotent by contract §5, so ordering buys nothing and FIFO's
    // per-group throughput cap would serialise unrelated submissions.
    // ----------------------------------------------------------------------
    this.deadLetterQueue = new sqs.Queue(this, 'SubmissionsDlq', {
      queueName: `oci-eval-submissions-${envName}-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey,
      enforceSSL: true,
      // Max retention. A poisoned or malicious submission is evidence: the
      // operator needs the message body to reproduce it, and the DLQ reaper
      // needs time to mark the submission FAILED even across a weekend.
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(300),
      removalPolicy,
    });

    this.submissionQueue = new sqs.Queue(this, 'Submissions', {
      queueName: `oci-eval-submissions-${envName}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey,
      enforceSSL: true,
      visibilityTimeout: cdk.Duration.seconds(this.visibilityTimeoutSeconds),
      retentionPeriod: cdk.Duration.days(4),
      // Long polling: the runner blocks up to 20 s per ReceiveMessage
      // instead of spinning.
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        // Contract §2: redrive after 3 attempts. A message landing in the
        // DLQ marks the submission FAILED with a generic error.
        maxReceiveCount: 3,
      },
      removalPolicy,
    });

    // ----------------------------------------------------------------------
    // Outbox credential. Placeholder value; WP3 / identity own the real
    // Cognito machine-to-machine client. Read by the *task role* at runtime
    // rather than injected as an ECS secret, because the runner is a
    // long-lived consumer that has to survive a credential rotation without
    // a task restart (ECS secrets resolve once, at task launch).
    // ----------------------------------------------------------------------
    // Literal name, reused for the runner's env var so the task definition
    // carries the plain string instead of CDK's parse-the-ARN expression.
    const outboxCredentialName = `/oci/${envName}/eval/outbox-client`;
    this.outboxCredential = new secretsmanager.Secret(this, 'OutboxCredential', {
      secretName: outboxCredentialName,
      description: `Cognito M2M credential the ${envName} eval runner uses to POST /v2/submissions/:id/result`,
      encryptionKey: this.encryptionKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ clientId: 'PLACEHOLDER', tokenEndpoint: '' }),
        generateStringKey: 'clientSecret',
        excludePunctuation: true,
        passwordLength: 40,
      },
      removalPolicy,
    });

    // ----------------------------------------------------------------------
    // Runner task definition. x86_64, unlike every other task definition in
    // this repo (which is ARM64/Graviton for cost): participant images are
    // built by third parties and are overwhelmingly linux/amd64, and a
    // sealed run must not fail on architecture mismatch. The runner shares
    // the substrate with the image it executes, so the runner follows the
    // participants, not our cost preference.
    //
    // Ephemeral storage is sized for pulling a participant image by digest
    // and discarding it; Fargate ephemeral storage is per-task and is not
    // retained between tasks, which reinforces the "image not retained"
    // guarantee at the platform level rather than only in runner code.
    // ----------------------------------------------------------------------
    this.runnerTaskDefinition = new ecs.FargateTaskDefinition(this, 'RunnerTaskDef', {
      cpu: runner.cpu,
      memoryLimitMiB: runner.memory,
      ephemeralStorageGiB: runner.ephemeralStorageGiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.runnerTaskDefinition.addContainer('worker-eval', {
      image: this.resolveWorkerEvalImage(props.workerEvalImage),
      containerName: 'worker-eval',
      essential: true,
      environment: {
        OCI_ENV: envName,
        AWS_REGION: this.region,
        // Inbox / redrive.
        OCI_EVAL_QUEUE_URL: this.submissionQueue.queueUrl,
        OCI_EVAL_DLQ_URL: this.deadLetterQueue.queueUrl,
        // Outbox. Absolute base URL; the message carries the per-submission
        // `callbackUrl`, this is the fallback / validation origin.
        OCI_OUTBOX_BASE_URL: `https://${props.cfg.domainName}`,
        OCI_EVAL_OUTBOX_CREDENTIAL_SECRET: outboxCredentialName,
        // Operational envelope. The runner hard-kills at
        // OCI_EVAL_MAX_RUN_SECONDS; the visibility timeout is published so
        // the runner can heartbeat ChangeMessageVisibility on long runs
        // instead of letting a healthy run be redelivered.
        OCI_EVAL_MAX_RUN_SECONDS: String(runner.maxRunSeconds),
        OCI_EVAL_VISIBILITY_TIMEOUT_SECONDS: String(this.visibilityTimeoutSeconds),
        // Sandbox controls (contract §4). Carried as explicit config so the
        // enforced envelope is visible in the task definition and reviewable
        // per environment, instead of being a constant inside the runner.
        OCI_SANDBOX_NETWORK_MODE: 'none',
        OCI_SANDBOX_MEMORY_MIB: String(runner.sandbox.memoryMiB),
        OCI_SANDBOX_CPUS: String(runner.sandbox.cpus),
        OCI_SANDBOX_PIDS_LIMIT: String(runner.sandbox.pidsLimit),
        OCI_SANDBOX_OUTPUT_TMPFS_MIB: String(runner.sandbox.outputTmpfsMiB),
        OCI_SANDBOX_READONLY_ROOTFS: 'true',
        OCI_SANDBOX_DROP_ALL_CAPABILITIES: 'true',
        OCI_SANDBOX_NO_NEW_PRIVILEGES: 'true',
        OCI_SANDBOX_RUN_AS_NON_ROOT: 'true',
        OCI_SANDBOX_REQUIRE_DIGEST: 'true',
        OCI_SANDBOX_PRUNE_IMAGE_AFTER_RUN: 'true',
        // Metric contract for the run-duration alarm below. Dimension is
        // `Environment=<OCI_ENV>`.
        OCI_METRICS_NAMESPACE: METRICS_NAMESPACE,
        OCI_RUN_DURATION_METRIC: RUN_DURATION_METRIC,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'worker-eval',
        logGroup: props.logGroup,
      }),
    });

    // Cross-account ECR pull for the GuardDuty Runtime Monitoring agent —
    // same as every other task definition in the account.
    grantGuardDutyAgentEcrPull(this.runnerTaskDefinition);

    // ----------------------------------------------------------------------
    // Task role. This is the blast radius of a compromised sealed run, so
    // every statement names its resource: two queues, one secret, one
    // metric namespace. No S3, no database, no Cognito admin, no ECR, no
    // ecs:RunTask, no wildcard resource except the one AWS API that has no
    // resource model (PutMetricData, conditioned on the namespace).
    // ----------------------------------------------------------------------
    const taskRole = this.runnerTaskDefinition.taskRole;

    // sqs:ReceiveMessage, DeleteMessage, ChangeMessageVisibility,
    // GetQueueAttributes, GetQueueUrl — plus kms:Decrypt/Encrypt/
    // GenerateDataKey*/ReEncrypt* on the queues' CMK, which the grant
    // derives from the queue's encryptionMasterKey.
    this.submissionQueue.grantConsumeMessages(taskRole);
    // The DLQ reaper: contract §2 requires a message landing in the DLQ to
    // mark its submission FAILED rather than leaving it stuck PENDING, which
    // means consuming the DLQ, not just observing its depth.
    this.deadLetterQueue.grantConsumeMessages(taskRole);
    // Outbox credential only. secretsmanager:GetSecretValue +
    // DescribeSecret on one ARN.
    this.outboxCredential.grantRead(taskRole);
    // Run metrics. cloudwatch:PutMetricData has no resource model at all
    // (AWS requires "*"), so the namespace condition is the only available
    // scope — it is a real constraint, not decoration: the role cannot
    // publish into any other namespace.
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'PublishEvalRunMetrics',
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': METRICS_NAMESPACE } },
      }),
    );

    // ----------------------------------------------------------------------
    // Alarms → shared SNS topic. Unlike api-stack, these are NOT gated on
    // `enhancedMonitoring`: dev is where the challenge soaks before the
    // 2026-08-21 freeze, a submission stuck in PENDING is exactly the
    // failure this stack exists to make visible, and three alarms cost
    // ~$0.30/month.
    // ----------------------------------------------------------------------
    const alarmAction = new cloudwatchActions.SnsAction(props.alarmsTopic);

    const dlqDepthAlarm = new cloudwatch.Alarm(this, 'DlqNotEmpty', {
      alarmName: `oci-${envName}-eval-dlq-depth`,
      alarmDescription:
        'A sealed-execution submission was redriven to the DLQ after 3 attempts. The submission must be marked FAILED; the message body is the reproduction case.',
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqDepthAlarm.addAlarmAction(alarmAction);

    // Run duration, as reported by the runner. A run reaching ~90% of the
    // envelope is about to be hard-killed as TIMEOUT, which is a finding
    // about the task's envelope (or about the submission) rather than a
    // transient error.
    const runDurationAlarm = new cloudwatch.Alarm(this, 'RunDurationNearCap', {
      alarmName: `oci-${envName}-eval-run-duration`,
      alarmDescription: `A sealed run exceeded 90% of the ${runner.maxRunSeconds}s envelope for ${envName} and is about to be killed as TIMEOUT.`,
      metric: new cloudwatch.Metric({
        namespace: METRICS_NAMESPACE,
        metricName: RUN_DURATION_METRIC,
        dimensionsMap: { Environment: envName },
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: Math.round(runner.maxRunSeconds * 0.9),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      // The metric does not exist until WP1 publishes it; missing data is
      // "no runs", not "breaching".
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    runDurationAlarm.addAlarmAction(alarmAction);

    // Backstop for the case the runner never reports at all: a message
    // older than one full visibility window means either no consumer is
    // running or a run is wedged past its slot.
    const oldestMessageAlarm = new cloudwatch.Alarm(this, 'SubmissionsBacklogAge', {
      alarmName: `oci-${envName}-eval-oldest-message-age`,
      alarmDescription:
        'A submission has been on oci-eval-submissions for longer than one visibility window — the runner is down, wedged, or not keeping up.',
      metric: this.submissionQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: this.visibilityTimeoutSeconds,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    oldestMessageAlarm.addAlarmAction(alarmAction);

    // ----------------------------------------------------------------------
    // Exports. api-stack takes the queue as a prop (CFN export) for the
    // send grant + `OCI_EVAL_QUEUE_URL`; the SSM parameters exist for the
    // EvalAI seam (WP4) and for operators, which read by name and must not
    // depend on a CloudFormation export.
    // ----------------------------------------------------------------------
    new ssm.StringParameter(this, 'QueueUrlParam', {
      parameterName: `/oci/${envName}/eval/queue-url`,
      stringValue: this.submissionQueue.queueUrl,
      description: `Sealed-execution submission queue URL for ${envName}`,
    });
    new ssm.StringParameter(this, 'DlqUrlParam', {
      parameterName: `/oci/${envName}/eval/dlq-url`,
      stringValue: this.deadLetterQueue.queueUrl,
      description: `Sealed-execution dead-letter queue URL for ${envName}`,
    });

    new cdk.CfnOutput(this, 'EvalQueueUrl', { value: this.submissionQueue.queueUrl });
    new cdk.CfnOutput(this, 'EvalQueueArn', { value: this.submissionQueue.queueArn });
    new cdk.CfnOutput(this, 'EvalDlqUrl', { value: this.deadLetterQueue.queueUrl });
    new cdk.CfnOutput(this, 'EvalDlqArn', { value: this.deadLetterQueue.queueArn });
    new cdk.CfnOutput(this, 'EvalVisibilityTimeoutSeconds', {
      value: String(this.visibilityTimeoutSeconds),
    });
    new cdk.CfnOutput(this, 'EvalRunnerTaskDefArn', {
      value: this.runnerTaskDefinition.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, 'EvalOutboxCredentialArn', {
      value: this.outboxCredential.secretArn,
    });

    // ----------------------------------------------------------------------
    // cdk-nag suppressions. Each one is a documented AWS API limitation or
    // an explicit environment decision — nothing here waves through an
    // over-broad grant on the sealed-execution boundary.
    // ----------------------------------------------------------------------

    // AwsSolutions-SQS3 on the DLQ: cdk-nag resolves "is this queue itself a
    // DLQ?" by looking for a sibling queue whose redrive policy targets it,
    // which `Submissions` provides — so the rule passes without suppression.
    // Documented here so a future reader does not "fix" it by giving the DLQ
    // its own DLQ.

    NagSuppressions.addResourceSuppressions(this.outboxCredential, [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'The value is a Cognito user-pool app-client credential, and Cognito exposes no API for Secrets-Manager-driven rotation (same constraint as the web client secret in identity-stack). Rotation is performed by replacing the app client. Until WP3 provisions the real client the value is an unused generated placeholder.',
      },
    ]);

    NagSuppressions.addResourceSuppressions(
      this.runnerTaskDefinition,
      [
        {
          id: 'AwsSolutions-ECS2',
          reason:
            'Every plaintext env var on the runner is non-secret operational policy: the environment name, the queue URLs, the outbox origin, the run-duration envelope, and the sandbox controls from sealed-execution-contract §4. They are deliberately in the task definition so the enforced sandbox envelope is auditable per environment. The single secret (the outbox Cognito M2M credential) is NOT injected as an env var — it is read at runtime from Secrets Manager by the task role, so it never appears in the task definition.',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/RunnerTaskDef/TaskRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'One unavoidable wildcard: cloudwatch:PutMetricData has no resource model in IAM (AWS requires Resource "*"), so the cloudwatch:namespace condition is the only available scope — the role cannot publish outside OCI/Evaluation. Every other statement on this role names an exact ARN: the two eval queues, the outbox credential secret, and kms:Decrypt on this stack\'s single CMK. No resource wildcards on the sealed-execution boundary.',
          appliesTo: ['Resource::*'],
        },
      ],
    );

    if (props.workerEvalImage) {
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${this.stackName}/RunnerTaskDef/ExecutionRole/DefaultPolicy/Resource`,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'ecr:GetAuthorizationToken does not support resource scoping; AWS requires Resource::*. Per-repo actions are scoped by fromEcrRepository to the imported oci-worker-eval repo ARN.',
            appliesTo: ['Resource::*', 'Action::ecr:GetAuthorizationToken'],
          },
        ],
      );
    }
  }

  /**
   * Same parsing rule as api-stack's image resolvers, with a distinct CDK id
   * for the imported ECR repository. Without an explicit image (local synth,
   * and every deploy until WP1 ships `apps/worker-eval`) the task definition
   * renders against a public placeholder so the queue, IAM and alarms can be
   * deployed and diffed today.
   */
  private resolveWorkerEvalImage(image: string | undefined): ecs.ContainerImage {
    if (!image) {
      return ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/python:3.13-slim');
    }
    const colon = image.lastIndexOf(':');
    const slash = image.lastIndexOf('/');
    if (colon <= slash) {
      throw new Error(
        `workerEvalImage "${image}" is missing a tag; expected "<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>"`,
      );
    }
    const tag = image.slice(colon + 1);
    const repoName = image.slice(slash + 1, colon);
    const repo = ecr.Repository.fromRepositoryName(this, 'WorkerEvalRepoRef', repoName);
    return ecs.ContainerImage.fromEcrRepository(repo, tag);
  }
}

/**
 * `environments.ts` sets int to `SNAPSHOT`, but CloudFormation accepts
 * `DeletionPolicy: Snapshot` only on resource types that actually support
 * snapshots (EBS, RDS, ElastiCache, Neptune, Redshift). SQS queues, KMS keys
 * and Secrets Manager secrets do not, so applying it verbatim would be
 * rejected at deploy time. `RETAIN` is the conservative reading of the int
 * intent — never silently destroy state — while dev stays `DESTROY` and prod
 * stays `RETAIN`, matching the environment table in CLAUDE.md.
 */
function stateRemovalPolicy(cfg: OciEnvConfig): cdk.RemovalPolicy {
  return cfg.removalPolicy === cdk.RemovalPolicy.SNAPSHOT
    ? cdk.RemovalPolicy.RETAIN
    : cfg.removalPolicy;
}
