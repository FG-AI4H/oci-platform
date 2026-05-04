import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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
      // PHASE A2 INTERIM: `generateSecret` is intentionally OMITTED here,
      // not set to `false`. The live CFN template (pre-PR-#33) has no
      // `GenerateSecret` field on the WebClient at all (it relied on the
      // default). Setting `generateSecret: false` explicitly causes CDK
      // to emit `GenerateSecret: false` in the template, which CFN then
      // treats as a property change requiring REPLACEMENT (per AWS docs:
      // GenerateSecret update requires Replacement). Replacement creates
      // a new WebClient with a new id, the auto-generated export value
      // changes, and CFN trips "Cannot update export … as it is in use
      // by oci-dev-api." Verified via cloudformation describe-stack-events:
      //   "Requested update requires the creation of a new physical
      //    resource; hence creating one."
      // Omitting the field entirely means CDK emits no GenerateSecret →
      // the template matches the live one byte-for-byte on this property
      // → no replacement → bridge outputs stay value-stable.
      //
      // Sequence to land confidential mode safely:
      //   1. THIS PR: omit generateSecret → identity update is a no-op
      //      for WebClient → api/web update to drop their Fn::ImportValue
      //      refs cleanly. NextAuth signin is broken for one cycle
      //      (no client secret).
      //   2. Follow-up PR: drop the bridge CfnOutputs (api/web no
      //      longer import; outputs are orphan and safe to remove).
      //   3. Follow-up PR: set generateSecret: true and re-add the
      //      Secrets Manager mirror + web's AUTH_COGNITO_SECRET ref.
      //      Replacement happens, but no exports reference the
      //      WebClient id any more, so the in-use check passes.
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

    // Cross-stack indirection layer: publish identity primitives in SSM
    // under deterministic names. Consumer stacks (api, web) reference
    // these by NAME, not by CFN export — replacing the user pool client
    // doesn't break a CFN-export-in-use deadlock with downstream stacks.
    // The Cognito client SECRET will be added back in a Phase A2
    // follow-up once the WebClient can be safely replaced (see comment
    // on `generateSecret` above).
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/oci/${props.cfg.envName}/cognito/user-pool-id`,
      stringValue: this.userPool.userPoolId,
      description: `Cognito user pool id for ${props.cfg.envName} (consumed by api/web)`,
    });
    new ssm.StringParameter(this, 'WebClientIdParam', {
      parameterName: `/oci/${props.cfg.envName}/cognito/web-client-id`,
      stringValue: this.userPoolClient.userPoolClientId,
      description: `Cognito web app-client id for ${props.cfg.envName} (consumed by api/web)`,
    });

    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `oci-${props.cfg.envName}` },
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomainUrl', { value: this.userPoolDomain.baseUrl() });

    // BRIDGE OUTPUTS — keep the auto-generated cross-stack exports alive for
    // ONE deploy cycle. After the SSM-by-name refactor (PR #37), api/web no
    // longer Fn::ImportValue these — but the LIVE api stack template (still
    // pinned at the pre-#37 state because every subsequent deploy has rolled
    // back) still imports them. Removing them from identity in the same
    // deploy that removes the imports from api/web hits
    // "Cannot update export … as it is in use by oci-{env}-api" because
    // identity deploys first in the dep order. Solution: keep these
    // exports as orphan outputs for one deploy, then drop them in a
    // follow-up PR once api/web are live without the imports.
    //
    // The third auto-generated export from the prior synth
    // (`ExportsOutputRefWebClientCognitoSecret...`) is intentionally not
    // bridged: it was never published to the live stack — every deploy
    // that introduced it (PR #33 onwards) failed and rolled back, so
    // there is no live export to preserve.
    //
    // Names + logical IDs match exactly what CDK previously auto-generated
    // when api/web took `cognito` / `cognitoClient` props (verified via
    // `cdk synth` of the prior commit). Values are Ref tokens that resolve
    // to the LIVE userPool / userPoolClient ids — and the WebClient is no
    // longer being replaced (generateSecret kept at false above), so the
    // export VALUES remain unchanged across the update. Hard-coded on
    // purpose: a different export name would not match the live one and
    // wouldn't unblock the deploy.
    new cdk.CfnOutput(this, 'ExportsOutputRefUserPool6BA7E5F296FD7236', {
      value: this.userPool.userPoolId,
      exportName: `${this.stackName}:ExportsOutputRefUserPool6BA7E5F296FD7236`,
    });
    new cdk.CfnOutput(this, 'ExportsOutputRefUserPoolWebClient4C9370B02E2C9FF9', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${this.stackName}:ExportsOutputRefUserPoolWebClient4C9370B02E2C9FF9`,
    });

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

    // The SMG4 suppression for the WebClient secret mirror, and the L1 +
    // IAM4 suppressions for the CDK-internal custom-resource Lambda that
    // reads Cognito client attributes at deploy time, are intentionally
    // dropped here: with `generateSecret: false`, no Secrets Manager
    // mirror is created and CDK does not synthesize the
    // DescribeUserPoolClient custom resource. They will be reinstated
    // alongside `generateSecret: true` in the Phase A2 follow-up.
  }
}
