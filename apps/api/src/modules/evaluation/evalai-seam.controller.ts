import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SeamIntakeRequestSchema, type SeamIntakeRequest } from '@oci/shared-types';
import { ZodPipe } from './dto/zod-pipe.js';
import { EvalAiSeamService } from './evalai-seam.service.js';
import { EvalSeamGuard } from './eval-seam.guard.js';

/**
 * `/v2/evaluation/seam/evalai` — intake from the organizer-run EvalAI remote
 * worker (WP4, #408).
 *
 * Separate from the participant endpoint by design. That one permits anonymous
 * submissions; if it also accepted `externalSubmissionId`, any caller could
 * claim another entrant's EvalAI submission and the write-back would post their
 * result onto a stranger's row. This route requires the seam's own machine
 * credential — distinct from the sealed-run worker's, so neither can do the
 * other's job.
 */
@ApiTags('evaluation-seam')
@Controller({ path: 'evaluation/seam/evalai', version: '2' })
export class EvalAiSeamController {
  constructor(@Inject(EvalAiSeamService) private readonly seam: EvalAiSeamService) {}

  @Post('submissions')
  @HttpCode(202)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Intake an EvalAI submission (organizer-run remote worker only)',
    description:
      'A dev/validation phase returns the interface check synchronously and creates nothing. A test phase records a SCORED submission attributed to the EvalAI participant_team, and the result is delivered back to EvalAI by the write-back — never in this response.',
  })
  @ApiOkResponse({ description: '202 with the OCI submission id, or the validation outcome.' })
  @UseGuards(EvalSeamGuard)
  intake(@Body(new ZodPipe(SeamIntakeRequestSchema)) body: SeamIntakeRequest) {
    return this.seam.intake(body);
  }
}
