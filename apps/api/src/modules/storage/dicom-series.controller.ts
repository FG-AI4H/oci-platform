import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  DatasetSlugSchema,
  DicomSeriesVersionQuerySchema,
  type DatasetSlug,
  type DicomSeriesDetail,
  type DicomSeriesList,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { DicomSeriesService } from './dicom-series.service.js';

interface FastifyLikeRequest {
  user?: CognitoAccessTokenPayload;
}

const ACCESS_RULE =
  'Access is that of a download: PRIVATE → host or admin; RESTRICTED → host, admin, or an ' +
  'APPROVED access request; PUBLIC → anyone. A series is made of single-frame images. A file ' +
  'that is held (undecided de-identification findings) is returned to its host and to admins ' +
  'only; for everyone else it is absent, and a series made only of held files is a 404.';

/**
 * `/v2/storage/...` — the two read endpoints of the DICOM series index
 * (#674, ADR-0026). The built-in viewer needs nothing else from the
 * API: it lists the series of a dataset version, asks for one, and
 * fetches each file from storage with the address it was given.
 *
 * Both routes accept an anonymous caller, because a PUBLIC dataset is
 * readable without an account. Authorisation is in the service.
 */
@ApiTags('storage')
@ApiBearerAuth()
@Controller({ path: 'storage', version: '2' })
export class DicomSeriesController {
  constructor(@Inject(DicomSeriesService) private readonly series: DicomSeriesService) {}

  @Get('datasets/:slug/dicom/series')
  @UseGuards(OptionalCognitoJwtGuard)
  // The answer depends on who asks (held files), so nothing may reuse it.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The DICOM series of a dataset version',
    description:
      'One entry per series with at least one image the caller can open, by study, then series ' +
      `number. At most 500 are returned; \`total\` gives the count. ${ACCESS_RULE}`,
  })
  @ApiParam({ name: 'slug', description: 'Dataset slug' })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Dataset version, e.g. 1.0.0. Default: the latest.',
  })
  @ApiOkResponse({ description: 'DicomSeriesList' })
  list(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Query('version', new ZodPipe(DicomSeriesVersionQuerySchema)) version: string | undefined,
    @Req() req: FastifyLikeRequest,
  ): Promise<DicomSeriesList> {
    return this.series.listForDataset({ slug, version, user: req.user });
  }

  @Get('dicom/series/:id')
  @UseGuards(OptionalCognitoJwtGuard)
  // Carries signed storage addresses.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'One DICOM series: its instances in display order, with storage addresses',
    description:
      'Each instance carries a signed storage address, valid until `expiresAt` (15 minutes at most), ' +
      'that the browser fetches the file from directly. Instances are ordered along the stack, ' +
      `in the direction the scanner numbered them. ${ACCESS_RULE}`,
  })
  @ApiParam({ name: 'id', description: 'Series id, from the series list' })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Dataset version, e.g. 1.0.0. Default: the latest.',
  })
  @ApiOkResponse({ description: 'DicomSeriesDetail' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('version', new ZodPipe(DicomSeriesVersionQuerySchema)) version: string | undefined,
    @Req() req: FastifyLikeRequest,
  ): Promise<DicomSeriesDetail> {
    return this.series.getSeries({ seriesId: id, version, user: req.user });
  }
}
