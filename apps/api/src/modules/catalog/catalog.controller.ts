import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateDatasetRequestSchema,
  DatasetSlugSchema,
  ListDatasetsQuerySchema,
  PublishDatasetVersionRequestSchema,
  type CreateDatasetRequest,
  type DatasetSlug,
  type ListDatasetsQuery,
  type PublishDatasetVersionRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { Roles, RolesGuard } from './roles.guard.js';
import { CatalogService } from './catalog.service.js';

interface FastifyLikeRequest {
  user?: CognitoAccessTokenPayload;
  protocol?: string;
  hostname?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * `/v2/catalog/*` — public read endpoints, host-gated write endpoints,
 * and the federation index. Auth model:
 *
 *   - GET endpoints: anonymous-friendly. The CognitoJwtGuard runs
 *     opportunistically (CurrentUser may be undefined); the service
 *     filters visibility based on the caller's group membership.
 *     Anonymous → PUBLIC + PUBLISHED only.
 *   - POST endpoints: required JWT + `host` (or `admin`) group.
 *
 * The `.well-known/croissant-catalog.json` is intentionally anonymous +
 * unauthenticated — it's the federation contract with other catalogs.
 */
@ApiTags('catalog')
@Controller({ path: 'catalog', version: '2' })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('datasets')
  @ApiOperation({ summary: 'List / search datasets (visibility-filtered)' })
  @ApiOkResponse({ description: 'Page of dataset summaries with cursor.' })
  @UseGuards(OptionalCognitoJwtGuard)
  list(
    @Query(new ZodPipe(ListDatasetsQuerySchema)) query: ListDatasetsQuery,
    @Req() req: FastifyLikeRequest,
  ) {
    return this.catalog.list(query, req.user);
  }

  @Get('datasets/:slug')
  @ApiOperation({ summary: 'Get a dataset detail by slug' })
  @ApiOkResponse({ description: 'Dataset detail with versions and distributions.' })
  @UseGuards(OptionalCognitoJwtGuard)
  detail(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Req() req: FastifyLikeRequest,
  ) {
    return this.catalog.detail(slug, req.user);
  }

  @Get('datasets/:slug/croissant')
  @ApiOperation({ summary: 'Download the latest published Croissant manifest' })
  @ApiOkResponse({
    description: 'JSON-LD manifest. Conformance per `dct:conformsTo` in the body.',
  })
  @UseGuards(OptionalCognitoJwtGuard)
  manifest(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Req() req: FastifyLikeRequest,
  ) {
    return this.catalog.manifest(slug, req.user);
  }

  @Get('.well-known/croissant-catalog.json')
  @ApiOperation({
    summary: 'Outbound Croissant catalog index (federation-friendly)',
    description:
      'Lists every PUBLIC + PUBLISHED dataset as a JSON-LD `sc:DataCatalog` so other Croissant catalogues can harvest with one fetch. Anonymous, no auth required.',
  })
  @ApiOkResponse({ description: 'Croissant catalog index.' })
  federationIndex(@Req() req: FastifyLikeRequest) {
    const proto =
      typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto']
        : (req.protocol ?? 'https');
    const host =
      typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host']
        : typeof req.headers.host === 'string'
          ? req.headers.host
          : (req.hostname ?? 'oci.ai4h.net');
    const baseUrl = `${proto}://${host}`;
    return this.catalog.federationIndex(baseUrl);
  }

  @Post('datasets')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a draft dataset (host-only)' })
  @UseGuards(CognitoJwtGuard, RolesGuard)
  @Roles('host', 'admin')
  create(
    @Body(new ZodPipe(CreateDatasetRequestSchema)) body: CreateDatasetRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.catalog.create(body, user);
  }

  @Post('datasets/:slug/versions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Publish a Croissant manifest as a new dataset version (host-only)',
    description:
      'Validates the manifest against Croissant 1.1 + RAI + BIOCroissant v0.1, mirrors distributions to the database, and bumps the dataset to PUBLISHED.',
  })
  @UseGuards(CognitoJwtGuard, RolesGuard)
  @Roles('host', 'admin')
  publishVersion(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Body(new ZodPipe(PublishDatasetVersionRequestSchema)) body: PublishDatasetVersionRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.catalog.publishVersion(slug, body, user);
  }
}
