import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PlatformGroup } from '@oci/shared-types';
import {
  DirectoryAccessError,
  UserAlreadyExistsError,
  type DirectoryUser,
  type NewUser,
  type UserDirectory,
} from './user-directory.js';

/** The one SDK method the adapter uses; narrow so a test can stand in for the client. */
export type CognitoSender = Pick<CognitoIdentityProviderClient, 'send'>;

/**
 * A user pool id is `<region>_<suffix>`, so the region never has to be asked
 * for separately (and can never disagree with the pool).
 */
export function regionOfUserPool(userPoolId: string): string | null {
  const [region, suffix, ...rest] = userPoolId.split('_');
  if (region === undefined || suffix === undefined || rest.length > 0) return null;
  if (!/^[a-z]{2}-[a-z-]+-\d+$/.test(region) || !/^[0-9A-Za-z]+$/.test(suffix)) return null;
  return region;
}

/** Error names that mean "no call will work", whoever the call is about. */
const ACCESS_ERROR_NAMES: ReadonlySet<string> = new Set([
  'AccessDeniedException',
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'InvalidSignatureException',
  'NotAuthorizedException',
  'UnrecognizedClientException',
]);

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : '';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function attribute(attributes: AttributeType[] | undefined, name: string): string | null {
  for (const a of attributes ?? []) {
    if (a.Name === name) return a.Value ?? null;
  }
  return null;
}

/**
 * `UserDirectory` over an Amazon Cognito user pool. The platform's pool signs
 * people in with their e-mail (`UsernameAttributes: [email]`), so the e-mail
 * is accepted wherever the API asks for a `Username`, while the username
 * Cognito stores is a UUID.
 *
 * Credentials come from the SDK's default chain, which is the operator's
 * SSO-assumed role. Nothing here reads or stores a key.
 */
export class CognitoUserDirectory implements UserDirectory {
  constructor(
    private readonly client: CognitoSender,
    private readonly userPoolId: string,
  ) {}

  static forUserPool(userPoolId: string): CognitoUserDirectory {
    const region = regionOfUserPool(userPoolId);
    if (!region) {
      throw new Error(`"${userPoolId}" is not a user pool id (expected <region>_<suffix>)`);
    }
    // Twenty-five people is far below Cognito's rate limits; the extra
    // attempts only cover a throttled call on a busy account.
    return new CognitoUserDirectory(
      new CognitoIdentityProviderClient({ region, maxAttempts: 5 }),
      userPoolId,
    );
  }

  async findByEmail(email: string): Promise<DirectoryUser | null> {
    try {
      const out = await this.client.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: email }),
      );
      return {
        username: out.Username ?? email,
        status: out.UserStatus ?? 'UNKNOWN',
        enabled: out.Enabled ?? true,
        givenName: attribute(out.UserAttributes, 'given_name'),
        familyName: attribute(out.UserAttributes, 'family_name'),
      };
    } catch (err) {
      if (errorName(err) === 'UserNotFoundException') return null;
      // AdminGetUser answers UserNotFoundException for a missing person, so
      // ResourceNotFoundException here can only be the pool itself.
      if (errorName(err) === 'ResourceNotFoundException') {
        throw new DirectoryAccessError(`user pool ${this.userPoolId} was not found`, {
          cause: err,
        });
      }
      throw this.translate(err);
    }
  }

  async createUser(user: NewUser): Promise<DirectoryUser> {
    try {
      const out = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: user.email,
          TemporaryPassword: user.temporaryPassword,
          UserAttributes: [
            { Name: 'email', Value: user.email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'given_name', Value: user.givenName },
            { Name: 'family_name', Value: user.familyName },
          ],
          // The API's default medium is SMS; the pool has no SMS set up.
          DesiredDeliveryMediums: ['EMAIL'],
          ...(user.suppressInvitation ? { MessageAction: 'SUPPRESS' as const } : {}),
        }),
      );
      return {
        username: out.User?.Username ?? user.email,
        status: out.User?.UserStatus ?? 'FORCE_CHANGE_PASSWORD',
        enabled: out.User?.Enabled ?? true,
        givenName: user.givenName,
        familyName: user.familyName,
      };
    } catch (err) {
      if (errorName(err) === 'UsernameExistsException') {
        throw new UserAlreadyExistsError(`${user.email} already has an account`, { cause: err });
      }
      throw this.translate(err);
    }
  }

  async listGroups(username: string): Promise<string[]> {
    const names: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const out = await this.client.send(
          new AdminListGroupsForUserCommand({
            UserPoolId: this.userPoolId,
            Username: username,
            NextToken: nextToken,
          }),
        );
        for (const group of out.Groups ?? []) {
          if (group.GroupName) names.push(group.GroupName);
        }
        nextToken = out.NextToken;
      } while (nextToken);
    } catch (err) {
      throw this.translate(err);
    }
    return names;
  }

  async addToGroup(username: string, group: PlatformGroup): Promise<void> {
    try {
      await this.client.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          GroupName: group,
        }),
      );
    } catch (err) {
      throw this.translate(err);
    }
  }

  async setTemporaryPassword(username: string, temporaryPassword: string): Promise<void> {
    try {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          Password: temporaryPassword,
          Permanent: false,
        }),
      );
    } catch (err) {
      throw this.translate(err);
    }
  }

  private translate(err: unknown): unknown {
    if (ACCESS_ERROR_NAMES.has(errorName(err))) {
      return new DirectoryAccessError(`${errorName(err)}: ${errorMessage(err)}`, { cause: err });
    }
    return err;
  }
}
