import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  DatasetSlugSchema,
  RecordDicomFindingDecisionRequestSchema,
  type DatasetSlug,
  type DicomFindingDecisionResult,
  type DicomFindingsReview,
  type DicomHeldDatasetList,
  type RecordDicomFindingDecisionRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { DicomReviewService } from './dicom-review.service.js';

/**
 * `/v2/storage/...` — the operator's review of held DICOM files
 * (#674, ADR-0026, decision 2).
 *
 * Operators only: the guards on the class admit a signed-in member of
 * the `admin` group and nobody else, on every route. The dataset's
 * host is NOT admitted as such: the host uploads, the operator decides.
 *
 * Never cached: one route returns header values that may identify a
 * patient.
 */
@ApiTags('storage')
@ApiBearerAuth()
@Controller({ path: 'storage', version: '2' })
@UseGuards(CognitoJwtGuard, RolesGuard)
@Roles('admin')
export class DicomReviewController {
  constructor(@Inject(DicomReviewService) private readonly review: DicomReviewService) {}

  @Get('dicom/held')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Datasets with held DICOM files (operators only)' })
  @ApiOkResponse({ description: 'DicomHeldDatasetList' })
  listHeld(): Promise<DicomHeldDatasetList> {
    return this.review.listHeld();
  }

  @Get('datasets/:slug/dicom/findings')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Undecided de-identification findings of a dataset (operators only)',
    description:
      'One entry per (attribute, value) found on held files and not accepted yet, with the ' +
      'number of files and series it is on. `value` is read from a stored file for this ' +
      'response and is stored nowhere: it may identify a patient.',
  })
  @ApiParam({ name: 'slug', description: 'Dataset slug' })
  @ApiOkResponse({ description: 'DicomFindingsReview' })
  @ApiNotFoundResponse({ description: 'No such dataset.' })
  findings(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
  ): Promise<DicomFindingsReview> {
    return this.review.review(slug);
  }

  @Post('datasets/:slug/dicom/findings/decisions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Accept findings of a dataset, with a reason (operators only)',
    description:
      'Releases every held file whose findings are now all accepted, and writes one audit ' +
      'event. Findings are named by attribute and digest, as the findings list returned them. ' +
      'A finding with a value is accepted for the dataset and also covers later uploads; a ' +
      'finding about a whole file is accepted on the files held now only.',
  })
  @ApiParam({ name: 'slug', description: 'Dataset slug' })
  @ApiCreatedResponse({ description: 'DicomFindingDecisionResult' })
  @ApiNotFoundResponse({ description: 'No such dataset.' })
  @ApiConflictResponse({ description: 'None of the findings is waiting for a decision.' })
  @ApiUnprocessableEntityResponse({
    description: 'A selected value could not be read back, or is too long to be shown whole.',
  })
  decide(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Body(new ZodPipe(RecordDicomFindingDecisionRequestSchema))
    body: RecordDicomFindingDecisionRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<DicomFindingDecisionResult> {
    return this.review.decide({ slug, body, user });
  }
}
