import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import type { OciEnvConfig } from './environments.js';

export interface BootstrapOidcStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  /** GitHub org/repo allowed to assume this role, e.g. `FG-AI4H/oci-platform` */
  githubRepo: string;
}

/**
 * One-time bootstrap stack per environment. Creates:
 *
 * - The GitHub Actions OIDC provider (one shared instance per AWS account;
 *   we use a `fromOpenIdConnectProviderArn` lookup if it already exists).
 * - The `gha-oci-deploy-{env}` IAM role assumable from `FG-AI4H/oci-platform`
 *   on branch `main` (and optionally a specific GitHub environment).
 * - ECR repositories `oci-api` and `oci-worker-ingest` (image scanning on push).
 *
 * Deploy order (Phase A1):
 *   cdk deploy oci-{env}-bootstrap --context env={env}
 * The role then exists for the regular Deploy workflow to assume.
 */
export class BootstrapOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;
  public readonly apiRepo: ecr.Repository;
  public readonly workerIngestRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: BootstrapOidcStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // GitHub OIDC provider — shared across envs.
    // Look up by ARN; if you've never bootstrapped GH OIDC in this account,
    // create one out-of-band first or uncomment the `OpenIdConnectProvider`
    // construct below.
    const providerArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;
    const oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GhOidc',
      providerArn,
    );

    const subjectClaim = `repo:${props.githubRepo}:environment:${props.cfg.envName}`;

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: `gha-oci-deploy-${props.cfg.envName}`,
      description: `GitHub Actions deploy role for ${props.githubRepo} → ${props.cfg.envName}`,
      assumedBy: new iam.OpenIdConnectPrincipal(oidcProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': subjectClaim,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Permission to deploy CDK stacks (call CloudFormation, push to ECR, etc.)
    // Phase A1 attaches PowerUser+IAM-passrole. Phase A2 narrows to least-priv.
    this.deployRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess'));
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:PassRole',
          'iam:GetRole',
          'iam:TagRole',
          'iam:UntagRole',
        ],
        resources: ['*'],
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
  }
}
