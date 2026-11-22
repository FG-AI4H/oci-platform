import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { EvalStack } from '../lib/eval-stack.js';
import { resolveEnvironment, type EnvName } from '../lib/environments.js';
import { NetworkStack } from '../lib/network-stack.js';
import { ObservabilityStack } from '../lib/observability-stack.js';

/**
 * The synthesized api stack of one environment, wired as `bin/oci.ts` wires
 * it. Offline: no context lookups, placeholder images.
 */
function apiTemplateOf(envName: EnvName): Template {
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
  return Template.fromStack(api);
}

interface ManagedRule {
  Name: string;
  Priority: number;
  OverrideAction?: Record<string, unknown>;
  Statement: {
    ManagedRuleGroupStatement?: {
      VendorName: string;
      Name: string;
      RuleActionOverrides?: unknown;
      ScopeDownStatement?: unknown;
    };
  };
}

/** The rules of the one web ACL in the template, or `null` when there is none. */
function webAclRulesOf(template: Template): ManagedRule[] | null {
  const acls = Object.values(template.findResources('AWS::WAFv2::WebACL'));
  if (acls.length === 0) return null;
  expect(acls).toHaveLength(1);
  return (acls[0] as { Properties: { Rules: ManagedRule[] } }).Properties.Rules;
}

const ENVIRONMENTS: readonly EnvName[] = ['dev', 'int', 'prod'];

// One synth per environment, shared by the tests below.
const templates = new Map<EnvName, Template>();
const templateOf = (envName: EnvName): Template => {
  const cached = templates.get(envName);
  if (cached) return cached;
  const template = apiTemplateOf(envName);
  templates.set(envName, template);
  return template;
};

describe('api stack: WAF core rule set and request bodies (#736)', () => {
  it('has a web ACL, attached to the ALB, exactly where enableWaf is on', () => {
    for (const envName of ENVIRONMENTS) {
      const cfg = resolveEnvironment(envName, new cdk.App());
      const template = templateOf(envName);
      const associations = template.findResources('AWS::WAFv2::WebACLAssociation');
      expect(webAclRulesOf(template) !== null, envName).toBe(cfg.enableWaf);
      expect(Object.keys(associations), envName).toHaveLength(cfg.enableWaf ? 1 : 0);
    }
  });

  it('int and prod have the WAF on; dev does not, in this change', () => {
    // Switching dev on is its own change (#658), deployed before the freeze
    // of 14 December 2026. When it lands this line changes and the other
    // tests here cover dev with no further edit.
    expect(ENVIRONMENTS.filter((e) => resolveEnvironment(e, new cdk.App()).enableWaf)).toEqual([
      'int',
      'prod',
    ]);
  });

  it('counts, instead of blocking, the core rule set’s 8 KB body rule, and overrides nothing else', () => {
    for (const envName of ENVIRONMENTS) {
      const rules = webAclRulesOf(templateOf(envName));
      if (rules === null) continue;
      const crs = rules.find((r) => r.Name === 'AWSManagedRulesCommonRuleSet');
      expect(crs, envName).toBeDefined();
      expect(crs?.OverrideAction, envName).toEqual({ None: {} });
      expect(crs?.Statement.ManagedRuleGroupStatement, envName).toEqual({
        VendorName: 'AWS',
        Name: 'AWSManagedRulesCommonRuleSet',
        // The exact, case-sensitive rule name: AWS WAF silently ignores an
        // override for a rule name that does not exist in the group.
        RuleActionOverrides: [{ Name: 'SizeRestrictions_BODY', ActionToUse: { Count: {} } }],
      });
    }
  });

  it('keeps the other managed rule groups as AWS ships them, unscoped', () => {
    for (const envName of ENVIRONMENTS) {
      const rules = webAclRulesOf(templateOf(envName));
      if (rules === null) continue;
      expect(rules.map((r) => [r.Priority, r.Name])).toEqual([
        [1, 'AWSManagedRulesCommonRuleSet'],
        [2, 'AWSManagedRulesKnownBadInputsRuleSet'],
        [3, 'AWSManagedRulesAmazonIpReputationList'],
      ]);
      for (const rule of rules) {
        const statement = rule.Statement.ManagedRuleGroupStatement;
        expect(statement?.ScopeDownStatement, `${envName} ${rule.Name}`).toBeUndefined();
        if (rule.Name !== 'AWSManagedRulesCommonRuleSet') {
          expect(statement?.RuleActionOverrides, `${envName} ${rule.Name}`).toBeUndefined();
        }
      }
    }
  });

  it('adds no rate-based rule: a workshop room behind one address is not throttled', () => {
    for (const envName of ENVIRONMENTS) {
      const rules = webAclRulesOf(templateOf(envName));
      if (rules === null) continue;
      expect(JSON.stringify(rules), envName).not.toContain('RateBasedStatement');
    }
  });
});
