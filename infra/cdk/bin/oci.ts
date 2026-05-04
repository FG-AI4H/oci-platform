#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { NetworkStack } from '../lib/network-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { IdentityStack } from '../lib/identity-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { WebStack } from '../lib/web-stack.js';
import { ObservabilityStack } from '../lib/observability-stack.js';
import { resolveEnvironment } from '../lib/environments.js';
import { BootstrapOidcStack } from '../lib/bootstrap-oidc-stack.js';
import { SharedBootstrapStack } from '../lib/shared-bootstrap-stack.js';

const app = new cdk.App();

// `--context env=dev|int|prod` selects the target environment
const envName = (app.node.tryGetContext('env') as string) ?? 'dev';
const cfg = resolveEnvironment(envName, app);
const tags = { Project: 'OCI', Environment: envName, ManagedBy: 'CDK' };

// Container image URIs supplied by the Deploy workflow after build/push.
// Locally these are undefined; the stacks fall back to public placeholders
// (api/web) or omit the corresponding resource (migrate task def).
const apiImage = app.node.tryGetContext('apiImage') as string | undefined;
const webImage = app.node.tryGetContext('webImage') as string | undefined;
const migrateImage = app.node.tryGetContext('migrateImage') as string | undefined;

// Route 53 hosted zone for ai4h.net (ADR-0001). Single account-wide zone
// shared with other FG-AI4H tenants; OCI Platform records all live under
// the `oci` subdomain. ID is stable so we hardcode rather than lookup
// (lookup needs `cdk synth` AWS creds; this works offline).
const HOSTED_ZONE_ID = 'Z09716362NE75KQEXM9N9';
const HOSTED_ZONE_NAME = 'ai4h.net';

// Account-wide GitHub Actions OIDC provider. Operator deploy ONCE per AWS
// account; not part of CI's `cdk deploy` (see .github/workflows/deploy.yml).
//   pnpm --filter @oci/cdk exec cdk deploy oci-shared-bootstrap
new SharedBootstrapStack(app, 'oci-shared-bootstrap', {
  env: { account: '601883093460', region: 'eu-central-1' },
  tags: { Project: 'OCI', Scope: 'shared', ManagedBy: 'CDK' },
});

// Per-env bootstrap: the gha-oci-deploy-{env} role + ECR repos. Operator
// deploy ONCE per environment; not part of CI's `cdk deploy`.
//   pnpm --filter @oci/cdk exec cdk deploy oci-{env}-bootstrap --context env={env}
new BootstrapOidcStack(app, `oci-${envName}-bootstrap`, {
  env: cfg.env,
  cfg,
  tags,
  githubRepo: 'FG-AI4H/oci-platform',
});

// Layered runtime stacks. Observability is constructed before data/api so
// it owns the shared access-logs bucket consumed downstream for S3 + ALB
// access logging.
const network = new NetworkStack(app, `oci-${envName}-network`, { env: cfg.env, cfg, tags });
const identity = new IdentityStack(app, `oci-${envName}-identity`, { env: cfg.env, cfg, tags });
const observability = new ObservabilityStack(app, `oci-${envName}-observability`, {
  env: cfg.env,
  cfg,
  tags,
});
const data = new DataStack(app, `oci-${envName}-data`, {
  env: cfg.env,
  cfg,
  tags,
  vpc: network.vpc,
  accessLogsBucket: observability.accessLogsBucket,
});
const api = new ApiStack(app, `oci-${envName}-api`, {
  env: cfg.env,
  cfg,
  tags,
  vpc: network.vpc,
  database: data.database,
  logGroup: observability.apiLogGroup,
  accessLogsBucket: observability.accessLogsBucket,
  apiImage,
  migrateImage,
  hostedZoneId: HOSTED_ZONE_ID,
  zoneName: HOSTED_ZONE_NAME,
});
// api/web read Cognito identity primitives from SSM/Secrets-Manager BY NAME
// (no CFN export — avoids the cross-stack-export deadlock when the user
// pool client is replaced). identity-stack writes those parameters, so we
// declare the deploy-order dep explicitly since CDK can no longer infer
// it from props.
api.addDependency(identity);

// Web stack — Next.js Fargate service sharing the API's cluster + ALB.
// Path-based routing on the existing HTTPS listener: ApiStack owns the
// priority-50 rule for /v2/*, /health, /docs/*; WebStack adds a
// priority-100 catch-all `/*` for everything else.
const web = new WebStack(app, `oci-${envName}-web`, {
  env: cfg.env,
  cfg,
  tags,
  vpc: network.vpc,
  cluster: api.cluster,
  httpsListener: api.httpsListener,
  logGroup: observability.apiLogGroup,
  webImage,
});
web.addDependency(identity);

// Run cdk-nag checks (AWS Solutions ruleset) on all stacks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
