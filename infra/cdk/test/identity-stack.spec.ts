import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment, type EnvName } from '../lib/environments.js';
import { IdentityStack, userInvitationMessage } from '../lib/identity-stack.js';

/** The `Properties` of the one user pool in the synthesized identity stack. */
function userPoolOf(envName: EnvName): Record<string, unknown> {
  const app = new cdk.App();
  const cfg = resolveEnvironment(envName, app);
  const stack = new IdentityStack(app, `oci-${envName}-identity`, {
    env: cfg.env,
    cfg,
    tags: { Project: 'OCI' },
  });
  const pools = Object.values(Template.fromStack(stack).findResources('AWS::Cognito::UserPool'));
  expect(pools).toHaveLength(1);
  return (pools[0] as { Properties: Record<string, unknown> }).Properties;
}

describe('identity stack: who sends the pool mail (#642)', () => {
  it('dev sends through its own SES domain identity, from an address on that domain', () => {
    const pool = userPoolOf('dev');

    expect(pool.EmailConfiguration).toEqual({
      EmailSendingAccount: 'DEVELOPER',
      From: 'OCI Platform <oci-act@dev.oci.ai4h.net>',
      SourceArn: {
        'Fn::Join': [
          '',
          [
            'arn:',
            { Ref: 'AWS::Partition' },
            ':ses:eu-central-1:601883093460:identity/dev.oci.ai4h.net',
          ],
        ],
      },
    });
  });

  it('int and prod keep the built-in sender until their flag is turned on', () => {
    expect(userPoolOf('int').EmailConfiguration).toBeUndefined();
    expect(userPoolOf('prod').EmailConfiguration).toBeUndefined();
  });

  it('every environment gets the bilingual invitation, naming its own address', () => {
    for (const [envName, address] of [
      ['dev', 'https://dev.oci.ai4h.net'],
      ['int', 'https://int.oci.ai4h.net'],
      ['prod', 'https://oci.ai4h.net'],
    ] as const) {
      const pool = userPoolOf(envName) as {
        AdminCreateUserConfig: {
          InviteMessageTemplate: { EmailMessage: string; EmailSubject: string };
        };
        Policies: { PasswordPolicy: { TemporaryPasswordValidityDays: number } };
      };
      const invite = pool.AdminCreateUserConfig.InviteMessageTemplate;

      expect(invite.EmailMessage).toContain(address);
      expect(invite.EmailMessage).toContain('An account has been created for you');
      expect(invite.EmailMessage).toContain('Un compte a été créé pour vous');
      // The number in the message is the policy's, in both languages.
      const days = pool.Policies.PasswordPolicy.TemporaryPasswordValidityDays;
      expect(invite.EmailMessage).toContain(`works for ${days} days`);
      expect(invite.EmailMessage).toContain(`est valable ${days} jours`);
    }
  });
});

describe('userInvitationMessage: what Cognito accepts', () => {
  const { emailSubject, emailBody } = userInvitationMessage('platform.example.org', 3);

  const occurrences = (text: string, part: string): number => text.split(part).length - 1;

  it('carries each placeholder exactly once', () => {
    expect(occurrences(emailBody, '{username}')).toBe(1);
    expect(occurrences(emailBody, '{####}')).toBe(1);
  });

  it('stays within the length limits', () => {
    expect(emailSubject.length).toBeLessThanOrEqual(140);
    expect(emailBody.length).toBeLessThanOrEqual(20_000);
  });

  it('uses only the characters the template pattern allows', () => {
    // Letters, marks, symbols, numbers, punctuation and plain whitespace.
    // A no-break space, which French typography would put before a colon,
    // is a separator and would have the template rejected at deploy time.
    const allowed = /^[\p{L}\p{M}\p{S}\p{N}\p{P}\t\n\v\f\r ]+$/u;

    expect(emailSubject).toMatch(allowed);
    expect(emailBody).toMatch(allowed);
  });
});
