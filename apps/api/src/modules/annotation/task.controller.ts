import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CampaignSlugSchema,
  SeedTasksFromDatasetRequestSchema,
  SeedTasksRequestSchema,
  SubmitAssignmentRequestSchema,
  type CampaignSlug,
  type SeedTasksFromDatasetRequest,
  type SeedTasksRequest,
  type SubmitAssignmentRequest,
} from '@oci/shared-types';
import { z } from 'zod';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { AssignmentSampleService } from './assignment-sample.service.js';
import { TaskService } from './task.service.js';

const AssignmentIdSchema = z.string().uuid();

/**
 * Task workflow surface — slice 2 of #215.
 *
 *   POST /v2/annotation/campaigns/:slug/tasks            (seed)
 *   POST /v2/annotation/campaigns/:slug/tasks/from-dataset (seed from the dataset's image files)
 *   GET  /v2/annotation/campaigns/:slug/tasks            (list)
 *   GET  /v2/annotation/campaigns/:slug/tasks/current    (caller's in-flight task; reserves nothing)
 *   POST /v2/annotation/campaigns/:slug/tasks/next       (router: pull-next)
 *   POST /v2/annotation/assignments/:id/submissions      (submit)
 *   POST /v2/annotation/assignments/:id/release          (skip: give the task back unread)
 *   GET  /v2/annotation/assignments/:id/sample           (short-lived image address)
 *   GET  /v2/annotation/assignments/:id/readings         (arbitration: readers' labels, no identities)
 *
 * Slice 3 will add the supervisor + manager-facing dashboards (list
 * per gate, escalate, skip, re-issue expired). The endpoints above
 * are the minimum to drive an annotator round-trip end-to-end.
 */
@ApiTags('annotation')
@Controller({ version: '2' })
export class TaskController {
  constructor(
    @Inject(TaskService) private readonly tasks: TaskService,
    @Inject(AssignmentSampleService) private readonly samples: AssignmentSampleService,
  ) {}

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

  @Post('annotation/campaigns/:slug/tasks/from-dataset')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Seed one task per hosted PNG / JPEG file of the campaign's dataset version",
    description:
      'Idempotent: files that already have a task are skipped. `prefix` matches the file name, `limit` takes the first files in storage-key order, `dryRun` counts without creating (#646).',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  seedFromDataset(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @Body(new ZodPipe(SeedTasksFromDatasetRequestSchema)) body: SeedTasksFromDatasetRequest,
  ) {
    return this.tasks.seedFromDataset({
      slug,
      dryRun: body.dryRun,
      ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    });
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

  @Get('annotation/campaigns/:slug/annotators/:userId/quality')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'IRR-vs-gold quality summary for one annotator on a campaign (#291, supervisor view)',
    description:
      "Reads the annotator's SUBMITTED assignments on gold-standard tasks in this campaign and scores them against the campaign's quality metric. Returns null score when no gold samples have been scored yet.",
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager', 'task-supervisor')
  annotatorQuality(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @Param('userId', new ZodPipe(AssignmentIdSchema)) userId: string,
  ) {
    return this.tasks.annotatorQuality({ slug, annotatorUserId: userId });
  }

  @Get('annotation/campaigns/:slug/tasks/current')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The caller's in-flight assignment, if any (reserves nothing)",
    description:
      'Read-only counterpart of pull-next (#646): returns the assignment the caller already holds at their gate, or null. Opening the annotate page calls this; only pull-next reserves a task.',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('annotator', 'arbitration-annotator', 'expert-reviewer')
  current(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    const groups = (user as unknown as { 'cognito:groups'?: string[] })['cognito:groups'] ?? [];
    return this.tasks.current({ slug, user, userGroups: groups });
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

  @Post('annotation/assignments/:id/release')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Give an assignment back unread (skip)',
    description:
      'Only the assignee may release, and only while the assignment is in progress. The slot reopens for other annotators; the router offers the caller other tasks before the released one (#646).',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('annotator', 'arbitration-annotator', 'expert-reviewer')
  release(
    @Param('id', new ZodPipe(AssignmentIdSchema)) id: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.tasks.release({ assignmentId: id, user });
  }

  @Get('annotation/assignments/:id/sample')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "A short-lived address for the assignment's image",
    description:
      'Only for the assignee while the assignment is in progress, and for campaign managers and task supervisors. No sample metadata travels with it (ADR-0010, #646).',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles(
    'annotator',
    'arbitration-annotator',
    'expert-reviewer',
    'campaign-manager',
    'task-supervisor',
  )
  sample(
    @Param('id', new ZodPipe(AssignmentIdSchema)) id: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    const groups = (user as unknown as { 'cognito:groups'?: string[] })['cognito:groups'] ?? [];
    return this.samples.sample({ assignmentId: id, user, userGroups: groups });
  }

  @Get('annotation/assignments/:id/readings')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The independent readers' labels, for arbitration (no identities)",
    description: 'Refused at the independent step. Same callers as the sample address (#646).',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles(
    'arbitration-annotator',
    'expert-reviewer',
    'campaign-manager',
    'task-supervisor',
  )
  readings(
    @Param('id', new ZodPipe(AssignmentIdSchema)) id: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    const groups = (user as unknown as { 'cognito:groups'?: string[] })['cognito:groups'] ?? [];
    return this.samples.readings({ assignmentId: id, user, userGroups: groups });
  }
}
