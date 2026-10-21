import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { PlatformGroup } from '@oci/shared-types';
import type { OciEnvConfig } from './environments.js';

/**
 * Cognito group precedence (lower = higher priority / seniority). This is a
 * total map over `PlatformGroup`, so `tsc` fails if a group is added to
 * `PlatformGroupSchema` without a precedence here — which also means the
 * group can't be forgotten in the pool (the drift that made
 * `AdminAddUserToGroup` 500 for `campaign-manager`). See FG-AI4H/oci-platform#337.
 */
const GROUP_PRECEDENCE: Record<PlatformGroup, number> = {
  admin: 1,
  regulator: 5,
  supervisor: 10,
  'campaign-manager': 12,
  'task-supervisor': 13,
  reviewer: 15,
  'expert-reviewer': 16,
  host: 20,
  'arbitration-annotator': 23,
  annotator: 25,
  participant: 30,
};

export interface IdentityStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
}

/**
 * Cognito user pool — unified identity across all OCI packages.
 * Replaces Django allauth (eval platform) and the per-app Cognito pool (annotation tool).
 *
 * Groups model: derived directly from `PlatformGroupSchema` in
 * `@oci/shared-types` (the contract the admin UI offers as toggleable
 * roles), so the pool always provisions exactly the contract's groups —
 * no hand-maintained list to drift out of sync. See `GROUP_PRECEDENCE`.
 * Advanced security ON in prod for adaptive risk and compromised-creds detection.
 */
