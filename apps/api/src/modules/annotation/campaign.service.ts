import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AnnotationToolIntegrationSummary,
  CampaignDetail,
  CampaignSummary,
  CampaignOutputLicense,
  CampaignTransitionAction,
  CreateCampaignRequest,
  ListCampaignsResponse,
} from '@oci/shared-types';
import { allowedTaskKindsForModalities } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type {
  AnnotationCampaign,
  AnnotationToolIntegration,
  CampaignOutputLicense as PrismaOutputLicense,
} from '@oci/database';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { lookupTransition } from './campaign-state-machine.js';
import { CampaignRepository } from './campaign.repository.js';

/**
 * Phase B.A.1 — Campaign business logic. Surface scope per the
 * orchestration kickoff: create + list + detail. Workflow state
 * transitions (DRAFT → READY → RUNNING → …) land with sub-epic
 * #215 (ADR-0006 Decision 1 state machine + ADR-0011 rejection paths).
 */
@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

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

    // Defence-in-depth #2 (#247): the form disables radios that the
    // dataset's modality forbids; mirror the constraint here so a
    // hand-crafted POST can't pair a text-only dataset with a
    // SEGMENTATION campaign. When the dataset has no recognised
    // modalities (host hasn't declared, or labels don't match the
    // canonical vocabulary in @oci/shared-types/modality-task-kinds)
    // we DON'T block the manager — the curated mapping is opt-in
    // metadata, not a hard requirement. Instead we log a warning so
    // hosts get nudged to publish modality metadata that drives the
    // UX safety net.
    const dataset = await this.repo.findDatasetModalities(body.datasetId);
    if (!dataset) {
      // Cleaner than a deferred FK violation at INSERT.
      throw new BadRequestException(`datasetId '${body.datasetId}' is not a registered dataset`);
    }
    const allowedTaskKinds = allowedTaskKindsForModalities(dataset.modalities);
    if (!allowedTaskKinds.includes(body.taskKind)) {
      throw new BadRequestException(
        `Dataset '${dataset.slug}' modalities ` +
          `(${dataset.modalities.join(', ') || 'none declared'}) ` +
          `do not support taskKind '${body.taskKind}' ` +
          `(allowed: ${allowedTaskKinds.join(', ') || 'none'})`,
      );
    }
    if (dataset.modalities.length === 0) {
      // Host hasn't declared modality metadata in their manifest.
      // Audit signal — operators can use this to nudge hosts to
      // publish richer BIOCroissant fields. Not an error: the form
      // already allows the manager through in this case.
      this.logger.warn(
        `campaign-create: dataset '${dataset.slug}' has no modalities declared; ` +
          `task-kind constraint fell back to "allow all". Host should publish ` +
          `bio:imagingModality / bio:dataModality on the next manifest revision.`,
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

  /**
   * Drive the campaign lifecycle state machine (#215, slice 1).
   *
   * The state-machine module owns the (current-status, action) → rule
   * mapping; this method enforces the rule against the live row, runs
   * action-specific pre-flight checks, writes the new status (+
   * denormalised `startedAt` / `completedAt`), and emits a structured
   * log line for the audit feed. A dedicated transition-history table
   * arrives in slice 2 of this issue.
   */
  async transition(
    slug: string,
    action: CampaignTransitionAction,
    reason: string | undefined,
    user: CognitoAccessTokenPayload,
  ): Promise<CampaignDetail> {
    const row = await this.repo.findBySlug(slug);
    if (!row) throw new NotFoundException(`Campaign '${slug}' not found`);

    const rule = lookupTransition(row.status, action);
    if (!rule) {
      throw new BadRequestException(
        `Action '${action}' is not allowed from status '${row.status}'`,
      );
    }

    if (rule.reasonRequired && (!reason || reason.trim().length === 0)) {
      throw new BadRequestException(`Action '${action}' requires a non-empty reason`);
    }

    // Action-specific pre-flight. Lives here rather than the matrix
    // because each check depends on row-shape, not just status.
    await this.preFlight(action, row);

    const updated = await this.repo.updateStatus({
      id: row.id,
      nextStatus: rule.to,
      stampStartedAt: rule.stampStartedAt,
      stampCompletedAt: rule.stampCompletedAt,
    });

    this.logger.log(
      `campaign-transition slug=${slug} ${row.status}→${rule.to} action=${action} actor=${user.sub}` +
        (reason ? ` reason="${reason.replace(/"/g, '\\"')}"` : ''),
    );

    return this.toDetail(updated, updated.toolIntegration);
  }

  /**
   * Per-action invariants that can be checked from the row alone.
   * Task-touching checks (e.g. "all tasks done before `complete`") land
   * in slice 2 once the task model exists.
   */
  private async preFlight(
    action: CampaignTransitionAction,
    row: AnnotationCampaign & { toolIntegration: AnnotationToolIntegration },
  ): Promise<void> {
    if (action === 'mark-ready') {
      // Re-validate the surfaces that already had to be valid at
      // create-time. They could have drifted (e.g. tool integration
      // deactivated) between DRAFT creation and now.
      if (!row.toolIntegration.isActive) {
        throw new ForbiddenException(
          `Tool integration '${row.toolIntegration.slug}' is no longer active`,
        );
      }
      const wf = row.workflowConfig as { nAnnotators?: number } | null;
      const n = wf?.nAnnotators ?? 0;
      if (n < 1 || n > 12) {
        throw new BadRequestException(`workflowConfig.nAnnotators must be in [1, 12]; got ${n}`);
      }
    }
    // start / complete / archive / revert-to-draft have no extra
    // row-level checks in slice 1. Slice 2 wires the task-state
    // invariants for `start` (at least one task) and `complete`
    // (no in-flight tasks).
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
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }

  private toDetail(row: AnnotationCampaign, tool: AnnotationToolIntegration): CampaignDetail {
    // Older campaign rows (pre-#229) only carry `nAnnotators`; the
    // task-timeout knob has a baked-in default in the Zod schema,
    // and the abandonment service reads the same default when the
    // JSONB column is missing the field. Fill in the default here so
    // the API response shape stays consistent.
    const raw = (row.workflowConfig ?? {}) as Partial<{
      nAnnotators: number;
      taskTimeoutHours: number;
      completenessMode: 'soft-warn' | 'hard-block';
    }>;
    const workflowConfig = {
      nAnnotators: raw.nAnnotators ?? 3,
      taskTimeoutHours: raw.taskTimeoutHours ?? 24,
      completenessMode:
        raw.completenessMode === 'hard-block' || raw.completenessMode === 'soft-warn'
          ? raw.completenessMode
          : ('soft-warn' as const),
    };
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
