import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface BootstrapOidcStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  /** GitHub org/repo allowed to assume this role, e.g. `FG-AI4H/oci-platform` */
  githubRepo: string;
}

/**
 * Per-environment bootstrap. Creates:
 *
 * - The `gha-oci-deploy-{env}` IAM role assumable from `FG-AI4H/oci-platform`
 *   when running under GitHub Environment `{env}`.
 * - ECR repositories `oci-api`, `oci-web`, `oci-worker-ingest`,
 *   `oci-migrate`, `oci-smtp-relay` (image scanning on push, IMMUTABLE
 *   tags, KMS).
 *
 * The OIDC provider this role trusts is account-scoped and lives in
 * `SharedBootstrapStack`. This stack only LOOKS UP the provider by its
 * well-known ARN — never creates it. (Until a previous iteration, the
 * provider lived here behind a `createOidcProvider` context flag; if an
 * operator forgot the flag on any subsequent deploy, the synth produced
 * a template without the provider and CFN deleted it. Moving the
 * provider to its own permanent stack eliminates that footgun.)
 *
 * Deploy order:
 *   1. ONCE per AWS account: oci-shared-bootstrap (creates OIDC provider).
 *   2. ONCE per env:        oci-{env}-bootstrap (this stack, creates role + ECR repos).
 *   3. Routine deploys:     CI workflow (excludes both bootstrap stacks).
 */