export class IdentityStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  /**
   * Secrets Manager secret holding the Cognito user-pool client secret —
   * mirrored from `userPoolClient.userPoolClientSecret`. Web reads it by
   * NAME (`/oci/{env}/cognito/web-client-secret`) at task launch.
   */
  public readonly userPoolClientSecretSm: secretsmanager.Secret;

  /**
   * Machine-to-machine app client for the sealed-run worker (WP2). Mints
   * access tokens carrying `oci-eval/submit-result` — permission to WRITE a
   * result for a run it was dispatched, and nothing else.
   */
  public readonly evalWorkerClient: cognito.UserPoolClient;
  /**
   * Machine-to-machine app client for the EvalAI seam forwarder (WP4). Mints
   * access tokens carrying `oci-eval/seam-intake` — permission to CREATE a
   * submission, and nothing else.
   */
  public readonly evalSeamClient: cognito.UserPoolClient;
  public readonly evalWorkerClientSecretSm: secretsmanager.Secret;
  public readonly evalSeamClientSecretSm: secretsmanager.Secret;

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
      // Account-wide policy: deletion protection on all environments. The
      // dev pool can still be intentionally torn down by flipping this to
      // false in a one-shot CDK deploy first, then running `cdk destroy`
      // (same pattern as the Aurora dev cluster).
      deletionProtection: true,
    });

    // Roles as Cognito groups. GROUP_PRECEDENCE is a total Record over
    // PlatformGroup, so its keys ARE exactly the contract's groups — iterating
    // its entries provisions the full contract set. Adding a role to
    // PlatformGroupSchema forces a precedence here (tsc) before it compiles.
    // (Object.entries avoids a dynamic-key index — security/detect-object-injection.)
    for (const [groupName, precedence] of Object.entries(GROUP_PRECEDENCE)) {
      new cognito.CfnUserPoolGroup(this, `Group-${groupName}`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
        precedence,
      });
    }

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `oci-${props.cfg.envName}-web`,
      // Confidential client (server-side NextAuth code-flow exchange).
      // Generates a client secret on creation; we mirror it into Secrets
      // Manager below so ECS can pull it via secretName at task launch.
      // This change FORCES WebClient replacement (GenerateSecret update
      // requires Replacement per AWS docs). Safe now because the bridge
      // CfnOutputs that previously published the WebClient id are also
      // dropped in this PR — and api/web have already (PR #40 deploy)
      // moved off Fn::ImportValue onto SSM-by-name. Nothing imports
      // the WebClient id any more, so the export-in-use check has
      // nothing to block. SSM `WebClientIdParam` value updates to the
      // new id; api/web tasks restart with the new env.
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

    // ---------------------------------------------------------------------
    // Machine-to-machine credentials for the evaluation backend (#462).
    //
    // These were assumed to exist by code already on main: `EvalWorkerGuard`
    // (WP2) and `EvalSeamGuard` (WP4) both read an app-client id from env and
    // construct no verifier when it is absent, which fails closed. The
    // credential they gate on had never been provisioned, so the sealed-run
    // outbox was rejecting every worker call. Fail-closed was right; the
    // missing client was the defect.
    //
    // TWO clients, not one shared credential. The scopes are the whole point:
    // the sealed-run worker writes results and the seam forwarder creates
    // submissions, they are operated by DIFFERENT parties, and a single
    // credential valid for both would let either side do the other's job —
    // which is exactly what the two separate guards exist to prevent. Cognito
    // enforces the split at token issuance, so the API never has to trust the
    // caller's claim about which role it is playing.
    // ---------------------------------------------------------------------
    const submitResultScope = new cognito.ResourceServerScope({
      scopeName: 'submit-result',
      scopeDescription: 'Write the result of a sealed evaluation run the caller was dispatched',
    });
    const seamIntakeScope = new cognito.ResourceServerScope({
      scopeName: 'seam-intake',
      scopeDescription: 'Create an evaluation submission forwarded from an external front door',
    });

    // The identifier is the scope prefix the API checks: a token's scope
    // string is `<identifier>/<scopeName>`, e.g. `oci-eval/seam-intake`.
    // Keep it stable — it is a literal default in `evaluation.module.ts`.
    const evalResourceServer = this.userPool.addResourceServer('EvalResourceServer', {
      identifier: 'oci-eval',
      userPoolResourceServerName: `oci-${props.cfg.envName}-eval`,
      scopes: [submitResultScope, seamIntakeScope],
    });

    // `authFlows: {}` is deliberate. Left unspecified, Cognito enables the
    // user-facing SRP/custom flows by default, which would let anyone holding
    // a pool user's password authenticate against a machine client. These
    // clients have no interactive purpose: client-credentials only.
    this.evalWorkerClient = this.userPool.addClient('EvalWorkerClient', {
      userPoolClientName: `oci-${props.cfg.envName}-eval-worker`,
      generateSecret: true,
      authFlows: {},
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(evalResourceServer, submitResultScope)],
      },
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
    });

    this.evalSeamClient = this.userPool.addClient('EvalSeamClient', {
      userPoolClientName: `oci-${props.cfg.envName}-eval-seam`,
      generateSecret: true,
      authFlows: {},
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(evalResourceServer, seamIntakeScope)],
      },
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
    });

    // Cross-stack indirection layer: publish identity primitives in SSM
    // (for IDs) and Secrets Manager (for the client secret) under
    // deterministic names. Consumer stacks (api, web) reference these
    // by NAME, not by CFN export — replacing the user pool client
    // doesn't break a CFN-export-in-use deadlock with downstream stacks.
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
    this.userPoolClientSecretSm = new secretsmanager.Secret(this, 'WebClientCognitoSecret', {
      secretName: `/oci/${props.cfg.envName}/cognito/web-client-secret`,
      description: `Cognito user pool client secret for ${props.cfg.envName} web app (NextAuth)`,
      secretStringValue: this.userPoolClient.userPoolClientSecret,
      removalPolicy: props.cfg.removalPolicy,
    });
    // Secrets Manager appends a random 6-char suffix to the ARN even when
    // `secretName` is set explicitly (e.g. `secret:NAME-8k3Wgb`). Importing
    // the secret in web-stack via `fromSecretNameV2` builds an IAM policy
    // ARN with `-??????` (which matches), but the task definition's
    // `valueFrom` then has the same wildcard ARN — ECS calls
    // `GetSecretValue` with that wildcard literally, which doesn't resolve.
    // `fromSecretCompleteArn(BARE)` produced an exact-no-suffix ARN that
    // also doesn't match the live ARN. The reliable answer is to publish
    // the FULL resolved ARN (suffix included) into SSM so consumers can
    // import via `fromSecretCompleteArn` with that token — CFN resolves
    // it at deploy time to the literal ARN, and both the IAM grant and
    // the task def's `valueFrom` reference the same full ARN.
    new ssm.StringParameter(this, 'WebClientCognitoSecretArnParam', {
      parameterName: `/oci/${props.cfg.envName}/cognito/web-client-secret-arn`,
      stringValue: this.userPoolClientSecretSm.secretArn,
      description: `Cognito web app-client secret ARN for ${props.cfg.envName} (consumed by web)`,
    });

    // Machine-client ids: consumed by api-stack as COGNITO_EVAL_*_CLIENT_ID.
    // Same SSM-by-name indirection as the web client, for the same reason —
    // replacing a client must not deadlock api-stack on a CFN export in use.
    new ssm.StringParameter(this, 'EvalWorkerClientIdParam', {
      parameterName: `/oci/${props.cfg.envName}/cognito/eval-worker-client-id`,
      stringValue: this.evalWorkerClient.userPoolClientId,
      description: `Cognito sealed-run worker app-client id for ${props.cfg.envName} (consumed by api)`,
    });
    new ssm.StringParameter(this, 'EvalSeamClientIdParam', {
      parameterName: `/oci/${props.cfg.envName}/cognito/eval-seam-client-id`,
      stringValue: this.evalSeamClient.userPoolClientId,
      description: `Cognito EvalAI seam app-client id for ${props.cfg.envName} (consumed by api)`,
    });

    // The secrets are read by the WORKERS, not by this platform — the API only
    // ever verifies tokens, and never needs either secret. They are mirrored
    // here so an operator can hand a worker its credential from Secrets
    // Manager instead of a Cognito console copy-paste that leaves no trail.
    this.evalWorkerClientSecretSm = new secretsmanager.Secret(this, 'EvalWorkerClientSecret', {
      secretName: `/oci/${props.cfg.envName}/cognito/eval-worker-client-secret`,
      description: `Cognito client secret for the ${props.cfg.envName} sealed-run worker (oci-eval/submit-result)`,
      secretStringValue: this.evalWorkerClient.userPoolClientSecret,
      removalPolicy: props.cfg.removalPolicy,
    });
    this.evalSeamClientSecretSm = new secretsmanager.Secret(this, 'EvalSeamClientSecret', {
      secretName: `/oci/${props.cfg.envName}/cognito/eval-seam-client-secret`,
      description: `Cognito client secret for the ${props.cfg.envName} EvalAI seam forwarder (oci-eval/seam-intake)`,
      secretStringValue: this.evalSeamClient.userPoolClientSecret,
      removalPolicy: props.cfg.removalPolicy,
    });

    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `oci-${props.cfg.envName}` },
      // Managed Login (the new branded sign-in UI, GA Nov 2024) needs
      // the domain provisioned with version 2. Version 1 = the legacy
      // Hosted UI (very limited CSS customisation). The branding
      // resource below targets this domain.
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // Managed Login Branding — platform palette + lockup applied to
    // the hosted sign-in page (#240). Settings shape is the JSON the
    // Cognito branding designer surfaces; values come from the OCI
    // design tokens (see packages/ui/src/theme.css for the canonical
    // hex codes). Light + dark variants both wired so the page honours
    // the visitor's colour-scheme preference.
    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: ociBrandingSettings(),
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomainUrl', { value: this.userPoolDomain.baseUrl() });
    // Everything a worker operator needs to obtain a token, in one place:
    // POST <TokenEndpoint> with grant_type=client_credentials, HTTP basic auth
    // of <client id>:<secret from Secrets Manager>, and scope=oci-eval/<scope>.
    new cdk.CfnOutput(this, 'EvalTokenEndpoint', {
      value: `${this.userPoolDomain.baseUrl()}/oauth2/token`,
      description: 'client_credentials token endpoint for the oci-eval machine clients',
    });
    new cdk.CfnOutput(this, 'EvalWorkerClientId', {
      value: this.evalWorkerClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'EvalSeamClientId', { value: this.evalSeamClient.userPoolClientId });

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

    // Same constraint for the two machine-client secrets (#462), with one
    // difference worth recording: for these, rotation is cheap. Replacing a
    // machine client affects only the worker holding that credential — no
    // signed-in user session is invalidated the way replacing WebClient would
    // do. So the mitigation for the missing automatic rotation is a real
    // operational option here, not just an accepted risk.
    for (const secret of [this.evalWorkerClientSecretSm, this.evalSeamClientSecretSm]) {
      NagSuppressions.addResourceSuppressions(secret, [
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Cognito user-pool app-client secrets are not Secrets-Manager-rotatable (no Cognito API for it). Rotation is by replacing the machine app client, which affects only the worker holding the credential and no interactive user session.',
        },
      ]);
    }

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

