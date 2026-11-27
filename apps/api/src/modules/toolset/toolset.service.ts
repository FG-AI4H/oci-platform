import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { Toolset } from '@oci/database';
import {
  canEditToolset,
  toolsetMovesFor,
  toolsetVisibleTo,
  type ChangeToolsetStatusRequest,
  type CreateToolsetRequest,
  type DatasetSlug,
  type ListMyToolsetsResponse,
  type ListToolsetsQuery,
  type ListToolsetsResponse,
  type ToolsetActor,
  type ToolsetKind,
  type ToolsetResponse,
  type ToolsetStatus,
  type UpdateToolsetRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.tokens.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { PredictionService } from '../prediction/prediction.service.js';
import { ToolsetRepository, toToolsetSummary } from './toolset.repository.js';

/**
 * Toolsets, a fourth catalogue listed by reference (ADR-0031, #830).
 *
 * A toolset is a description and a web address. This service holds its
 * lifecycle (DRAFT, PUBLISHED, WITHDRAWN) and its links to datasets and model
 * cards. Who sees, edits and moves a toolset is decided by the pure rules in
 * `@oci/shared-types`, so the web app shows exactly what this service accepts.
 *
 * The links follow the other catalogues' own visibility, asked of their
 * services: a toolset can name only what its declarer can see, and a reader
 * is shown only the links they may see.
 */
@Injectable()
export class ToolsetService {
  private readonly logger = new Logger(ToolsetService.name);

  constructor(
    @Inject(ToolsetRepository) private readonly repo: ToolsetRepository,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(PredictionService) private readonly prediction: PredictionService,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  async declare(
    body: CreateToolsetRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ToolsetResponse> {
    if (await this.repo.findBySlug(body.slug)) {
      throw new ConflictException(`Toolset identifier '${body.slug}' already exists`);
    }
    await this.assertLinksVisible(body.datasetSlugs, body.modelCardSlugs, user);

    const actorUserId = cognitoSubAsUuid(user.sub);
    const created = await this.repo.create({
      slug: body.slug,
      name: body.name,
      kind: body.kind,
      summary: body.summary,
      url: body.url,
      licence: body.licence ?? null,
      version: body.version ?? null,
      maintainer: body.maintainer,
      contact: body.contact ?? null,
      datasetSlugs: body.datasetSlugs,
      modelCardSlugs: body.modelCardSlugs,
      submitterUserId: actorUserId,
    });
    await this.audit.emitSync({
      module: 'toolset',
      action: 'toolset.created',
      subjectType: 'toolset',
      subjectId: created.id,
      actorUserId,
      payload: { slug: created.slug, kind: created.kind },
    });
    this.logger.log(`toolset.created slug=${created.slug} kind=${created.kind}`);
    return this.present(created, user);
  }

  /**
   * Edit a DRAFT. Someone who cannot see the toolset gets the 404 of a
   * missing identifier; an operator who can see it but did not declare it
   * gets a 403; its declarer, once it is no longer a DRAFT, gets a 409. Only
   * links added by this edit are checked: one already on the toolset stays,
   * even if the dataset has since been made private.
   */
  async update(
    slug: string,
    body: UpdateToolsetRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ToolsetResponse> {
    const existing = await this.findVisible(slug, user);
    const actor = actorOf(existing, user);
    if (!actor.isOwner) {
      throw new ForbiddenException(`Only its declarer may edit toolset '${slug}'`);
    }
    if (!canEditToolset(existing.status as ToolsetStatus, actor)) {
      throw new ConflictException(
        `Toolset '${slug}' is ${existing.status}; only a DRAFT can be edited`,
      );
    }
    await this.assertLinksVisible(
      (body.datasetSlugs ?? []).filter((s) => !existing.datasetSlugs.includes(s)),
      (body.modelCardSlugs ?? []).filter((s) => !existing.modelCardSlugs.includes(s)),
      user,
    );

    const updated = await this.repo.update(existing.id, body);
    await this.audit.emitSync({
      module: 'toolset',
      action: 'toolset.updated',
      subjectType: 'toolset',
      subjectId: updated.id,
      actorUserId: cognitoSubAsUuid(user.sub),
      // The names of the changed fields, never their values.
      payload: { slug: updated.slug, fields: Object.keys(body).sort() },
    });
    return this.present(updated, user);
  }

  /**
   * Publish or withdraw (ADR-0031 decision 5). A move that restates the
   * current status is a 409; one out of WITHDRAWN, or to PUBLISHED from
   * anything but DRAFT, is a 400; one the caller may not make is a 403.
   */
  async changeStatus(
    slug: string,
    body: ChangeToolsetStatusRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ToolsetResponse> {
    const existing = await this.findVisible(slug, user);
    const from = existing.status as ToolsetStatus;
    const to = body.status;
    if (from === to) throw new ConflictException(`Toolset '${slug}' is already ${from}`);
    if (from === 'WITHDRAWN' || (to === 'PUBLISHED' && from !== 'DRAFT')) {
      throw new BadRequestException(`Toolset '${slug}' cannot move from ${from} to ${to}`);
    }
    if (!toolsetMovesFor(from, actorOf(existing, user)).includes(to)) {
      throw new ForbiddenException(
        to === 'PUBLISHED'
          ? `Publishing toolset '${slug}' is for an operator`
          : `Only its declarer or an operator may withdraw toolset '${slug}'`,
      );
    }

    const updated = await this.repo.updateStatus(existing.id, to);
    await this.audit.emitSync({
      module: 'toolset',
      action: 'toolset.status.changed',
      subjectType: 'toolset',
      subjectId: updated.id,
      actorUserId: cognitoSubAsUuid(user.sub),
      payload: { slug: updated.slug, from, to },
    });
    this.logger.log(`toolset.status.changed slug=${slug} ${from}->${to}`);
    return this.present(updated, user);
  }

  async getBySlug(slug: string, user?: CognitoAccessTokenPayload): Promise<ToolsetResponse> {
    return this.present(await this.findVisible(slug, user), user);
  }

  /** The public list: PUBLISHED only, for every caller. */
  async listPublished(query: ListToolsetsQuery): Promise<ListToolsetsResponse> {
    const { rows, total } = await this.repo.searchPublished({
      q: query.q,
      kind: query.kind,
      datasetSlug: query.datasetSlug,
      modelCardSlug: query.modelCardSlug,
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
    return {
      items: rows.map(toToolsetSummary),
      total,
      page: query.page,
      pageSize: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async listMine(user: CognitoAccessTokenPayload): Promise<ListMyToolsetsResponse> {
    const rows = await this.repo.listBySubmitter(cognitoSubAsUuid(user.sub));
    return { items: rows.map(toToolsetSummary) };
  }

  /** A toolset the caller may not see is, to them, a missing identifier. */
  private async findVisible(slug: string, user?: CognitoAccessTokenPayload): Promise<Toolset> {
    const row = await this.repo.findBySlug(slug);
    if (!row || !toolsetVisibleTo(row.status as ToolsetStatus, actorOf(row, user))) {
      throw new NotFoundException(`Toolset '${slug}' not found`);
    }
    return row;
  }

  private async present(row: Toolset, user?: CognitoAccessTokenPayload): Promise<ToolsetResponse> {
    const actor = actorOf(row, user);
    const status = row.status as ToolsetStatus;
    const [datasets, modelCards] = await Promise.all([
      this.visibleDatasets(row.datasetSlugs, user),
      this.visibleModelCards(row.modelCardSlugs, user),
    ]);
    const privileged = actor.isOwner || actor.isOperator;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind as ToolsetKind,
      summary: row.summary,
      url: row.url,
      licence: row.licence,
      version: row.version,
      maintainer: row.maintainer,
      contact: row.contact,
      status,
      datasets,
      modelCards,
      datasetSlugs: privileged ? [...row.datasetSlugs] : null,
      modelCardSlugs: privileged ? [...row.modelCardSlugs] : null,
      canEdit: canEditToolset(status, actor),
      moves: toolsetMovesFor(status, actor),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The datasets of `slugs` this caller may see, in order, with their names. */
  private async visibleDatasets(
    slugs: ReadonlyArray<string>,
    user?: CognitoAccessTokenPayload,
  ): Promise<Array<{ slug: string; name: string }>> {
    const found = await Promise.all(
      slugs.map(async (slug) => {
        try {
          const dataset = await this.catalog.detail(slug as DatasetSlug, user);
          return { slug: dataset.slug, name: dataset.name };
        } catch (err) {
          if (err instanceof NotFoundException) return null;
          throw err;
        }
      }),
    );
    return found.filter((d): d is { slug: string; name: string } => d !== null);
  }

  /** The model cards of `slugs` this caller may see, in order. */
  private async visibleModelCards(
    slugs: ReadonlyArray<string>,
    user?: CognitoAccessTokenPayload,
  ): Promise<Array<{ slug: string }>> {
    const found = await Promise.all(
      slugs.map(async (slug) => {
        try {
          return { slug: (await this.prediction.getBySlug(slug, user)).slug };
        } catch (err) {
          if (err instanceof NotFoundException) return null;
          throw err;
        }
      }),
    );
    return found.filter((m): m is { slug: string } => m !== null);
  }

  /**
   * A toolset names only what its declarer can see (ADR-0031 decision 6). An
   * identifier that does not exist and one the declarer may not see get the
   * same refusal, so the form cannot be used to find out what exists.
   */
  private async assertLinksVisible(
    datasetSlugs: ReadonlyArray<string>,
    modelCardSlugs: ReadonlyArray<string>,
    user: CognitoAccessTokenPayload,
  ): Promise<void> {
    const [datasets, modelCards] = await Promise.all([
      this.visibleDatasets(datasetSlugs, user),
      this.visibleModelCards(modelCardSlugs, user),
    ]);
    const unknownDatasets = datasetSlugs.filter((s) => !datasets.some((d) => d.slug === s));
    const unknownModelCards = modelCardSlugs.filter((s) => !modelCards.some((m) => m.slug === s));
    if (unknownDatasets.length === 0 && unknownModelCards.length === 0) return;
    throw new BadRequestException({
      message: `Not on this platform, or not visible to you: ${[...unknownDatasets, ...unknownModelCards].join(', ')}`,
      // For the form, which points at the field concerned.
      unknownDatasets,
      unknownModelCards,
    });
  }
}

function actorOf(row: Toolset, user?: CognitoAccessTokenPayload): ToolsetActor {
  if (!user) return { isOwner: false, isOperator: false };
  const groups = (user['cognito:groups'] ?? []) as string[];
  return {
    isOwner: row.submitterUserId === cognitoSubAsUuid(user.sub),
    isOperator: groups.includes('admin'),
  };
}
