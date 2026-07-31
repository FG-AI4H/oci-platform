import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateEvaluationTaskRequestSchema,
  EvaluationTaskSlugSchema,
  type CreateEvaluationTaskRequest,
  type EvaluationTaskSlug,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import {
  isContainerSubmission,
  SubmissionBodyPipe,
  type SubmitRequestBody,
} from './dto/submission-body.pipe.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { EvaluationService } from './evaluation.service.js';

interface FastifyLikeRequest {
  user?: CognitoAccessTokenPayload;
}

/**
 * `/v2/evaluation/*` — the minimal model-to-data scoring surface (ADR-0017,
 * Mode 1). Auth model:
 *
 *   - GET endpoints: public. Ground truth is NEVER returned.
 *   - POST submissions: public (Mode 1). The optional JWT guard captures
 *     the submitter's identity when a token is present; anonymous
 *     submissions are allowed and recorded with a null submitter.
 *   - POST tasks: required JWT + `host` (or `admin`) group — this is the
 *     only non-SQL path that creates a task together with its HIDDEN
 *     ground-truth labels.
 */
@ApiTags('evaluation')
@Controller({ path: 'evaluation', version: '2' })
export class EvaluationController {
  // Explicit @Inject token — see the note in CatalogController: tsx-based
  // local dev doesn't surface constructor param types to Nest's reflector.
  constructor(@Inject(EvaluationService) private readonly evaluation: EvaluationService) {}

  @Get('tasks')
  @ApiOperation({ summary: 'List evaluation tasks (public; no ground truth)' })
  @ApiOkResponse({ description: 'Task summaries with submission counts.' })
  listTasks() {
    return this.evaluation.listTasks();
  }

  @Get('tasks/:slug')
  @ApiOperation({ summary: 'Get an evaluation task + its results (public; no ground truth)' })
  @ApiOkResponse({ description: 'Task meta + submissions, ordered best-QWK first.' })
  taskDetail(@Param('slug', new ZodPipe(EvaluationTaskSlugSchema)) slug: EvaluationTaskSlug) {
    return this.evaluation.getTaskDetail(slug);
  }

  @Post('tasks/:slug/submissions')
  @ApiOperation({
    summary: 'Submit predictions (Mode 1) or a sealed container (Mode 2)',
    description:
      'Without `mode`, or with `mode: PREDICTIONS`: scores the predictions against the task’s hidden ground truth and records the result, returning the new submission id + its scores; a validation / scoring error records a FAILED submission and returns 400. With `mode: CONTAINER`: records a PENDING submission and enqueues a sealed run — nothing is scored in-process, and the result arrives later through the worker outbox. Returns 503 if sealed execution is not configured on this environment.',
  })
  @ApiOkResponse({ description: 'Mode 1: submission id + computed scores. Mode 2: id + PENDING.' })
  @UseGuards(OptionalCognitoJwtGuard)
  submit(
    @Param('slug', new ZodPipe(EvaluationTaskSlugSchema)) slug: EvaluationTaskSlug,
    @Body(SubmissionBodyPipe) body: SubmitRequestBody,
    @Req() req: FastifyLikeRequest,
  ) {
    if (isContainerSubmission(body)) {
      return this.evaluation.submitContainer(slug, body, req.user);
    }
    return this.evaluation.submitPredictions(slug, body, req.user);
  }

  @Post('tasks')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create an evaluation task + hidden ground truth (host/admin only)',
  })
  @UseGuards(CognitoJwtGuard, RolesGuard)
  @Roles('host', 'admin')
  createTask(
    @Body(new ZodPipe(CreateEvaluationTaskRequestSchema)) body: CreateEvaluationTaskRequest,
  ) {
    return this.evaluation.createTask(body);
  }
}
