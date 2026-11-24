import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AnnotationTask, AnnotationTaskAssignment } from '@oci/database';
import {
  DicomViewSchema,
  parseDicomSeriesSampleRef,
  parseFileSampleRef,
  type AssignmentReading,
  type AssignmentReadingsResponse,
  type AssignmentSampleResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { DicomSeriesService } from '../storage/dicom-series.service.js';
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
 * The task's sample reference is a typed platform id (#646, #674), and
 * one resolver switches on its prefix: `file:<distribution id>` is an
 * image, `dicom-series:<series id>` a series, both within the
 * campaign's pinned version. The answer is tagged by `kind`.
 *
 * The task's rule applies here, not the dataset's access rule: a reader
 * usually has no access to the dataset itself. A held file (ADR-0026)
 * never reaches a reader: the series side answers 409 when one is.
 */
@Injectable()
export class AssignmentSampleService {
  constructor(
    @Inject(CampaignRepository) private readonly campaigns: CampaignRepository,
    @Inject(TaskRepository) private readonly tasks: TaskRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(DicomSeriesService) private readonly dicomSeries: DicomSeriesService,
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
    const versionId = campaign.manifestVersionId;
    const sampleRef = assignment.task.sampleRef;

    if (parseDicomSeriesSampleRef(sampleRef) !== null) {
      // 404 when not a series of the pinned version, 409 when a file is held.
      return this.dicomSeries.taskSample({ sampleRef, versionId });
    }

    const distributionId = parseFileSampleRef(sampleRef);
    const file = distributionId
      ? await this.campaigns.findHostedImageFile(versionId, distributionId)
      : null;
    if (!file) {
      throw new NotFoundException("This task's sample is not a hosted file the platform can show");
    }
    const url = await this.storage.signHostedRead({
      bucket: file.s3Bucket,
      key: file.s3Key,
      contentType: file.contentType,
      ttlSeconds: SAMPLE_URL_TTL_SECONDS,
    });
    const now = args.nowMs ?? Date.now();
    return {
      kind: 'image',
      url,
      contentType: file.contentType,
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
    const readings = payloads.flatMap((p): AssignmentReading[] => {
      if (typeof p.label !== 'string') return [];
      // On a series, where the reader was when they answered (#674).
      // The submit path checked it against the series; an older answer
      // without one, or with one that no longer parses, shows none.
      const view = DicomViewSchema.safeParse(p.view);
      return [
        {
          label: p.label,
          comment: typeof p.comment === 'string' ? p.comment : null,
          view: view.success ? view.data : null,
        },
      ];
    });
    // The image a reader stopped on is part of what they answered, not
    // a hint at who they are: it breaks ties after label and comment.
    readings.sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        (a.comment ?? '').localeCompare(b.comment ?? '') ||
        (a.view?.position ?? 0) - (b.view?.position ?? 0),
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