export class BootstrapOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;
  public readonly apiRepo: ecr.Repository;
  public readonly webRepo: ecr.Repository;
  public readonly workerIngestRepo: ecr.Repository;
  public readonly migrateRepo: ecr.Repository;
  public readonly smtpRelayRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: BootstrapOidcStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // OIDC provider lives in oci-shared-bootstrap. Lookup by well-known ARN
    // (account-scoped, deterministic). If the lookup ARN points at a missing
    // provider, the gha-oci-deploy-{env} role won't be assumable — operator
    // must deploy oci-shared-bootstrap first.
    const providerArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;
    const oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GhOidc',
      providerArn,
    );

    const subjectClaim = `repo:${props.githubRepo}:environment:${props.cfg.envName}`;

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: `gha-oci-deploy-${props.cfg.envName}`,
      description: `GitHub Actions deploy role for ${props.githubRepo} -> ${props.cfg.envName}`,
      assumedBy: new iam.OpenIdConnectPrincipal(oidcProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': subjectClaim,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Phase A2 narrowing: replace PowerUserAccess + iam:* with the AWS-
    // recommended minimal policy for a CDK deploy role. The heavy lifting
    // (creating IAM roles, RDS, ECS, etc.) is done by the cdk-bootstrap
    // execution role (`cdk-hnb659fds-cfn-exec-role-*`), which CDK assumes
    // via the deploy / file-publishing / image-publishing roles. This role
    // only needs to (a) assume those CDK roles, (b) push to our ECR repos
    // (the workflow does this directly, before `cdk deploy`), and
    // (c) read CloudFormation/SSM bootstrap state.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrAuth',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrPushOciRepos',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:CompleteLayerUpload',
          'ecr:InitiateLayerUpload',
          'ecr:PutImage',
          'ecr:UploadLayerPart',
          'ecr:BatchGetImage',
          'ecr:DescribeImages',
          'ecr:DescribeRepositories',
          'ecr:GetDownloadUrlForLayer',
        ],
        resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/oci-*`],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFormationRead',
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeStackResources',
          'cloudformation:GetTemplate',
          'cloudformation:GetTemplateSummary',
          'cloudformation:ListStacks',
        ],
        resources: ['*'],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapSsmRead',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`,
          // Migrate task launch spec (cluster, taskDef, subnets, sg) is
          // read once per deploy by the workflow's DB migrate step.
          `arn:aws:ssm:${this.region}:${this.account}:parameter/oci/*/migrate/launch-spec`,
        ],
      }),
    );

    // Run the one-shot Prisma migrate task after `cdk deploy`. Scoped to
    // the per-env cluster + task-def families produced by api-stack
    // (`oci-{env}-api/cluster` and the auto-generated MigrateTaskDef
    // family which inherits the stack's prefix).
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsRunMigrateTask',
        actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:StopTask'],
        resources: [
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/*`,
          `arn:aws:ecs:${this.region}:${this.account}:task/*`,
        ],
      }),
    );
    // ECS RunTask requires PassRole on both the execution and task roles
    // referenced by the task definition. Both are auto-named by CDK with
    // the stack's prefix, so we scope by that pattern.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassRoleToMigrateTask',
        actions: ['iam:PassRole'],
        resources: [`arn:aws:iam::${this.account}:role/oci-*-api-MigrateTaskDef*`],
        conditions: {
          StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
        },
      }),
    );

    // Read the migrate task's CloudWatch stream on failure. The Deploy
    // workflow's "DB migrate" step dumps the failing task's container
    // logs inline before exiting (PR #273) so the operator doesn't have
    // to round-trip to the console for every iteration. Scoped to the
    // api stack's log group (`/oci/<env>/api`) — the migrate task writes
    // here too because MigrateTaskDef shares the API log group.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadMigrateLogs',
        actions: ['logs:GetLogEvents', 'logs:DescribeLogStreams'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/oci/*/api`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/oci/*/api:log-stream:migrate/*`,
        ],
      }),
    );

    // ECR repositories. Image scan on push, lifecycle keeps last 20.
    const repoDefaults: Partial<ecr.RepositoryProps> = {
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      removalPolicy: props.cfg.removalPolicy,
      lifecycleRules: [{ maxImageCount: 20, rulePriority: 1, tagStatus: ecr.TagStatus.ANY }],
      encryption: ecr.RepositoryEncryption.KMS,
    };

    this.apiRepo = new ecr.Repository(this, 'ApiRepo', {
      ...repoDefaults,
      repositoryName: 'oci-api',
    });

    this.webRepo = new ecr.Repository(this, 'WebRepo', {
      ...repoDefaults,
      repositoryName: 'oci-web',
    });

    this.workerIngestRepo = new ecr.Repository(this, 'WorkerIngestRepo', {
      ...repoDefaults,
      repositoryName: 'oci-worker-ingest',
    });

    this.migrateRepo = new ecr.Repository(this, 'MigrateRepo', {
      ...repoDefaults,
      repositoryName: 'oci-migrate',
    });

    this.smtpRelayRepo = new ecr.Repository(this, 'SmtpRelayRepo', {
      ...repoDefaults,
      repositoryName: 'oci-smtp-relay',
    });

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn });
    new cdk.CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WebRepoUri', { value: this.webRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WorkerIngestRepoUri', { value: this.workerIngestRepo.repositoryUri });
    new cdk.CfnOutput(this, 'MigrateRepoUri', { value: this.migrateRepo.repositoryUri });
    new cdk.CfnOutput(this, 'SmtpRelayRepoUri', { value: this.smtpRelayRepo.repositoryUri });

    NagSuppressions.addResourceSuppressions(
      this.deployRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Path-prefix wildcards are intentional and tightly scoped: cdk-hnb659fds-* matches CDK bootstrap roles (deploy, file-publishing, image-publishing, lookup); oci-* matches our ECR repos (oci-api, oci-web, oci-worker-ingest, oci-migrate) and the auto-generated MigrateTaskDef IAM roles in api-stack; /cdk-bootstrap/* matches CDK bootstrap SSM parameters; /oci/*/migrate/launch-spec is the per-env aggregated launch spec for the prisma migrate task; /oci/*/api log-group + migrate/* log-streams are how the Deploy workflow surfaces failing migrate-task container logs to the GHA job output; ecs:RunTask / DescribeTasks / StopTask use task-definition/* and task/* because task definition revisions and task ids are not knowable until run-time. ecr:GetAuthorizationToken and cloudformation:Describe*/List*/GetTemplate do not support per-resource scoping (AWS API limitation, account-scope only).',
          appliesTo: [
            'Resource::*',
            `Resource::arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`,
            `Resource::arn:aws:iam::${this.account}:role/oci-*-api-MigrateTaskDef*`,
            `Resource::arn:aws:ecr:${this.region}:${this.account}:repository/oci-*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/oci/*/migrate/launch-spec`,
            `Resource::arn:aws:ecs:${this.region}:${this.account}:task-definition/*`,
            `Resource::arn:aws:ecs:${this.region}:${this.account}:task/*`,
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/oci/*/api`,
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/oci/*/api:log-stream:migrate/*`,
            'Action::ecr:GetAuthorizationToken',
            'Action::cloudformation:DescribeStacks',
            'Action::cloudformation:DescribeStackEvents',
            'Action::cloudformation:DescribeStackResources',
            'Action::cloudformation:GetTemplate',
            'Action::cloudformation:GetTemplateSummary',
            'Action::cloudformation:ListStacks',
          ],
        },
      ],
      true,
    );
  }
}
