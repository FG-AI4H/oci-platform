import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { EvalStack } from '../lib/eval-stack.js';
import { resolveEnvironment, type EnvName } from '../lib/environments.js';
import { NetworkStack } from '../lib/network-stack.js';
import { ObservabilityStack } from '../lib/observability-stack.js';
import { WebStack } from '../lib/web-stack.js';

export const ENVIRONMENTS: readonly EnvName[] = ['dev', 'int', 'prod'];

/**
 * The api stack of one environment and what it was built from, wired as
 * `bin/oci.ts` wires it. Offline: no context lookups, placeholder images.
 */
function apiStackOf(envName: EnvName) {
  const app = new cdk.App();
  const cfg = resolveEnvironment(envName, app);
  const tags = { Project: 'OCI', Environment: envName, ManagedBy: 'CDK' };
  const common = { env: cfg.env, cfg, tags };
  const network = new NetworkStack(app, `oci-${envName}-network`, common);
  const observability = new ObservabilityStack(app, `oci-${envName}-observability`, common);
  const data = new DataStack(app, `oci-${envName}-data`, {
    ...common,
    vpc: network.vpc,
    accessLogsBucket: observability.accessLogsBucket,
  });
  const evaluation = new EvalStack(app, `oci-${envName}-eval`, {
    ...common,
    logGroup: observability.workerLogGroup,
    alarmsTopic: observability.alarmsTopic,
    workerEvalImage: undefined,
  });
  const api = new ApiStack(app, `oci-${envName}-api`, {
    ...common,
    vpc: network.vpc,
    database: data.database,
    logGroup: observability.apiLogGroup,
    accessLogsBucket: observability.accessLogsBucket,
    datasetsBucket: data.datasetsBucket,
    evalQueue: evaluation.submissionQueue,
    hostedZoneId: 'Z09716362NE75KQEXM9N9',
    zoneName: 'ai4h.net',
  });
  return { app, common, network, observability, api };
}

/** The synthesized api stack of one environment. */
function apiTemplateOf(envName: EnvName): Template {
  return Template.fromStack(apiStackOf(envName).api);
}

/**
 * The synthesized web stack of one environment, on its own app so that
 * synthesizing it leaves the cached api templates alone.
 */
export function webTemplateOf(envName: EnvName): Template {
  const { app, common, network, observability, api } = apiStackOf(envName);
  const web = new WebStack(app, `oci-${envName}-web`, {
    ...common,
    vpc: network.vpc,
    cluster: api.cluster,
    httpsListener: api.httpsListener,
    logGroup: observability.apiLogGroup,
    webImage: undefined,
  });
  return Template.fromStack(web);
}

// One synth per environment, shared by every test file in the same worker.
const templates = new Map<EnvName, Template>();

/** The api stack template of `envName`, synthesized once. */
export function templateOf(envName: EnvName): Template {
  const cached = templates.get(envName);
  if (cached) return cached;
  const template = apiTemplateOf(envName);
  templates.set(envName, template);
  return template;
}
