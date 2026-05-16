import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
}
