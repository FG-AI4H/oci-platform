import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AnnotationTask, AnnotationTaskAssignment } from '@oci/database';
import type { AssignmentReadingsResponse, AssignmentSampleResponse } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { StorageService } from '../storage/storage.service.js';
import { CampaignRepository } from './campaign.repository.js';
import { TaskRepository } from './task.repository.js';

/** How long a sample address stays valid. Long enough to load the file, short enough that a copied link soon stops working. */
export const SAMPLE_URL_TTL_SECONDS = 5 * 60;

/** Groups that oversee every campaign: they may see any assignment's sample. */
const OVERSIGHT_GROUPS = ['campaign-manager', 'task-supervisor', 'admin'] as const;

/**
 * What a reader is shown for one assignment (#646): the sample's files,
 * and at arbitration what the independent readers answered.
 *
 * Both are handed only to the assignee while the assignment is in
 * progress, and to campaign managers and task supervisors. Nothing else
 * about the sample goes with them: no metadata, no file name, no reader
 * identities (ADR-0010).
 *
 * Nothing here depends on the file type: the task names a storage key,
 * the repository decides which types can be read, and the answer is a
 * list of addresses. DICOM series (#674) add a lookup, not a new shape.
 */
@Injectable()
export class AssignmentSampleService {
  constructor(
    @Inject(CampaignRepository) private readonly campaigns: CampaignRepository,
    @Inject(TaskRepository) private readonly tasks: TaskRepository,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async sample(args: {
    assignmentId: string;
    user: CognitoAccessTokenPayload;
    userGroups: readonly string[];
    nowMs?: number;
  }): Promise<AssignmentSampleResponse> {
    const assignment = await this.authorised(args);
    const campaign = await this.campaigns.findById(assignment.task.campaignId);
    if (!campaign?.manifestVersionId) {
      throw new ConflictException('The campaign has no pinned dataset version');
    }
    const files = await this.campaigns.findHostedSampleFiles(
      campaign.manifestVersionId,
      assignment.task.sampleRef,
    );
    if (files.length === 0) {
      throw new NotFoundException("This task's sample is not a hosted file the platform can show");
    }
    const signed = await Promise.all(
      files.map(async (file) => ({
        url: await this.storage.signHostedRead({
          bucket: file.s3Bucket,
          key: file.s3Key,
          contentType: file.contentType,
          ttlSeconds: SAMPLE_URL_TTL_SECONDS,
        }),
        contentType: file.contentType,
      })),
    );
    const now = args.nowMs ?? Date.now();
    return {
      files: signed,
      expiresAt: new Date(now + SAMPLE_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * What the independent readers answered on an arbitration task: each
   * label with its comment, never who gave it (#646). Sorted by label
   * and comment, so the order can't hint at who read first.
   */
  async readings(args: {
    assignmentId: string;
    user: CognitoAccessTokenPayload;
    userGroups: readonly string[];
  }): Promise<AssignmentReadingsResponse> {
    const assignment = await this.authorised(args);
    if (assignment.gateAtAssignment === 'INDEPENDENT') {
      // Peer labels stay hidden at the independent step (ADR-0010 Decision 2).
      throw new ForbiddenException(
        'Readers do not see each other’s labels at the independent step',
      );
    }
    const payloads = await this.tasks.submissionPayloadsAtGate(assignment.task.id, 'INDEPENDENT');
    const readings = payloads.flatMap((p) =>
      typeof p.label === 'string'
        ? [{ label: p.label, comment: typeof p.comment === 'string' ? p.comment : null }]
        : [],
    );
    readings.sort(
      (a, b) => a.label.localeCompare(b.label) || (a.comment ?? '').localeCompare(b.comment ?? ''),
    );
    return { readings };
  }

  private async authorised(args: {
    assignmentId: string;
    user: CognitoAccessTokenPayload;
    userGroups: readonly string[];
  }): Promise<AnnotationTaskAssignment & { task: AnnotationTask }> {
    const assignment = await this.tasks.findAssignmentById(args.assignmentId);
    if (!assignment) throw new NotFoundException(`Assignment '${args.assignmentId}' not found`);
    const isAssignee = assignment.assigneeUserId === cognitoSubAsUuid(args.user.sub);
    const inProgress = assignment.status === 'PENDING' || assignment.status === 'IN_PROGRESS';
    const oversees = OVERSIGHT_GROUPS.some((g) => args.userGroups.includes(g));
    if (!(isAssignee && inProgress) && !oversees) {
      throw new ForbiddenException(
        'Only the assignee, while the task is in progress, or a campaign manager or supervisor may see this',
      );
    }
    return assignment;
  }
}
