import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CompleteUploadRequestSchema,
  DatasetSlugSchema,
  InitUploadRequestSchema,
  type CompleteUploadRequest,
  type DatasetSlug,
  type InitUploadRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { StorageService } from './storage.service.js';

interface FastifyLikeReply {
  redirect(url: string, statusCode?: number): unknown;
}
interface FastifyLikeRequest {
  user?: CognitoAccessTokenPayload;
}

/**
 * `/v2/catalog/datasets/:slug/...` — multipart upload + gated download
 * for self-hosted distributions (PR I, #87).
 *
 * Two auth modes per route:
 *   - Upload endpoints: strict JWT + host check inside the service.
 *   - Download endpoint: opportunistic JWT (anonymous PUBLIC reads
 *     allowed once we wire that path; today we still require auth
 *     to keep the local stack consistent with the rest of the
 *     catalog).
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller({ version: '2' })
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Post('catalog/datasets/:slug/uploads')
  @UseGuards(CognitoJwtGuard)
  @HttpCode(201)
  @ApiOperation({ summary: 'Initiate a multipart upload (host-only)' })
  @ApiOkResponse({ description: 'Returns uploadId, key, partSize.' })
  init(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Body(new ZodPipe(InitUploadRequestSchema)) body: InitUploadRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.storage.initUpload(slug, body, user);
  }

  @Get('catalog/datasets/:slug/uploads/:uploadId/parts/:partNumber/url')
  @UseGuards(CognitoJwtGuard)
  @ApiOperation({ summary: 'Mint a presigned PUT URL for one part' })
  partUrl(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Param('uploadId') uploadId: string,
    @Param('partNumber', new ParseIntPipe()) partNumber: number,
    @Query('key') key: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.storage.getPartUrl({ slug, uploadId, key, partNumber, user });
  }

  @Post('catalog/datasets/:slug/uploads/:uploadId/complete')
  @UseGuards(CognitoJwtGuard)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Finalise a multipart upload — persists the Distribution row',
  })
  complete(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Param('uploadId') uploadId: string,
    @Query('key') key: string,
    @Query('contentType') contentType: string,
    @Query('contentSize', new ParseIntPipe()) contentSize: number,
    @Query('sha256') sha256: string | undefined,
    @Body(new ZodPipe(CompleteUploadRequestSchema)) body: CompleteUploadRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.storage.completeUpload({
      slug,
      uploadId,
      key,
      body,
      user,
      contentType,
      contentSize,
      sha256: sha256 ?? null,
    });
  }

  @Post('catalog/datasets/:slug/uploads/:uploadId/abort')
  @UseGuards(CognitoJwtGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Abort an in-flight multipart upload' })
  async abort(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Param('uploadId') uploadId: string,
    @Query('key') key: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<void> {
    await this.storage.abortUpload({ slug, uploadId, key, user });
  }

  @Get('catalog/datasets/:slug/distributions/:distributionId/download')
  @UseGuards(OptionalCognitoJwtGuard)
  @ApiOperation({
    summary: 'Gated download — 302 to a 15-min presigned S3 GET',
    description:
      'Authz: PUBLIC + !requiresAccess → any auth caller. RESTRICTED OR requiresAccess → caller has APPROVED AccessRequest. PRIVATE → host or admin.',
  })
  async download(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Param('distributionId', new ParseUUIDPipe()) distributionId: string,
    @Req() req: FastifyLikeRequest,
    @Res({ passthrough: false }) reply: FastifyLikeReply,
  ): Promise<void> {
    const url = await this.storage.getDownloadUrl({
      slug,
      distributionId,
      user: req.user,
    });
    reply.redirect(url, 302);
  }
}
