import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it } from 'vitest';
import {
  CognitoUserDirectory,
  regionOfUserPool,
  type CognitoSender,
} from './cognito-user-directory.js';
import { DirectoryAccessError, UserAlreadyExistsError } from './user-directory.js';

const POOL = 'eu-central-1_EXAMPLE01';

type Reply = Record<string, unknown> | Error;

/**
 * Stands in for the SDK client: answers each command from a queue and keeps
 * what it was sent. No network, no credentials.
 */
function stubClient(...replies: Reply[]) {
  const sent: { input: unknown }[] = [];
  const queue = [...replies];
  const client = {
    send: async (command: { input: unknown }) => {
      sent.push(command);
      const reply = queue.shift();
      if (reply === undefined) throw new Error('stub client: no reply queued');
      if (reply instanceof Error) throw reply;
      return reply;
    },
  } as unknown as CognitoSender;
  return { client, sent };
}

function awsError(name: string, message = name): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('regionOfUserPool', () => {
  it('reads the region out of a user pool id', () => {
    expect(regionOfUserPool('eu-central-1_EXAMPLE01')).toBe('eu-central-1');
    expect(regionOfUserPool('us-gov-west-1_Abc123')).toBe('us-gov-west-1');
  });

  it('answers null for anything else', () => {
    expect(regionOfUserPool('EXAMPLE01')).toBeNull();
    expect(regionOfUserPool('eu-central-1')).toBeNull();
    expect(regionOfUserPool('')).toBeNull();
  });
});

describe('CognitoUserDirectory', () => {
  it('refuses to open something that is not a user pool id', () => {
    expect(() => CognitoUserDirectory.forUserPool('not-a-pool')).toThrow(/not a user pool id/);
  });

  it('creates the account with a verified e-mail, the names and the temporary password', async () => {
    const { client, sent } = stubClient({
      User: {
        Username: 'f3b1c2d4-0000-4000-8000-000000000001',
        UserStatus: 'FORCE_CHANGE_PASSWORD',
        Enabled: true,
      },
    });
    const directory = new CognitoUserDirectory(client, POOL);

    const user = await directory.createUser({
      email: 'ada@example.org',
      givenName: 'Ada',
      familyName: 'Almeida',
      temporaryPassword: 'Kx7!example?Pw2a',
      suppressInvitation: false,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(AdminCreateUserCommand);
    expect(sent[0]?.input).toEqual({
      UserPoolId: POOL,
      Username: 'ada@example.org',
      TemporaryPassword: 'Kx7!example?Pw2a',
      UserAttributes: [
        { Name: 'email', Value: 'ada@example.org' },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: 'Ada' },
        { Name: 'family_name', Value: 'Almeida' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    });
    expect(user).toEqual({
      username: 'f3b1c2d4-0000-4000-8000-000000000001',
      status: 'FORCE_CHANGE_PASSWORD',
      enabled: true,
      givenName: 'Ada',
      familyName: 'Almeida',
    });
  });

  it('tells Cognito to send nothing when the invitation is suppressed', async () => {
    const { client, sent } = stubClient({ User: { Username: 'u-1' } });

    await new CognitoUserDirectory(client, POOL).createUser({
      email: 'ada@example.org',
      givenName: 'Ada',
      familyName: 'Almeida',
      temporaryPassword: 'Kx7!example?Pw2a',
      suppressInvitation: true,
    });

    expect(sent[0]?.input).toMatchObject({ MessageAction: 'SUPPRESS' });
  });

  it('reports an e-mail that is already taken as UserAlreadyExistsError', async () => {
    const { client } = stubClient(awsError('UsernameExistsException'));

    await expect(
      new CognitoUserDirectory(client, POOL).createUser({
        email: 'ada@example.org',
        givenName: 'Ada',
        familyName: 'Almeida',
        temporaryPassword: 'Kx7!example?Pw2a',
        suppressInvitation: false,
      }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
  });

  it('looks an account up by its e-mail', async () => {
    const { client, sent } = stubClient({
      Username: 'u-1',
      UserStatus: 'CONFIRMED',
      Enabled: false,
      UserAttributes: [
        { Name: 'email', Value: 'ada@example.org' },
        { Name: 'given_name', Value: 'Ada' },
      ],
    });

    const user = await new CognitoUserDirectory(client, POOL).findByEmail('ada@example.org');

    expect(sent[0]).toBeInstanceOf(AdminGetUserCommand);
    expect(sent[0]?.input).toEqual({ UserPoolId: POOL, Username: 'ada@example.org' });
    expect(user).toEqual({
      username: 'u-1',
      status: 'CONFIRMED',
      enabled: false,
      givenName: 'Ada',
      familyName: null,
    });
  });

  it('answers null for an e-mail without an account', async () => {
    const { client } = stubClient(awsError('UserNotFoundException'));

    expect(await new CognitoUserDirectory(client, POOL).findByEmail('ada@example.org')).toBeNull();
  });

  it('turns a missing pool, expired credentials and a denied call into DirectoryAccessError', async () => {
    for (const name of [
      'ResourceNotFoundException',
      'ExpiredTokenException',
      'AccessDeniedException',
    ]) {
      const { client } = stubClient(awsError(name));

      await expect(
        new CognitoUserDirectory(client, POOL).findByEmail('ada@example.org'),
      ).rejects.toBeInstanceOf(DirectoryAccessError);
    }
  });

  it('passes any other error through untouched', async () => {
    const original = awsError('InvalidParameterException', 'bad attribute');
    const { client } = stubClient(original);

    await expect(new CognitoUserDirectory(client, POOL).listGroups('u-1')).rejects.toBe(original);
  });

  it('lists every page of groups', async () => {
    const { client, sent } = stubClient(
      { Groups: [{ GroupName: 'annotator' }], NextToken: 'page-2' },
      { Groups: [{ GroupName: 'reviewer' }, {}] },
    );

    const groups = await new CognitoUserDirectory(client, POOL).listGroups('u-1');

    expect(groups).toEqual(['annotator', 'reviewer']);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBeInstanceOf(AdminListGroupsForUserCommand);
    expect(sent[1]?.input).toEqual({ UserPoolId: POOL, Username: 'u-1', NextToken: 'page-2' });
  });

  it('adds an account to a group', async () => {
    const { client, sent } = stubClient({});

    await new CognitoUserDirectory(client, POOL).addToGroup('u-1', 'annotator');

    expect(sent[0]).toBeInstanceOf(AdminAddUserToGroupCommand);
    expect(sent[0]?.input).toEqual({ UserPoolId: POOL, Username: 'u-1', GroupName: 'annotator' });
  });

  it('sets a password that must be changed at the next sign-in', async () => {
    const { client, sent } = stubClient({});

    await new CognitoUserDirectory(client, POOL).setTemporaryPassword('u-1', 'Kx7!example?Pw2a');

    expect(sent[0]).toBeInstanceOf(AdminSetUserPasswordCommand);
    expect(sent[0]?.input).toEqual({
      UserPoolId: POOL,
      Username: 'u-1',
      Password: 'Kx7!example?Pw2a',
      Permanent: false,
    });
  });
});
