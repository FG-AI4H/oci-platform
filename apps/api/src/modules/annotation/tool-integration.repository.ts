import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import type {
  AnnotationCampaign,
  AnnotationTask,
  AnnotationTaskAssignment,
  AnnotationToolCallbackReceipt,
  AnnotationToolIntegration,
  AnnotationToolIntegrationVersion,
} from '@oci/database';

export type IntegrationWithVersions = AnnotationToolIntegration & {
  versions: AnnotationToolIntegrationVersion[];
};
export type AssignmentWithTask = AnnotationTaskAssignment & { task: AnnotationTask };

/**
 * Tool-integration repository (ADR-0007, #214). The only place doing
 * Prisma calls for the integration registry, versions, and callback
 * idempotency receipts. `AnnotationTask.campaignId` is a soft FK (no
 * Prisma relation until B.A.2), so the campaign is fetched separately.
 */
@Injectable()
export class ToolIntegrationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findIntegrationById(id: string): Promise<IntegrationWithVersions | null> {
    return this.prisma.client.annotationToolIntegration.findUnique({
      where: { id },
      include: { versions: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async findVersionById(id: string): Promise<AnnotationToolIntegrationVersion | null> {
    return this.prisma.client.annotationToolIntegrationVersion.findUnique({ where: { id } });
  }

  /** The single `isCurrent` version for an integration, if any. */
  async findCurrentVersion(
    integrationId: string,
  ): Promise<AnnotationToolIntegrationVersion | null> {
    return this.prisma.client.annotationToolIntegrationVersion.findFirst({
      where: { integrationId, isCurrent: true },
    });
  }

  async findAssignmentById(id: string): Promise<AssignmentWithTask | null> {
    return this.prisma.client.annotationTaskAssignment.findUnique({
      where: { id },
      include: { task: true },
    });
  }

  async findCampaignById(id: string): Promise<AnnotationCampaign | null> {
    return this.prisma.client.annotationCampaign.findUnique({ where: { id } });
  }

  async findReceipt(
    integrationId: string,
    idempotencyKey: string,
  ): Promise<AnnotationToolCallbackReceipt | null> {
    return this.prisma.client.annotationToolCallbackReceipt.findUnique({
      where: { integrationId_idempotencyKey: { integrationId, idempotencyKey } },
    });
  }

  async createReceipt(args: {
    idempotencyKey: string;
    integrationId: string;
    versionId: string | null;
    payloadHash: string;
    responseStatus: number;
    responseBody: { status: string; assignmentId: string };
  }): Promise<AnnotationToolCallbackReceipt> {
    return this.prisma.client.annotationToolCallbackReceipt.create({
      data: {
        idempotencyKey: args.idempotencyKey,
        integrationId: args.integrationId,
        versionId: args.versionId,
        payloadHash: args.payloadHash,
        responseStatus: args.responseStatus,
        responseBody: args.responseBody,
      },
    });
  }
}
