import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateEvaluationTaskRequestSchema,
  EvaluationTaskSlugSchema,
  LinkSubmissionModelCardRequestSchema,
  type CreateEvaluationTaskRequest,
  type EvaluationTaskSlug,
  type LinkSubmissionModelCardRequest,
} from '@oci/shared-types';
import { z } from 'zod';
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

/** A submission is addressed by its uuid. Anything else is a 400, not a lookup. */
const SubmissionIdSchema = z.string().uuid();

/**
 * `/v2/evaluation/*` — the minimal model-to-data scoring surface (ADR-0017,
 * Mode 1). Auth model:
 *
 *   - GET endpoints: public. Ground truth is NEVER returned. Two exceptions:
 *     one submission's result is public unless it FAILED, in which case only
 *     its submitter and administrators get it (so that route reads the token
 *     when one is sent); and the caller's own quota needs a token, because
 *     there is no quota without a participant.
 *   - POST submissions: public (Mode 1). The optional JWT guard captures
 *     the submitter's identity when a token is present; anonymous
 *     submissions are allowed and recorded with a null submitter.
 *   - PATCH a submission's model card (#587): required JWT; the service
 *     checks the caller made the submission and filed the card.
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

  @Get('tasks/:slug/quota')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Scored submissions the caller has left on a task',
    description:
      'The weekly and per-task limits in force on this environment, how many scored submissions the caller has used against each, and the smaller remainder. Validation submissions and predictions files refused for a format error are not counted.',
  })
  @ApiOkResponse({ description: 'Limits, usage and what remains, for the caller.' })
  @UseGuards(CognitoJwtGuard)
  quota(
    @Param('slug', new ZodPipe(EvaluationTaskSlugSchema)) slug: EvaluationTaskSlug,
    @Req() req: FastifyLikeRequest,
  ) {
    return this.evaluation.getScoredQuota(slug, req.user);
  }

  @Get('tasks/:slug/submissions/:id')
  @ApiOperation({
    summary: 'Get one submission with its full result (no predictions, no ground truth)',
    description:
      'The metrics (for a classification task, with the per-class breakdown), the evaluation method version that produced them and where it stands in review. A SCORED or PENDING submission is public. A FAILED one is returned, with the reason, to its submitter and to administrators only; anyone else gets 404.',
  })
  @ApiOkResponse({ description: 'The submission, its scores and its attribution.' })
  @ApiNotFoundResponse({
    description:
      'No such submission on this task, or a failed one the caller is not entitled to read.',
  })
  @UseGuards(OptionalCognitoJwtGuard)
  submissionDetail(
    @Param('slug', new ZodPipe(EvaluationTaskSlugSchema)) slug: EvaluationTaskSlug,
    @Param('id', new ZodPipe(SubmissionIdSchema)) id: string,
    @Req() req: FastifyLikeRequest,
  ) {
    return this.evaluation.getSubmissionDetail(slug, id, req.user);
  }

  @Post('tasks/:slug/submissions')
  @ApiOperation({
    summary: 'Submit predictions (Mode 1) or a sealed container (Mode 2)',
    description:
      'With `intent: VALIDATION` (either mode): checks the submission against the task interface and returns a report; nothing is scored, stored or counted against the quota, and no account is needed. Otherwise, without `mode`, or with `mode: PREDICTIONS`: scores the predictions against the task’s hidden ground truth and records the result, returning the new submission id + its scores; a format error (an identifier sent twice, a label outside the task’s range) records a FAILED submission that does not count against the quota, and returns 400 with its id. With `mode: CONTAINER`: records a PENDING submission and enqueues a sealed run — nothing is scored in-process, and the result arrives later through the worker outbox. Returns 503 if sealed execution is not configured on this environment.',
  })
  @ApiOkResponse({ description: 'Mode 1: submission id + computed scores. Mode 2: id + PENDING.' })
  @UseGuards(OptionalCognitoJwtGuard)
  submit(
    @Param('slug', new ZodPipe(EvaluationTaskSlugSchema)) slug: EvaluationTaskSlug,
    @Body(SubmissionBodyPipe) body: SubmitRequestBody,
    @Req() req: FastifyLikeRequest,
  ) {
    // `intent: VALIDATION` checks the interface and writes nothing: no row,
    // no score, no quota, nothing on the leaderboard. The validation path
    // takes no user on purpose, so it cannot consume quota. It existed
    // since #437 but nothing routed to it, so every validation submission
    // was scored and published.
    if (isContainerSubmission(body)) {
      return body.intent === 'VALIDATION'
        ? this.evaluation.validateContainer(slug, body)
        : this.evaluation.submitContainer(slug, body, req.user);
    }
    return body.intent === 'VALIDATION'
      ? this.evaluation.validatePredictions(slug, body)
      : this.evaluation.submitPredictions(slug, body, req.user);
  }

  @Patch('submissions/:id/model-card')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Link a submission to the model card it scored, or remove the link',
    description:
      'Body `{ "modelCardId": "<uuid>" }` links the submission to that model card, or moves the link to it; `{ "modelCardId": null }` removes the link. Only the participant who made the submission may change its link, and only to a model card they submitted themselves. A WITHDRAWN card takes no new results. Restating the current link changes nothing. The linked results feed the card’s Model Facts label: published when produced by an approved evaluation method version, provisional otherwise.',
  })
  @ApiOkResponse({ description: 'The submission id and the card it is now linked to (or null).' })
  @ApiNotFoundResponse({ description: 'No such submission, or no such model card.' })
  @UseGuards(CognitoJwtGuard)
  linkModelCard(
    @Param('id', new ZodPipe(SubmissionIdSchema)) id: string,
    @Body(new ZodPipe(LinkSubmissionModelCardRequestSchema)) body: LinkSubmissionModelCardRequest,
    @Req() req: FastifyLikeRequest,
  ) {
    // The required guard sets `user`; a missing one is still refused here
    // rather than passed on as an anonymous caller.
    if (!req.user) throw new UnauthorizedException();
    return this.evaluation.linkModelCard(id, body, req.user);
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
    @Req() req: FastifyLikeRequest,
  ) {
    // The caller is the actor of the `evaluation.task.created` audit event.
    return this.evaluation.createTask(body, req.user);
  }
}
