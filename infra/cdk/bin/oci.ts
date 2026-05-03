#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { NetworkStack } from '../lib/network-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { IdentityStack } from '../lib/identity-stack.js';
import { ApiStack } from '../lib/api-stack.js';
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

// Route 53 hosted zone for ai4h.net (ADR-0001). Single account-wide zone
// shared with other FG-AI4H tenants; OCI Platform records all live under
// the `oci` subdomain. ID is stable so we hardcode rather than lookup
// (lookup needs `cdk synth` AWS creds; this works offline).
const HOSTED_ZONE_ID = 'Z09716362NE75KQEXM9N9';
const HOSTED_ZONE_NAME = 'ai4h.net';

// Bootstrap stack: OIDC role + ECR repos. Deploy this once per environment;
// CI excludes it from `cdk deploy` (see .github/workflows/deploy.yml).
//
// The GitHub OIDC provider is account-wide; pass `--context createOidcProvider=true`
// on the FIRST bootstrap deploy ever for this AWS account.
const createOidcProvider = app.node.tryGetContext('createOidcProvider') === 'true';
new BootstrapOidcStack(app, `oci-${envName}-bootstrap`, {
  env: cfg.env,
  cfg,
  tags,
  githubRepo: 'FG-AI4H/oci-platform',
  createOidcProvider,
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
new ApiStack(app, `oci-${envName}-api`, {
  env: cfg.env,
  cfg,
  tags,
  vpc: network.vpc,
  database: data.database,
  cognito: identity.userPool,
  logGroup: observability.apiLogGroup,
  accessLogsBucket: observability.accessLogsBucket,
  apiImage,
  hostedZoneId: HOSTED_ZONE_ID,
  zoneName: HOSTED_ZONE_NAME,
});
// CloudFront/web-stack retired in ADR-0001 — ALB now serves clients directly
// over HTTPS with an ACM cert. Security headers move to NestJS @fastify/helmet.

// Run cdk-nag checks (AWS Solutions ruleset) on all stacks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
