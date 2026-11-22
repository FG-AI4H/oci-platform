import { describe, expect, it } from 'vitest';
import type { Template } from 'aws-cdk-lib/assertions';
import { ENVIRONMENTS, templateOf } from './api-template.js';

/**
 * The keys CDK generates for the API task and injects as secret
 * environment variables. Neither is ever rotated: a new key would orphan
 * what was computed with the old one.
 */
const GENERATED_KEYS = [
  // DICOM finding digests (#674, ADR-0026).
  { env: 'OCI_DICOM_FINDING_DIGEST_KEY' },
  // Audit-trail pseudonyms for regulators (#775).
  { env: 'OCI_AUDIT_PSEUDONYM_KEY' },
] as const;

/**
 * The API rejects a pseudonym key shorter than this
 * (`MIN_KEY_LENGTH` in apps/api/src/modules/audit/audit-pseudonym.ts).
 */
const API_MIN_KEY_LENGTH = 32;

interface SecretResource {
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Properties: {
    Description?: string;
    SecretString?: unknown;
    GenerateSecretString?: { PasswordLength?: number; ExcludePunctuation?: boolean };
  };
}

interface ContainerDefinition {
  Name: string;
  Secrets?: { Name: string; ValueFrom: unknown }[];
  Environment?: { Name: string; Value: unknown }[];
}

/** The logical id and resource of the one secret whose description names `envVar`. */
function secretFor(template: Template, envVar: string): [string, SecretResource] {
  const matches = Object.entries(
    template.findResources('AWS::SecretsManager::Secret') as Record<string, SecretResource>,
  ).filter(([, r]) => r.Properties.Description?.includes(`(${envVar})`));
  expect(matches, envVar).toHaveLength(1);
  return matches[0]!;
}

/** The `api` container of the API service's task definition. */
function apiContainer(template: Template): ContainerDefinition {
  const containers = Object.values(template.findResources('AWS::ECS::TaskDefinition'))
    .flatMap(
      (td) =>
        (td as { Properties: { ContainerDefinitions: ContainerDefinition[] } }).Properties
          .ContainerDefinitions,
    )
    .filter((c) => c.Name === 'api');
  expect(containers).toHaveLength(1);
  return containers[0]!;
}

describe('api stack: generated keys for the API task (#674, #775)', () => {
  it('generates each key in every environment, never from a literal value', () => {
    for (const envName of ENVIRONMENTS) {
      for (const { env } of GENERATED_KEYS) {
        const [, secret] = secretFor(templateOf(envName), env);
        expect(secret.Properties.SecretString, `${envName} ${env}`).toBeUndefined();
        expect(secret.Properties.GenerateSecretString, `${envName} ${env}`).toEqual({
          PasswordLength: 64,
          ExcludePunctuation: true,
        });
        expect(
          secret.Properties.GenerateSecretString?.PasswordLength,
          `${envName} ${env}`,
        ).toBeGreaterThanOrEqual(API_MIN_KEY_LENGTH);
      }
    }
  });

  it('destroys the keys with a dev stack and retains them in int and prod', () => {
    for (const envName of ENVIRONMENTS) {
      const expected = envName === 'dev' ? 'Delete' : 'Retain';
      for (const { env } of GENERATED_KEYS) {
        const [, secret] = secretFor(templateOf(envName), env);
        expect(secret.DeletionPolicy, `${envName} ${env}`).toBe(expected);
        expect(secret.UpdateReplacePolicy, `${envName} ${env}`).toBe(expected);
      }
    }
  });

  it('never rotates them', () => {
    for (const envName of ENVIRONMENTS) {
      const template = templateOf(envName);
      const schedules = JSON.stringify(
        template.findResources('AWS::SecretsManager::RotationSchedule'),
      );
      for (const { env } of GENERATED_KEYS) {
        const [logicalId] = secretFor(template, env);
        expect(schedules, `${envName} ${env}`).not.toContain(logicalId);
      }
    }
  });

  it('injects each key into the api container as a secret, never as plain environment', () => {
    for (const envName of ENVIRONMENTS) {
      const template = templateOf(envName);
      const container = apiContainer(template);
      for (const { env } of GENERATED_KEYS) {
        const [logicalId] = secretFor(template, env);
        expect(container.Secrets, `${envName} ${env}`).toContainEqual({
          Name: env,
          ValueFrom: { Ref: logicalId },
        });
        expect(
          (container.Environment ?? []).map((e) => e.Name),
          `${envName} ${env}`,
        ).not.toContain(env);
      }
    }
  });

  it('lets the task execution role read each key, so ECS can inject it', () => {
    for (const envName of ENVIRONMENTS) {
      const template = templateOf(envName);
      const taskDefs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as {
        Properties: {
          ContainerDefinitions: ContainerDefinition[];
          ExecutionRoleArn: { 'Fn::GetAtt': [string, string] };
        };
      }[];
      const apiTaskDef = taskDefs.find((td) =>
        td.Properties.ContainerDefinitions.some((c) => c.Name === 'api'),
      );
      const roleId = apiTaskDef?.Properties.ExecutionRoleArn['Fn::GetAtt'][0];
      expect(roleId, envName).toBeDefined();
      const policies = JSON.stringify(
        Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
          JSON.stringify((p as { Properties: { Roles: unknown } }).Properties.Roles).includes(
            `"${roleId}"`,
          ),
        ),
      );
      for (const { env } of GENERATED_KEYS) {
        const [logicalId] = secretFor(template, env);
        expect(policies, `${envName} ${env}`).toContain(`{"Ref":"${logicalId}"}`);
      }
    }
  });
});
