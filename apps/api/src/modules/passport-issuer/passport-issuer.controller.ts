import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  IssuedPassportVisaJwt,
  JwksResponse,
  ListIssuedPassportVisasResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { PassportIssuerService } from './passport-issuer.service.js';
import { PassportKeyService } from './passport-key.service.js';

/**
 * `GET /.well-known/jwks.json` — RFC 7517 §5. Public, no auth.
 *
 * The endpoint is mounted at the root rather than `/v2/...` because
 * the well-known prefix is what every JOSE/Passport verifier expects
 * by convention; that's the discovery contract.
 */
@ApiTags('passport-issuer')
@Controller()
export class JwksController {
  constructor(@Inject(PassportKeyService) private readonly keyService: PassportKeyService) {}

  @Get('.well-known/jwks.json')
  @ApiOperation({ summary: 'Public JWKS for the OCI Passport issuer' })
  @ApiOkResponse({ description: 'RFC 7517 JWKS — keys[] of public-JWK shape.' })
  async jwks(): Promise<JwksResponse> {
    const keys = await this.keyService.listPublishedKeys();
    return { keys };
  }
}

/**
 * `/v2/me/passport/issued/*` — the caller's OCI-issued visas + the
 * on-demand JWT-materialise endpoint.
 *
 * Mounted under `/me` so it's clearly per-caller; admin-side endpoints
 * for inspecting another user's issued visas are intentionally not
 * exposed here.
 */
@ApiTags('passport-issuer')
@ApiBearerAuth()
@Controller({ path: 'me/passport/issued', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MyIssuedVisasController {
  constructor(@Inject(PassportIssuerService) private readonly service: PassportIssuerService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's OCI-issued visas" })
  @ApiOkResponse({
    description: 'ListIssuedPassportVisasResponse — one summary per persisted row.',
  })
  list(@CurrentUser() user: CognitoAccessTokenPayload): Promise<ListIssuedPassportVisasResponse> {
    return this.service.listIssuedForUser(user);
  }

  @Get(':id/jwt')
  @ApiOperation({ summary: 'Materialise a freshly-signed JWT for the visa row' })
  @ApiOkResponse({
    description: 'IssuedPassportVisaJwt — opaque JWT the caller can hand to a verifier.',
  })
  materialize(
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<IssuedPassportVisaJwt> {
    return this.service.materializeJwt(user, id);
  }
}
