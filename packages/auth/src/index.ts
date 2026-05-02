import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

export function createAccessTokenVerifier(cfg: CognitoConfig) {
  return CognitoJwtVerifier.create({
    userPoolId: cfg.userPoolId,
    tokenUse: 'access',
    clientId: cfg.clientId,
  });
}

export function createIdTokenVerifier(cfg: CognitoConfig) {
  return CognitoJwtVerifier.create({
    userPoolId: cfg.userPoolId,
    tokenUse: 'id',
    clientId: cfg.clientId,
  });
}

export type CognitoAccessToken = {
  sub: string;
  username: string;
  'cognito:groups'?: string[];
  scope: string;
  token_use: 'access';
  exp: number;
};
