import { Inject, Injectable } from '@nestjs/common';
import type { AnnotatorCalibrationFlag } from '@oci/database';
import { PrismaService } from '../../prisma.service.js';

export interface AnnotatorSubmissionRow {
  taskId: string;
  sampleRef: string;
  assigneeUserId: string;
  submission: unknown;
  submittedAt: Date;
}

@Injectable()
export class CalibrationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Pull SUBMITTED assignments for a campaign within a rolling window.
   * The calibration evaluator groups by annotator + sampleRef in
   * pure JS — pushing the grouping into Postgres adds complexity
   * (cross-table soft FK) and the slice-2 sample sizes are small.
   */
  async listSubmissionsForCampaign(
    campaignId: string,
    sinceWindowStart: Date,
  ): Promise<AnnotatorSubmissionRow[]> {
    const rows = await this.prisma.client.annotationTaskAssignment.findMany({
      where: {
        status: 'SUBMITTED',
        submittedAt: { gte: sinceWindowStart },
        task: { campaignId },
      },
      select: {
        assigneeUserId: true,
        submission: true,
        submittedAt: true,
        task: { select: { id: true, sampleRef: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map((r) => ({
      taskId: r.task.id,
      sampleRef: r.task.sampleRef,
      assigneeUserId: r.assigneeUserId,
      submission: r.submission,
      submittedAt: r.submittedAt!,
    }));
  }

  async findActiveFlag(
    campaignId: string,
    annotatorUserId: string,
    flagType: string,
  ): Promise<AnnotatorCalibrationFlag | null> {
    const rows = await this.prisma.client.annotatorCalibrationFlag.findMany({
      where: { campaignId, annotatorUserId, flagType, status: 'ACTIVE' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  async listActiveFlagsForCampaign(campaignId: string): Promise<AnnotatorCalibrationFlag[]> {
    return this.prisma.client.annotatorCalibrationFlag.findMany({
      where: { campaignId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async raiseFlag(args: {
    campaignId: string;
    annotatorUserId: string;
    flagType: string;
    metric: string;
    score: number;
    threshold: number;
    sampleSize: number;
    windowMeta: object;
  }): Promise<AnnotatorCalibrationFlag> {
    return this.prisma.client.annotatorCalibrationFlag.create({
      data: {
        campaignId: args.campaignId,
        annotatorUserId: args.annotatorUserId,
        flagType: args.flagType,
        metric: args.metric,
        score: args.score,
        threshold: args.threshold,
        sampleSize: args.sampleSize,
        windowMeta: args.windowMeta as never,
        status: 'ACTIVE',
      },
    });
  }

  async clearFlag(id: string): Promise<AnnotatorCalibrationFlag> {
    return this.prisma.client.annotatorCalibrationFlag.update({
      where: { id },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });
  }
}
