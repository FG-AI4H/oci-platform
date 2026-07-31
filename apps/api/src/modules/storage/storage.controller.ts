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
import { BulkDownloadManifestFlagSchema } from './bulk-download-query.js';
import { BulkDownloadService } from './bulk-download.service.js';
import { StorageService } from './storage.service.js';

interface FastifyLikeReply {
  redirect(url: string, statusCode?: number): unknown;
}
/**
 * Fastify's reply, narrowed to what the ZIP route needs. `send()`
 * accepts a Readable natively — this is why the route takes
 * `@Res({ passthrough: false })` rather than returning a
 * `StreamableFile` (which Nest's Express-shaped helper wraps).
 */
interface FastifyLikeStreamReply {
  header(name: string, value: string): unknown;
  send(payload: unknown): unknown;
}
interface FastifyLikeRequest {
  user?: CognitoAccessTokenPayload;
}

/**
 * `Content-Disposition` with both the plain and RFC 5987 forms. Slugs
 * are already `[a-z0-9-]` (DatasetSlugSchema), so the ASCII form is
 * always exact; `filename*` is belt-and-braces for any future
 * non-ASCII archive name.
 */
function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
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
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(BulkDownloadService) private readonly bulk: BulkDownloadService,
  ) {}

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

  @Get('catalog/datasets/:slug/download')
  @UseGuards(OptionalCognitoJwtGuard)
  @ApiOperation({
    summary: 'Bulk download — stream the whole dataset as a ZIP',
    description:
      'Archives every platform-hosted (storageBackend=S3, uploadStatus=READY), non-access-gated ' +
      'distribution of the latest published version, plus a mandatory LICENSE.txt and CITATION.txt. ' +
      'Pass `?manifest=true` to include croissant.json. Externally-hosted distributions are never ' +
      'proxied. Authz is identical to the single-distribution download: PRIVATE → host or admin; ' +
      'RESTRICTED → host, admin, or an APPROVED AccessRequest; PUBLIC → anyone. ' +
      '409 when nothing is eligible, 413 when the total exceeds OCI_BULK_DOWNLOAD_MAX_BYTES.',
  })
  async downloadAll(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Query('manifest', new ZodPipe(BulkDownloadManifestFlagSchema)) manifest: boolean,
    @Req() req: FastifyLikeRequest,
    @Res({ passthrough: false }) reply: FastifyLikeStreamReply,
  ): Promise<void> {
    // `plan` throws every 4xx before we touch the reply, so the status
    // line is never committed ahead of a failure.
    const plan = await this.bulk.plan({ slug, includeManifest: manifest, user: req.user });
    const zip = this.bulk.buildZip(plan);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', attachmentDisposition(`${slug}.zip`));
    // The archive is assembled per-request (timestamped notices, live
    // eligibility) — never let a proxy or the browser reuse it.
    reply.header('Cache-Control', 'no-store');
    reply.send(zip);
  }
}
