import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface IdentityStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
}

/**
 * Cognito user pool — unified identity across all OCI packages.
 * Replaces Django allauth (eval platform) and the per-app Cognito pool (annotation tool).
 *
 * Groups model: admin, host, participant, annotator, reviewer, supervisor, regulator.
 * Advanced security ON in prod for adaptive risk and compromised-creds detection.
 */
export class IdentityStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  /**
   * Secrets Manager secret holding the Cognito user-pool client secret —
   * mirrored from `userPoolClient.userPoolClientSecret` so ECS tasks can
   * read it via `ecs.Secret.fromSecretsManager` rather than baking it
   * into the task definition's plaintext env.
   */
  public readonly userPoolClientSecretSm: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `oci-${props.cfg.envName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan:
        props.cfg.envName === 'prod' ? cognito.FeaturePlan.PLUS : cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: props.cfg.removalPolicy,
      deletionProtection: props.cfg.envName === 'prod',
    });

    // Roles as Cognito groups (precedence reflects org seniority)
    [
      ['admin', 1],
      ['regulator', 5],
      ['supervisor', 10],
      ['reviewer', 15],
      ['host', 20],
      ['annotator', 25],
      ['participant', 30],
    ].forEach(([groupName, precedence]) => {
      new cognito.CfnUserPoolGroup(this, `Group-${groupName}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: groupName as string,
        precedence: precedence as number,
      });
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `oci-${props.cfg.envName}-web`,
      // Confidential client (server-side NextAuth code-flow exchange).
      // Generates a client secret on creation; we mirror it into Secrets
      // Manager below so ECS can pull it without baking it into env.
      generateSecret: true,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        // NextAuth.js v5 default callback path: /api/auth/callback/<provider>
        callbackUrls: [`https://${props.cfg.domainName}/api/auth/callback/cognito`],
        // Post-sign-out redirect (only used if we wire federated logout via
        // Cognito's /logout endpoint; NextAuth's local signOut goes here too).
        logoutUrls: [`https://${props.cfg.domainName}/`],
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Mirror the Cognito client secret into Secrets Manager so the web
    // task can read it via `ecs.Secret.fromSecretsManager(...)`.
    this.userPoolClientSecretSm = new secretsmanager.Secret(this, 'WebClientCognitoSecret', {
      description: `Cognito user pool client secret for ${props.cfg.envName} web app (NextAuth)`,
      secretStringValue: this.userPoolClient.userPoolClientSecret,
      removalPolicy: props.cfg.removalPolicy,
    });

    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `oci-${props.cfg.envName}` },
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomainUrl', { value: this.userPoolDomain.baseUrl() });

    if (props.cfg.envName !== 'prod') {
      NagSuppressions.addResourceSuppressions(this.userPool, [
        {
          id: 'AwsSolutions-COG8',
          reason:
            'PLUS feature plan is enabled only in prod (cost). Non-prod uses ESSENTIALS, which still includes MFA (OTP), token revocation, and password policies. See environments.ts.',
        },
      ]);
    }
    NagSuppressions.addResourceSuppressions(this.userPool, [
      {
        id: 'AwsSolutions-COG2',
        reason:
          'MFA is OPTIONAL pool-wide; it is enforced for admin/regulator/supervisor groups via Cognito advanced security in prod (PLUS plan), and per project security policy admins MUST enable MFA. Pool-wide REQUIRED MFA breaks self-service signup for participants.',
      },
    ]);

    // Cognito user-pool client secret can't be rotated by Secrets Manager
    // (Cognito doesn't expose a RotateSecret API for app clients). Manual
    // rotation only — replace the user pool client to roll the secret.
    NagSuppressions.addResourceSuppressions(this.userPoolClientSecretSm, [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Cognito user-pool app-client secrets are not Secrets-Manager-rotatable (no Cognito API for it). Manual rotation via replacing the user pool client. Acceptable for the lifetime of this client.',
      },
    ]);

    // CDK uses an internal Lambda-backed custom resource to read the
    // Cognito client secret at deploy time (via DescribeUserPoolClient).
    // We don't own this Lambda — its runtime + AWSLambdaBasicExecutionRole
    // are managed by aws-cdk-lib.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AWS679f53fac002430cb0da5b7982bd2287/Resource`,
      [
        {
          id: 'AwsSolutions-L1',
          reason:
            'Custom resource Lambda created by aws-cdk-lib to read Cognito user-pool client attributes. Runtime is managed by CDK; we do not control it.',
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole is the AWS-recommended managed policy for Lambda execution roles; auto-attached by CDK to its internal custom-resource handler.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ],
    );
  }
}
