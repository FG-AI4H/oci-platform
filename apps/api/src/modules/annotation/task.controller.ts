import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CampaignSlugSchema,
  SeedTasksRequestSchema,
  SubmitAssignmentRequestSchema,
  type CampaignSlug,
  type SeedTasksRequest,
  type SubmitAssignmentRequest,
} from '@oci/shared-types';
import { z } from 'zod';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { TaskService } from './task.service.js';

const AssignmentIdSchema = z.string().uuid();

/**
 * Task workflow surface — slice 2 of #215.
 *
 *   POST /v2/annotation/campaigns/:slug/tasks            (seed)
 *   GET  /v2/annotation/campaigns/:slug/tasks            (list)
 *   POST /v2/annotation/campaigns/:slug/tasks/next       (router: pull-next)
 *   POST /v2/annotation/assignments/:id/submissions      (submit)
 *
 * Slice 3 will add the supervisor + manager-facing dashboards (list
 * per gate, escalate, skip, re-issue expired). The endpoints above
 * are the minimum to drive an annotator round-trip end-to-end.
 */
@ApiTags('annotation')
@Controller({ version: '2' })
export class TaskController {
  constructor(@Inject(TaskService) private readonly tasks: TaskService) {}

  @Post('annotation/campaigns/:slug/tasks')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Seed annotation tasks from sample refs (campaign-manager only)',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  seed(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @Body(new ZodPipe(SeedTasksRequestSchema)) body: SeedTasksRequest,
  ) {
    return this.tasks.seed({ slug, sampleRefs: body.sampleRefs });
  }

  @Get('annotation/campaigns/:slug/tasks')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tasks for a campaign (manager / supervisor view)' })
  @ApiOkResponse({ description: 'Tasks ordered by creation time (FIFO).' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager', 'task-supervisor')
  list(@Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug) {
    return this.tasks.listForCampaign(slug);
  }

  @Post('annotation/campaigns/:slug/tasks/next')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Pull the caller's next eligible task assignment (annotator-style)",
    description:
      "Re-issues an in-flight assignment idempotently if one exists. Otherwise picks the FIFO-earliest eligible task whose gate matches the caller's annotation role.",
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('annotator', 'arbitration-annotator', 'expert-reviewer')
  pullNext(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    const groups = (user as unknown as { 'cognito:groups'?: string[] })['cognito:groups'] ?? [];
    return this.tasks.pullNext({ slug, user, userGroups: groups });
  }

  @Post('annotation/assignments/:id/submissions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit annotation work for an assignment',
    description:
      'Marks the assignment as SUBMITTED. The task gate advances when the gate-specific submission count is met (INDEPENDENT requires N submissions; arbitration / expert advance on the single submission).',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('annotator', 'arbitration-annotator', 'expert-reviewer')
  submit(
    @Param('id', new ZodPipe(AssignmentIdSchema)) id: string,
    @Body(new ZodPipe(SubmitAssignmentRequestSchema)) body: SubmitAssignmentRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.tasks.submit({
      assignmentId: id,
      submission: body.submission,
      acknowledgedInstructionsVersion: body.acknowledgedInstructionsVersion ?? null,
      user,
    });
  }
}
