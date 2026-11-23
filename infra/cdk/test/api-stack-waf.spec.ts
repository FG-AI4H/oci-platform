import * as cdk from 'aws-cdk-lib';
import type { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../lib/environments.js';
import { ENVIRONMENTS, templateOf } from './api-template.js';

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
