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

const app = new cdk.App();

// `--context env=dev|int|prod` selects the target environment
const envName = (app.node.tryGetContext('env') as string) ?? 'dev';
const cfg = resolveEnvironment(envName, app);
const tags = { Project: 'OCI', Environment: envName, ManagedBy: 'CDK' };

// Layered stacks (each layer depends on the previous one)
const network = new NetworkStack(app, `oci-${envName}-network`, { env: cfg.env, cfg, tags });
const identity = new IdentityStack(app, `oci-${envName}-identity`, { env: cfg.env, cfg, tags });
const data = new DataStack(app, `oci-${envName}-data`, {
  env: cfg.env,
  cfg,
  tags,
  vpc: network.vpc,
});
const observability = new ObservabilityStack(app, `oci-${envName}-observability`, {
  env: cfg.env,
  cfg,
  tags,
});
const api = new ApiStack(app, `oci-${envName}-api`, {
  env: cfg.env,
  cfg,
  tags,
  vpc: network.vpc,
  database: data.database,
  cognito: identity.userPool,
  logGroup: observability.apiLogGroup,
});
// Side-effect: registers the CloudFront distribution stack with the app.
// The variable is not referenced again, but the construction wires it in.
new WebStack(app, `oci-${envName}-web`, {
  env: cfg.env,
  cfg,
  tags,
  api: api.alb,
});

// Run cdk-nag checks (AWS Solutions ruleset) on all stacks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
