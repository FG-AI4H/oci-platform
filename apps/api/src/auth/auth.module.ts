import { Logger, Module } from '@nestjs/common';
import { createAccessTokenVerifier } from '@oci/auth';
import { COGNITO_VERIFIER, CognitoJwtGuard } from './cognito-jwt.guard.js';

/**
 * Provides the singleton Cognito access-token verifier (loads JWKS once
 * and caches keys) and the JWT guard. Other modules import AuthModule
 * and use `@UseGuards(CognitoJwtGuard)` on protected controllers /
 * routes.
 *
 * Configuration comes from process env (set on the ECS task definition
 * by api-stack):
 *   COGNITO_USER_POOL_ID         (e.g. eu-central-1_JuZ0AIu8N)
 *   COGNITO_USER_POOL_CLIENT_ID  (Cognito app-client id of @oci/web)
 *   COGNITO_REGION               (eu-central-1)
 *
 * Dev-friendly fallback: if any of these are missing, the verifier
 * provider returns a stub that always throws — so unprotected routes
 * keep working but `@UseGuards(CognitoJwtGuard)` gives a clear 401.
 */
@Module({
  providers: [
    {
      provide: COGNITO_VERIFIER,
      useFactory: () => {
        const logger = new Logger('CognitoVerifier');
        const userPoolId = process.env.COGNITO_USER_POOL_ID;
        const clientId = process.env.COGNITO_USER_POOL_CLIENT_ID;
        if (!userPoolId || !clientId) {
          logger.warn(
            'COGNITO_USER_POOL_ID or COGNITO_USER_POOL_CLIENT_ID not set — JWT guard will reject all requests',
          );
          return {
            verify: async () => {
              throw new Error('cognito verifier not configured');
            },
          };
        }
        return createAccessTokenVerifier({
          userPoolId,
          clientId,
          region: process.env.COGNITO_REGION ?? 'eu-central-1',
        });
      },
    },
    CognitoJwtGuard,
  ],
  exports: [COGNITO_VERIFIER, CognitoJwtGuard],
})
export class AuthModule {}
