import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import type {
  AnnotationCampaign,
  AnnotationCampaignInstructions,
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

  /**
   * Look up a campaign by UUID. Used by the slice-3 decision-box
   * predicate (#215) which only has `task.campaignId` in hand and
   * can't reach through `findBySlug`.
   */
  async findById(id: string): Promise<AnnotationCampaign | null> {
    return this.prisma.client.annotationCampaign.findUnique({ where: { id } });
  }

  /**
   * Look up the modality labels denormalised on the Dataset row (#247).
   * Used by the campaign-create guard to reject incompatible
   * (modality × taskKind) combos with a 400 — mirrors the form's
   * disabled-radios behaviour for defence in depth.
   *
   * Returns null when the dataset id doesn't exist (the caller then
   * surfaces its own 400 — a typo'd dataset id should fail cleanly
   * before tripping a deferred FK violation at INSERT). An empty
   * `modalities` array (host hasn't declared) is a legitimate value
   * and is treated as "allow all task kinds" in the guard.
   */
  async findDatasetModalities(
    datasetId: string,
  ): Promise<{ id: string; slug: string; modalities: string[] } | null> {
    const ds = await this.prisma.client.dataset.findUnique({
      where: { id: datasetId },
      select: { id: true, slug: true, modalities: true },
    });
    if (!ds) return null;
    return {
      id: ds.id,
      slug: ds.slug,
      modalities: ds.modalities ?? [],
    };
  }

  /**
   * Licensing context for a dataset — the campaign output-license
   * picker (#235, ADR-0012 Decision 3) needs the dataset's access
   * tier (to pick the default) and commercial-use terms (to
   * validate the chosen license). Soft-FK lookup matching the
   * existing `findDatasetModalities` pattern.
   */
  async findDatasetLicenseContext(
    datasetId: string,
  ): Promise<{ accessTier: string; commercialUseTerms: string } | null> {
    const ds = await this.prisma.client.dataset.findUnique({
      where: { id: datasetId },
      select: { accessTier: true, commercialUseTerms: true },
    });
    if (!ds) return null;
    return {
      accessTier: ds.accessTier,
      commercialUseTerms: ds.commercialUseTerms,
    };
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
   * Look up an instructions row by (campaignId, version). Used by the
   * publish path's idempotent re-publish check (#230).
   */
  async findInstructionsByVersion(
    campaignId: string,
    version: string,
  ): Promise<AnnotationCampaignInstructions | null> {
    return this.prisma.client.annotationCampaignInstructions.findUnique({
      where: { campaignId_version: { campaignId, version } },
    });
  }

  async listInstructionsHistory(
    campaignId: string,
    limit = 20,
  ): Promise<AnnotationCampaignInstructions[]> {
    return this.prisma.client.annotationCampaignInstructions.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Idempotent publish: insert the row if (campaignId, version) is
   * new, then advance the campaign's `currentInstructionsVersion`
   * pointer. Returns the persisted row and a `created` flag so the
   * caller can distinguish a fresh publish from a no-op republish.
   */
  async publishInstructions(args: {
    campaignId: string;
    version: string;
    markdownBody: string;
    mediaUrls: unknown;
    createdById: string;
  }): Promise<{ row: AnnotationCampaignInstructions; created: boolean }> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.annotationCampaignInstructions.findUnique({
        where: { campaignId_version: { campaignId: args.campaignId, version: args.version } },
      });
      let row = existing;
      const created = !existing;
      if (!existing) {
        row = await tx.annotationCampaignInstructions.create({
          data: {
            campaignId: args.campaignId,
            version: args.version,
            markdownBody: args.markdownBody,
            // Prisma typings for JSON column accept JsonValue; cast here
            // since the caller validates the shape via Zod.
            mediaUrls: args.mediaUrls as never,
            createdById: args.createdById,
          },
        });
      }
      await tx.annotationCampaign.update({
        where: { id: args.campaignId },
        data: { currentInstructionsVersion: args.version },
      });
      return { row: row!, created };
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
