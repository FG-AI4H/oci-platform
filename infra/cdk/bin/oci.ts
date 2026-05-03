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

const app = new cdk.App();

// `--context env=dev|int|prod` selects the target environment
const envName = (app.node.tryGetContext('env') as string) ?? 'dev';
const cfg = resolveEnvironment(envName, app);
const tags = { Project: 'OCI', Environment: envName, ManagedBy: 'CDK' };

// Container image URIs supplied by the Deploy workflow after build/push.
// Locally these are undefined; the stacks fall back to public placeholders.
const apiImage = app.node.tryGetContext('apiImage') as string | undefined;

// Bootstrap stack: OIDC role + ECR repos. Deploy this first per environment;
// after this exists, the GitHub Actions workflow can assume the role and
// push images. Skip from default app loop — explicit deploy via:
//   pnpm --filter @oci/cdk cdk deploy oci-{env}-bootstrap --context env={env}
//
// The GitHub OIDC provider is account-wide; pass `--context createOidcProvider=true`
// on the FIRST bootstrap deploy ever for this AWS account (typically the dev one).
const createOidcProvider = app.node.tryGetContext('createOidcProvider') === 'true';
new BootstrapOidcStack(app, `oci-${envName}-bootstrap`, {
  env: cfg.env,
  cfg,
  tags,
  githubRepo: 'FG-AI4H/oci-platform',
  createOidcProvider,
});

// Layered stacks (each layer depends on the previous one).
// Observability is created before data/api/web because it owns the shared
// access-logs bucket consumed downstream for S3 / ALB / CloudFront access logs.
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
  cognito: identity.userPool,
  logGroup: observability.apiLogGroup,
  accessLogsBucket: observability.accessLogsBucket,
  apiImage,
});
// Side-effect: registers the CloudFront distribution stack with the app.
// The variable is not referenced again, but the construction wires it in.
new WebStack(app, `oci-${envName}-web`, {
  env: cfg.env,
  cfg,
  tags,
  api: api.alb,
  accessLogsBucket: observability.accessLogsBucket,
});

// Run cdk-nag checks (AWS Solutions ruleset) on all stacks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
