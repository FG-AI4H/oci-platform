import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AnnotationToolIntegrationSummary,
  CampaignDetail,
  CampaignSummary,
  CampaignOutputLicense,
  CreateCampaignRequest,
  ListCampaignsResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type {
  AnnotationCampaign,
  AnnotationToolIntegration,
  CampaignOutputLicense as PrismaOutputLicense,
} from '@oci/database';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CampaignRepository } from './campaign.repository.js';

/**
 * Phase B.A.1 — Campaign business logic. Surface scope per the
 * orchestration kickoff: create + list + detail. Workflow state
 * transitions (DRAFT → READY → RUNNING → …) land with sub-epic
 * #215 (ADR-0006 Decision 1 state machine + ADR-0011 rejection paths).
 */
@Injectable()
export class CampaignService {
  // `emitDecoratorMetadata` does not surface constructor parameter types
  // to Nest's reflector, so type-only injection silently passes
  // `undefined`. The explicit token works in both tsx and tsc paths.
  constructor(@Inject(CampaignRepository) private readonly repo: CampaignRepository) {}

  async listToolIntegrations(): Promise<AnnotationToolIntegrationSummary[]> {
    const rows = await this.repo.listActiveToolIntegrations();
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      vendor: t.vendor,
      version: t.version,
      supportedTaskKinds: t.supportedTaskKinds,
    }));
  }

  async list(): Promise<ListCampaignsResponse> {
    const [items, total] = await Promise.all([this.repo.listRecent(25), this.repo.countAll()]);
    return {
      items: items.map((row) => this.toSummary(row)),
      nextCursor: null,
      totalEstimate: total,
    };
  }

  async detail(slug: string): Promise<CampaignDetail> {
    const row = await this.repo.findBySlug(slug);
    if (!row) throw new NotFoundException(`Campaign '${slug}' not found`);
    return this.toDetail(row, row.toolIntegration);
  }

  async create(
    body: CreateCampaignRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<CampaignDetail> {
    // Slug uniqueness — surface as 409 rather than letting the DB
    // throw a P2002 the controller can't shape into a clean response.
    const existing = await this.repo.findBySlug(body.slug);
    if (existing) {
      throw new ConflictException(`Campaign slug '${body.slug}' is already taken`);
    }

    // Tool-integration FK existence check — the migration seeds two
    // stubs (monai-label, ohif-viewer); a typo'd id should 400 cleanly
    // rather than tripping a deferred FK violation later.
    const tool = await this.repo.findToolIntegrationById(body.toolIntegrationId);
    if (!tool || !tool.isActive) {
      throw new BadRequestException(
        `toolIntegrationId '${body.toolIntegrationId}' is not a registered active integration`,
      );
    }

    // Defence-in-depth: the form filters the tool dropdown by
    // supportedTaskKinds, but enforce the same constraint server-side
    // so a hand-crafted POST can't bypass the UI.
    if (!tool.supportedTaskKinds.includes(body.taskKind)) {
      throw new BadRequestException(
        `Tool '${tool.slug}' does not support taskKind '${body.taskKind}' ` +
          `(supports: ${tool.supportedTaskKinds.join(', ') || 'none'})`,
      );
    }

    // Output license — when caller doesn't pass one, derive from the
    // dataset's access tier per ADR-0012 Decision 3. Phase B.A.1 ships
    // with a simplified default (CC-BY-4.0) until the catalog ↔
    // annotation linkage that surfaces accessTier lands with sub-epic
    // #223. The tier-aware default + SENSITIVE-tier enforcement lands
    // alongside that work.
    const outputLicense: CampaignOutputLicense = body.outputLicense ?? 'CC-BY-4.0';

    const created = await this.repo.create({
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      taskKind: body.taskKind,
      datasetId: body.datasetId,
      toolIntegrationId: body.toolIntegrationId,
      outputLicense: this.toPrismaLicense(outputLicense),
      workflowConfig: body.workflowConfig ?? { nAnnotators: 3 },
      createdById: cognitoSubAsUuid(user.sub),
    });

    return this.toDetail(created, created.toolIntegration);
  }

  // -------------------------------------------------------------------
  // Mappers — Prisma row → shared-types contract. Keep these in one
  // place so the contract is the only thing the controller depends on.
  // -------------------------------------------------------------------

  private toSummary(row: AnnotationCampaign): CampaignSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      status: row.status,
      taskKind: row.taskKind,
      datasetId: row.datasetId,
      toolIntegrationId: row.toolIntegrationId,
      outputLicense: this.toContractLicense(row.outputLicense),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: AnnotationCampaign, tool: AnnotationToolIntegration): CampaignDetail {
    const workflowConfig = (row.workflowConfig as { nAnnotators: number }) ?? { nAnnotators: 3 };
    return {
      ...this.toSummary(row),
      workflowConfig,
      toolIntegration: {
        id: tool.id,
        slug: tool.slug,
        name: tool.name,
        vendor: tool.vendor,
        version: tool.version,
        supportedTaskKinds: tool.supportedTaskKinds,
      },
      createdById: row.createdById,
    };
  }

  // The Prisma enum @maps to the SPDX-ish strings used in the contract
  // (e.g. CC_BY_4_0 → 'CC-BY-4.0'). The generated TS client surfaces the
  // *variant name* (with underscores), so we need an explicit table on
  // both sides of the seam — `as` casts silently typecheck but skip the
  // runtime conversion.
  private static readonly LICENSE_TO_PRISMA: Record<CampaignOutputLicense, PrismaOutputLicense> = {
    'CC-BY-4.0': 'CC_BY_4_0',
    'CC-BY-NC-4.0': 'CC_BY_NC_4_0',
    'CC-BY-SA-4.0': 'CC_BY_SA_4_0',
    'CC0-1.0': 'CC0_1_0',
    'custom-restricted': 'CUSTOM_RESTRICTED',
  } as const;

  private static readonly LICENSE_TO_CONTRACT: Record<PrismaOutputLicense, CampaignOutputLicense> =
    {
      CC_BY_4_0: 'CC-BY-4.0',
      CC_BY_NC_4_0: 'CC-BY-NC-4.0',
      CC_BY_SA_4_0: 'CC-BY-SA-4.0',
      CC0_1_0: 'CC0-1.0',
      CUSTOM_RESTRICTED: 'custom-restricted',
    } as const;

  private toPrismaLicense(license: CampaignOutputLicense): PrismaOutputLicense {
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    return CampaignService.LICENSE_TO_PRISMA[license];
  }

  private toContractLicense(license: PrismaOutputLicense): CampaignOutputLicense {
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    return CampaignService.LICENSE_TO_CONTRACT[license];
  }
}
