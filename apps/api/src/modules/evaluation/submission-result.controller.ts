import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SealedRunResultSchema, type SealedRunResult } from '@oci/shared-types';
import { z } from 'zod';
import { ZodPipe } from './dto/zod-pipe.js';
import { EvalWorkerGuard } from './eval-worker.guard.js';
import { SubmissionResultService } from './submission-result.service.js';

const SubmissionIdSchema = z.string().uuid();

/**
 * `/v2/submissions/:id/result` — the sealed-run result outbox
 * (sealed-execution-contract §5). Called by `worker-eval`, never by a
 * participant: `EvalWorkerGuard` requires a Cognito token minted for the
 * worker's machine-to-machine client and carrying the worker scope.
 *
 * Deliberately NOT under `/v2/evaluation/*`: the path is part of a contract
 * already published in `apps/worker-eval/README.md` and mirrored in the
 * worker's Pydantic models, so it is fixed.
 *
 * `@HttpCode(200)` because the endpoint is idempotent — a replay of an
 * already-applied result is a 200 no-op, and answering 201 on the first
 * delivery and 200 on a replay would make the two distinguishable by status
 * code for no benefit.
 */
@ApiTags('evaluation')
@Controller({ path: 'submissions', version: '2' })
export class SubmissionResultController {
  // Explicit @Inject token — same tsx reflector caveat as the other
  // controllers in this module.
  constructor(@Inject(SubmissionResultService) private readonly results: SubmissionResultService) {}

  @Post(':id/result')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record a sealed-run result (worker only, idempotent)',
    description:
      'Exactly one of `predictions`, `metrics` or `failure`. `predictions` are scored server-side against the task’s hidden ground truth; `metrics` are stored as submitted by a host-resident run; `failure` records a classified code. Replaying the same result for a terminal submission is a 200 no-op; a different result is a 409. The operator detail on a failure is logged and never returned.',
  })
  @ApiOkResponse({ description: 'The submission’s resulting status + scores or failure code.' })
  @UseGuards(EvalWorkerGuard)
  recordResult(
    @Param('id', new ZodPipe(SubmissionIdSchema)) id: string,
    @Body(new ZodPipe(SealedRunResultSchema)) body: SealedRunResult,
  ) {
    return this.results.recordResult(id, body);
  }
}
