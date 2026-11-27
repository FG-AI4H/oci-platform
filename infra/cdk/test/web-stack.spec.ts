import * as cdk from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../lib/environments.js';
import { ENVIRONMENTS, webTemplateOf } from './api-template.js';

interface ContainerDefinition {
  Name: string;
  Environment: Array<{ Name: string; Value: unknown }>;
}

/** The plain settings of the web container in the synthesized stack. */
function webSettingsOf(envName: (typeof ENVIRONMENTS)[number]): Map<string, unknown> {
  const tasks = Object.values(webTemplateOf(envName).findResources('AWS::ECS::TaskDefinition'));
  expect(tasks, envName).toHaveLength(1);
  const containers = (tasks[0] as { Properties: { ContainerDefinitions: ContainerDefinition[] } })
    .Properties.ContainerDefinitions;
  const web = containers.find((c) => c.Name === 'web');
  expect(web, envName).toBeDefined();
  return new Map((web?.Environment ?? []).map((e) => [e.Name, e.Value]));
}

describe('web stack: the address the pages publish as their own (#831)', () => {
  it.each(ENVIRONMENTS)('%s: the site address is the environment\u2019s domain', (envName) => {
    const cfg = resolveEnvironment(envName, new cdk.App());
    const settings = webSettingsOf(envName);

    expect(settings.get('NEXT_PUBLIC_SITE_URL')).toBe(`https://${cfg.domainName}`);
  });

  it.each(ENVIRONMENTS)('%s: it is the address sign-in comes back to', (envName) => {
    const settings = webSettingsOf(envName);

    expect(settings.get('NEXT_PUBLIC_SITE_URL')).toBe(settings.get('AUTH_URL'));
    expect(settings.get('OCI_ENV')).toBe(envName);
  });
});
