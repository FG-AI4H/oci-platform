import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface SharedBootstrapStackProps extends cdk.StackProps {
  tags: Record<string, string>;
}

/**
 * Account-wide GitHub Actions OIDC provider.
 *
 * Owned by ITS OWN stack, separate from any per-environment bootstrap,
 * because the OIDC provider is an account-scoped singleton: one per AWS
 * account regardless of how many environments share that account. The
 * env-scoped `BootstrapOidcStack` (gha-oci-deploy-{env} role + ECR repos)
 * looks up this provider's well-known ARN.
 *
 * Operator deploy (one time per AWS account):
 *   pnpm --filter @oci/cdk exec cdk deploy oci-shared-bootstrap
 *
 * The CI Deploy workflow EXCLUDES this stack — it is intentionally
 * operator-managed; routine env deploys never touch it.
 *
 * History: this resource used to live in `oci-dev-bootstrap`, gated by
 * a `createOidcProvider` context flag that operators had to remember on
 * every bootstrap deploy. Forgetting the flag synthesised a template
 * without the provider; CFN happily deleted it twice. This stack
 * removes the footgun by giving the provider its own permanent home.
 */
export class SharedBootstrapStack extends cdk.Stack {
  public readonly oidcProvider: iam.IOpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: SharedBootstrapStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.oidcProvider = new iam.OpenIdConnectProvider(this, 'GhOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    new cdk.CfnOutput(this, 'OidcProviderArn', { value: this.oidcProvider.openIdConnectProviderArn });
  }
}
