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
  /**
   * If true, this stack creates the GitHub Actions OIDC provider in the
   * AWS account. The provider is account-wide so this should be set on
   * exactly ONE bootstrap stack — typically the dev one, on first deploy.
   * Other env bootstraps look it up by ARN.
   *
   * On `cdk destroy`, the provider is RETAINed to avoid breaking sibling
   * env bootstrap stacks that depend on the lookup.
   */
  createOidcProvider?: boolean;
}

/**
 * One-time bootstrap stack per environment. Creates:
 *
 * - The `gha-oci-deploy-{env}` IAM role assumable from `FG-AI4H/oci-platform`
 *   when running under GitHub Environment `{env}`.
 * - ECR repositories `oci-api` and `oci-worker-ingest` (image scanning on push).
 * - Optionally (when `createOidcProvider: true`) the account-wide GitHub
 *   Actions OIDC provider. This must be created ONCE per AWS account.
 *
 * Deploy order (Phase A1):
 *   1. First time per account, deploy dev bootstrap WITH the OIDC provider:
 *        pnpm cdk deploy oci-dev-bootstrap --context env=dev --context createOidcProvider=true
 *   2. Subsequently, other envs (and dev re-deploys) use the lookup:
 *        pnpm cdk deploy oci-{env}-bootstrap --context env={env}
 * The role then exists for the regular Deploy workflow to assume.
 */
export class BootstrapOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;
  public readonly apiRepo: ecr.Repository;
  public readonly workerIngestRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: BootstrapOidcStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // GitHub OIDC provider — account-wide singleton.
    // First-time deploys create it; later deploys (other envs, or re-deploys
    // of the same env) look it up by ARN.
    const providerArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;
    let oidcProvider: iam.IOpenIdConnectProvider;
    if (props.createOidcProvider) {
      // WARNING: this provider is account-wide. Destroying the stack that
      // owns it will break sibling env bootstraps that look it up by ARN.
      // Re-create with `--context createOidcProvider=true` if that happens.
      oidcProvider = new iam.OpenIdConnectProvider(this, 'GhOidc', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
      });
    } else {
      oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
        this,
        'GhOidc',
        providerArn,
      );
    }

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
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`],
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

    this.workerIngestRepo = new ecr.Repository(this, 'WorkerIngestRepo', {
      ...repoDefaults,
      repositoryName: 'oci-worker-ingest',
    });

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn });
    new cdk.CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WorkerIngestRepoUri', { value: this.workerIngestRepo.repositoryUri });

    NagSuppressions.addResourceSuppressions(
      this.deployRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Path-prefix wildcards are intentional and tightly scoped: cdk-hnb659fds-* matches CDK bootstrap roles (deploy, file-publishing, image-publishing, lookup); oci-* matches our ECR repos (oci-api, oci-worker-ingest); /cdk-bootstrap/* matches CDK bootstrap SSM parameters. ecr:GetAuthorizationToken and cloudformation:Describe*/List*/GetTemplate do not support per-resource scoping (AWS API limitation, account-scope only).',
          appliesTo: [
            'Resource::*',
            `Resource::arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`,
            `Resource::arn:aws:ecr:${this.region}:${this.account}:repository/oci-*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`,
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
