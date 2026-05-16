import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import type {
  AnnotationCampaign,
  AnnotationToolIntegration,
  CampaignOutputLicense as PrismaOutputLicense,
  CampaignStatus as PrismaStatus,
  CampaignTaskKind as PrismaTaskKind,
} from '@oci/database';

/**
 * Phase B.A.1 — Campaign repository. Only the create + read paths the
 * first scaffold needs. Workflow transitions land with sub-epic #215.
 */
@Injectable()
export class CampaignRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findBySlug(
    slug: string,
  ): Promise<(AnnotationCampaign & { toolIntegration: AnnotationToolIntegration }) | null> {
    return this.prisma.client.annotationCampaign.findUnique({
      where: { slug },
      include: { toolIntegration: true },
    });
  }

  async listRecent(limit = 25): Promise<AnnotationCampaign[]> {
    return this.prisma.client.annotationCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async countAll(): Promise<number> {
    return this.prisma.client.annotationCampaign.count();
  }

  async findToolIntegrationById(id: string): Promise<AnnotationToolIntegration | null> {
    return this.prisma.client.annotationToolIntegration.findUnique({ where: { id } });
  }

  async listActiveToolIntegrations(): Promise<AnnotationToolIntegration[]> {
    return this.prisma.client.annotationToolIntegration.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(args: {
    slug: string;
    name: string;
    description: string | null;
    taskKind: PrismaTaskKind;
    datasetId: string;
    toolIntegrationId: string;
    outputLicense: PrismaOutputLicense;
    workflowConfig: { nAnnotators: number };
    createdById: string;
  }): Promise<AnnotationCampaign & { toolIntegration: AnnotationToolIntegration }> {
    return this.prisma.client.annotationCampaign.create({
      data: {
        slug: args.slug,
        name: args.name,
        description: args.description,
        status: 'DRAFT' as PrismaStatus,
        taskKind: args.taskKind,
        datasetId: args.datasetId,
        toolIntegrationId: args.toolIntegrationId,
        outputLicense: args.outputLicense,
        workflowConfig: args.workflowConfig,
        createdById: args.createdById,
      },
      include: { toolIntegration: true },
    });
  }

  /**
   * Transition the row to a new status, conditionally stamping
   * `startedAt` / `completedAt`. The caller (service) is responsible
   * for the state-machine guard; this repo just persists.
   */
  async updateStatus(args: {
    id: string;
    nextStatus: PrismaStatus;
    stampStartedAt?: boolean;
    stampCompletedAt?: boolean;
  }): Promise<AnnotationCampaign & { toolIntegration: AnnotationToolIntegration }> {
    const now = new Date();
    return this.prisma.client.annotationCampaign.update({
      where: { id: args.id },
      data: {
        status: args.nextStatus,
        ...(args.stampStartedAt ? { startedAt: now } : {}),
        ...(args.stampCompletedAt ? { completedAt: now } : {}),
      },
      include: { toolIntegration: true },
    });
  }
}