/**
 * Settings JSON for the Cognito Managed Login Branding designer
 * (#240). Mirrors the OCI design-token palette (see
 * `packages/ui/src/theme.css`) so the hosted sign-in page reads as a
 * continuation of the rest of the app.
 *
 * The shape matches the request body of `CreateManagedLoginBranding`
 * (see the API reference + example output of
 * `DescribeManagedLoginBrandingByClient`). Three top-level keys:
 *
 *   - `categories`  — Foundation settings (global mode, auth, form,
 *     sign-up). Form colors do **not** live here; they live under
 *     `components.form`.
 *   - `componentClasses` — shared styling for primitives reused across
 *     components (buttons border radius, input, link colours, …).
 *   - `components` — per-component styling (form container, page
 *     background / header / footer, primaryButton, secondaryButton,
 *     idpButton, pageText, …).
 *
 * Light + dark variants live **inside each component** as
 * `lightMode` / `darkMode` keys (NOT as a top-level `darkMode`
 * sibling). Cognito flips between them based on
 * `categories.global.colorSchemeMode` (`LIGHT` / `DARK` /
 * `BROWSER_ADAPTIVE`).
 *
 * Colours are 8-character lowercase hex with alpha (`ff` = opaque),
 * **without** the `#` prefix. `borderRadius` is a JSON number, not a
 * string.
 *
 * IMPORTANT: changing the values requires re-deploying the stack;
 * Cognito holds the snapshot per (user-pool, app-client) and serves
 * it on the hosted page. There's no separate cache to purge.
 */
