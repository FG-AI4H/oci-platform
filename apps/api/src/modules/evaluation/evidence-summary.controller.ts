import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { EvidenceSummary } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { z } from 'zod';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { EvidenceSummaryService } from './evidence-summary.service.js';

const SubmissionIdSchema = z.string().uuid();

/**
 * `/v2/evaluation/submissions/:id/evidence` — the evidence summary of one
 * submission (#652), the JSON behind the printable page. Read-only.
 */
@ApiTags('evaluation')
@Controller({ path: 'evaluation', version: '2' })
export class EvidenceSummaryController {
  constructor(@Inject(EvidenceSummaryService) private readonly evidence: EvidenceSummaryService) {}

  @Get('submissions/:id/evidence')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Evidence summary of one submission (submitter, admin, evaluation-reviewer, regulator)',
    description:
      'Intended use (from a linked model card), the data and how its reference labels were made, the evaluation method version and its review, the metrics with their intervals, the results by subgroup with small groups withheld, the gaps in this evidence, and the submission’s audit events with their hashes. No predictions, no reference labels, no person. A FAILED submission is answered to its submitter and administrators only.',
  })
  @ApiOkResponse({ description: 'oci-evidence-summary/v1.' })
  @ApiForbiddenResponse({ description: 'Signed in, but not a reader of this summary.' })
  @ApiNotFoundResponse({
    description: 'No such submission, or a failed one the caller is not entitled to read.',
  })
  @UseGuards(CognitoJwtGuard)
  get(
    @Param('id', new ZodPipe(SubmissionIdSchema)) id: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<EvidenceSummary> {
    return this.evidence.getEvidence(id, user);
  }
}