function ociBrandingSettings(): Record<string, unknown> {
  // OCI palette — hex without `#`, alpha = ff. Sourced from
  // packages/ui/src/theme.css (oklch in app source; hex equivalents
  // here for Cognito's parser).
  const oci = {
    primary: '0f766eff', // teal-700
    primaryHover: '0e5e58ff',
    primaryActive: '0c4d48ff',
    onPrimary: 'ffffffff',
    foreground: '0a1f2cff',
    background: 'ffffffff',
    card: 'ffffffff',
    border: 'd0dbe3ff',
    borderStrong: 'a6b8c5ff',
    mutedForeground: '4d6577ff',
    subtle: 'f4f7f9ff',
    danger: 'b91c1cff',
    // Dark scheme — matches the app's data-theme="dark" set.
    darkForeground: 'e6eff5ff',
    darkBackground: '0a1f2cff',
    darkCard: '102a38ff',
    darkBorder: '1f3949ff',
    darkMutedForeground: 'a6b8c5ff',
    darkPrimary: '2dd4bfff',
    darkPrimaryHover: '5eead4ff',
    darkOnPrimary: '0a1f2cff',
  };

  return {
    categories: {
      auth: {
        authMethodOrder: [
          [
            { display: 'INPUT', type: 'USERNAME_PASSWORD' },
            { display: 'BUTTON', type: 'FEDERATED' },
          ],
        ],
        federation: { interfaceStyle: 'BUTTON_LIST', order: [] },
      },
      form: {
        displayGraphics: true,
        location: { horizontal: 'CENTER', vertical: 'CENTER' },
        sessionTimerDisplay: 'NONE',
      },
      global: {
        // DYNAMIC = the API enum for the UI's "adaptive" mode — page
        // honours the visitor's prefers-color-scheme. Valid values
        // are LIGHT | DARK | DYNAMIC (`BROWSER_ADAPTIVE` is the UI
        // label, not the API enum, and is rejected as InvalidValue).
        colorSchemeMode: 'DYNAMIC',
        spacingDensity: 'REGULAR',
        pageHeader: { enabled: false },
        pageFooter: { enabled: false },
      },
    },
    componentClasses: {
      buttons: { borderRadius: 6.0 },
      input: {
        borderRadius: 6.0,
        lightMode: { defaults: { backgroundColor: oci.card, borderColor: oci.border } },
        darkMode: {
          defaults: { backgroundColor: oci.darkCard, borderColor: oci.darkBorder },
        },
      },
      inputLabel: {
        lightMode: { textColor: oci.foreground },
        darkMode: { textColor: oci.darkForeground },
      },
      inputDescription: {
        lightMode: { textColor: oci.mutedForeground },
        darkMode: { textColor: oci.darkMutedForeground },
      },
      link: {
        lightMode: {
          defaults: { textColor: oci.primary },
          hover: { textColor: oci.primaryHover },
        },
        darkMode: {
          defaults: { textColor: oci.darkPrimary },
          hover: { textColor: oci.darkPrimaryHover },
        },
      },
      focusState: {
        lightMode: { borderColor: oci.primary },
        darkMode: { borderColor: oci.darkPrimary },
      },
      divider: {
        lightMode: { borderColor: oci.border },
        darkMode: { borderColor: oci.darkBorder },
      },
    },
    components: {
      pageBackground: {
        image: { enabled: false },
        lightMode: { color: oci.background },
        darkMode: { color: oci.darkBackground },
      },
      form: {
        borderRadius: 8.0,
        backgroundImage: { enabled: false },
        lightMode: { backgroundColor: oci.card, borderColor: oci.border },
        darkMode: { backgroundColor: oci.darkCard, borderColor: oci.darkBorder },
      },
      pageText: {
        lightMode: {
          headingColor: oci.foreground,
          bodyColor: oci.foreground,
          descriptionColor: oci.mutedForeground,
        },
        darkMode: {
          headingColor: oci.darkForeground,
          bodyColor: oci.darkForeground,
          descriptionColor: oci.darkMutedForeground,
        },
      },
      primaryButton: {
        lightMode: {
          defaults: { backgroundColor: oci.primary, textColor: oci.onPrimary },
          hover: { backgroundColor: oci.primaryHover, textColor: oci.onPrimary },
          active: { backgroundColor: oci.primaryActive, textColor: oci.onPrimary },
          disabled: { backgroundColor: oci.subtle, borderColor: oci.border },
        },
        darkMode: {
          defaults: { backgroundColor: oci.darkPrimary, textColor: oci.darkOnPrimary },
          hover: { backgroundColor: oci.darkPrimaryHover, textColor: oci.darkOnPrimary },
          active: { backgroundColor: oci.darkPrimary, textColor: oci.darkOnPrimary },
          disabled: { backgroundColor: oci.darkCard, borderColor: oci.darkBorder },
        },
      },
      secondaryButton: {
        lightMode: {
          defaults: {
            backgroundColor: oci.card,
            borderColor: oci.primary,
            textColor: oci.primary,
          },
          hover: {
            backgroundColor: oci.subtle,
            borderColor: oci.primaryHover,
            textColor: oci.primaryHover,
          },
          active: {
            backgroundColor: oci.subtle,
            borderColor: oci.primaryActive,
            textColor: oci.primaryActive,
          },
        },
        darkMode: {
          defaults: {
            backgroundColor: oci.darkCard,
            borderColor: oci.darkPrimary,
            textColor: oci.darkPrimary,
          },
          hover: {
            backgroundColor: oci.darkBorder,
            borderColor: oci.darkPrimaryHover,
            textColor: oci.darkPrimaryHover,
          },
          active: {
            backgroundColor: oci.darkBorder,
            borderColor: oci.darkPrimary,
            textColor: oci.darkPrimary,
          },
        },
      },
    },
  };
}
